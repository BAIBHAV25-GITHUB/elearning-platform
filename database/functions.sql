-- PostgreSQL Functions for E-Learning Platform
-- Run after schema.sql:  psql -U postgres -d elearning_db -v ON_ERROR_STOP=1 -f functions.sql
--
-- Error-code conventions the API layer can map to HTTP statuses:
--   P0001  business rule violated            -> 400 / 409
--   P0002  record not found                  -> 404
--   23505  duplicate (already enrolled etc.) -> 409
--   42501  not allowed                       -> 403
--
-- Lock order used everywhere: enrollment row first, then its payment rows.
-- (Keeps confirm / drop / expire from deadlocking each other.)

-- 1. Updated-at trigger function
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- AUTH HELPERS (the schema has roles + user_roles, so role lookup lives in SQL)
-- ---------------------------------------------------------------------------

-- 2. Highest-privilege role of a user as a lower-case string
--    ('admin' > 'instructor' > 'student'); NULL if the user has no role.
CREATE OR REPLACE FUNCTION fn_user_role(p_user_id INTEGER)
RETURNS TEXT AS $$
    SELECT lower(r.role_name)
      FROM user_roles ur
      JOIN roles r ON r.role_id = ur.role_id
     WHERE ur.user_id = p_user_id
     ORDER BY CASE lower(r.role_name)
                  WHEN 'admin'      THEN 1
                  WHEN 'instructor' THEN 2
                  WHEN 'student'    THEN 3
                  ELSE 4
              END
     LIMIT 1;
$$ LANGUAGE sql STABLE;

-- 3. Register a user + assign role atomically.
--    Only 'student' and 'instructor' can be self-registered. Admins are created
--    by seed / manual SQL, which closes the "register as admin" hole.
--    p_password_hash must already be a bcrypt hash.
CREATE OR REPLACE FUNCTION fn_register_user(
    p_name          VARCHAR,
    p_email         VARCHAR,
    p_password_hash VARCHAR,
    p_role          VARCHAR DEFAULT 'student'
)
RETURNS TABLE (user_id INTEGER, user_name VARCHAR, email VARCHAR, role TEXT) AS $$
#variable_conflict use_column
DECLARE
    v_role_id SMALLINT;
    v_user_id INTEGER;
    v_role    TEXT := lower(COALESCE(NULLIF(btrim(p_role), ''), 'student'));
BEGIN
    IF v_role NOT IN ('student', 'instructor') THEN
        RAISE EXCEPTION 'Role "%" cannot be self-registered', v_role USING ERRCODE = 'P0001';
    END IF;

    SELECT role_id INTO v_role_id FROM roles WHERE lower(role_name) = v_role;
    IF v_role_id IS NULL THEN
        RAISE EXCEPTION 'Role "%" is not configured', v_role USING ERRCODE = 'P0002';
    END IF;

    -- unique_violation (23505) on lower(email) is raised naturally for duplicates
    INSERT INTO users (user_name, email, password)
    VALUES (btrim(p_name), lower(btrim(p_email)), p_password_hash)
    RETURNING users.user_id INTO v_user_id;

    INSERT INTO user_roles (user_id, role_id) VALUES (v_user_id, v_role_id);

    RETURN QUERY
        SELECT u.user_id, u.user_name, u.email, v_role
          FROM users u WHERE u.user_id = v_user_id;
END;
$$ LANGUAGE plpgsql;

-- 4. Everything the login handler needs in one row (includes the hash).
CREATE OR REPLACE FUNCTION fn_get_user_for_login(p_email VARCHAR)
RETURNS TABLE (user_id INTEGER, user_name VARCHAR, email VARCHAR, password VARCHAR,
               status user_status_enum, role TEXT) AS $$
    SELECT u.user_id, u.user_name, u.email, u.password, u.status, fn_user_role(u.user_id)
      FROM users u
     WHERE lower(u.email) = lower(btrim(p_email));
$$ LANGUAGE sql STABLE;

-- 5. Safe user lookup for GET /auth/me (no password).
CREATE OR REPLACE FUNCTION fn_get_user_by_id(p_user_id INTEGER)
RETURNS TABLE (user_id INTEGER, user_name VARCHAR, email VARCHAR,
               status user_status_enum, role TEXT) AS $$
    SELECT u.user_id, u.user_name, u.email, u.status, fn_user_role(u.user_id)
      FROM users u
     WHERE u.user_id = p_user_id;
$$ LANGUAGE sql STABLE;

-- 6. Ownership check for instructor endpoints (modules, batches, content,
--    announcements, publish). TRUE for the course's instructor or any admin.
CREATE OR REPLACE FUNCTION fn_can_manage_course(p_course_id INTEGER, p_user_id INTEGER)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (SELECT 1 FROM courses WHERE course_id = p_course_id AND instructor_id = p_user_id)
        OR (fn_user_role(p_user_id) = 'admin'
            AND EXISTS (SELECT 1 FROM courses WHERE course_id = p_course_id));
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- ENROLLMENT & PAYMENT
-- ---------------------------------------------------------------------------

-- 7. Enroll a student.
--    * course must exist and be published; batch must belong to that course
--    * the course's own instructor cannot enroll
--    * if the student already has a PENDING enrollment in the same batch it is
--      returned (so a closed Razorpay popup can simply be retried)
--    * any other open enrollment in the course -> 23505 (409)
--    * free course -> success payment row + active enrollment immediately
--    Capacity is enforced by triggers T-01 / T-02.
CREATE OR REPLACE FUNCTION fn_enroll_student(
    p_student_id INTEGER,
    p_course_id  INTEGER,
    p_batch_id   INTEGER
)
RETURNS INTEGER AS $$
DECLARE
    v_price          DECIMAL(10,2);
    v_course_status  course_status_enum;
    v_instructor_id  INTEGER;
    v_user_status    user_status_enum;
    v_batch_course   INTEGER;
    v_ex_id          INTEGER;
    v_ex_batch       INTEGER;
    v_ex_status      enrollment_status_enum;
    v_enrollment_id  INTEGER;
BEGIN
    SELECT price, status, instructor_id INTO v_price, v_course_status, v_instructor_id
      FROM courses WHERE course_id = p_course_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Course % does not exist', p_course_id USING ERRCODE = 'P0002';
    END IF;
    IF v_course_status <> 'published' THEN
        RAISE EXCEPTION 'Course is not open for enrollment' USING ERRCODE = 'P0001';
    END IF;

    SELECT status INTO v_user_status FROM users WHERE user_id = p_student_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User % does not exist', p_student_id USING ERRCODE = 'P0002';
    END IF;
    IF v_user_status <> 'active' THEN
        RAISE EXCEPTION 'Account is not active' USING ERRCODE = '42501';
    END IF;
    IF v_instructor_id = p_student_id THEN
        RAISE EXCEPTION 'Instructors cannot enroll in their own course' USING ERRCODE = 'P0001';
    END IF;

    SELECT course_id INTO v_batch_course FROM batches WHERE batch_id = p_batch_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Batch % does not exist', p_batch_id USING ERRCODE = 'P0002';
    END IF;
    IF v_batch_course <> p_course_id THEN
        RAISE EXCEPTION 'Batch does not belong to this course' USING ERRCODE = 'P0001';
    END IF;

    -- Existing open enrollment in this course?
    SELECT enrollment_id, batch_id, status INTO v_ex_id, v_ex_batch, v_ex_status
      FROM enrollments
     WHERE student_id = p_student_id AND course_id = p_course_id AND status <> 'dropped'
     FOR UPDATE;
    IF FOUND THEN
        IF v_ex_status = 'pending' AND v_ex_batch = p_batch_id THEN
            RETURN v_ex_id;                       -- resume the unpaid enrollment
        END IF;
        RAISE EXCEPTION 'Already enrolled in this course' USING ERRCODE = '23505';
    END IF;

    -- Triggers T-01 / T-02 guard and track capacity
    INSERT INTO enrollments (student_id, course_id, batch_id, status)
    VALUES (p_student_id, p_course_id, p_batch_id, 'pending')
    RETURNING enrollment_id INTO v_enrollment_id;

    IF v_price = 0.00 THEN
        INSERT INTO payments (enrollment_id, amount, payment_method, status, transaction_id, gateway, paid_at)
        VALUES (v_enrollment_id, 0.00, 'free', 'success',
                'FREE-' || v_enrollment_id || '-' || EXTRACT(EPOCH FROM now())::BIGINT,
                'system', now());

        UPDATE enrollments SET status = 'active' WHERE enrollment_id = v_enrollment_id;
    END IF;

    RETURN v_enrollment_id;
END;
$$ LANGUAGE plpgsql;

-- 8. Start a payment attempt for a PENDING enrollment owned by the caller.
--    Returns the amount to charge so the API never trusts the client.
--    Call BEFORE creating the Razorpay order, then fn_attach_gateway_order().
CREATE OR REPLACE FUNCTION fn_begin_payment(p_enrollment_id INTEGER, p_student_id INTEGER)
RETURNS TABLE (enrollment_id INTEGER, course_id INTEGER, title VARCHAR, amount DECIMAL) AS $$
#variable_conflict use_column
DECLARE
    v_status    enrollment_status_enum;
    v_course_id INTEGER;
BEGIN
    SELECT e.status, e.course_id INTO v_status, v_course_id
      FROM enrollments e
     WHERE e.enrollment_id = p_enrollment_id AND e.student_id = p_student_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Enrollment not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_status <> 'pending' THEN
        RAISE EXCEPTION 'Enrollment is % and cannot be paid for', v_status USING ERRCODE = 'P0001';
    END IF;

    RETURN QUERY
        SELECT p_enrollment_id, c.course_id, c.title::VARCHAR, c.price
          FROM courses c WHERE c.course_id = v_course_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- 9. Record the Razorpay order for an enrollment as a new pending attempt.
CREATE OR REPLACE FUNCTION fn_attach_gateway_order(
    p_enrollment_id INTEGER,
    p_order_id      VARCHAR,
    p_amount        DECIMAL,
    p_currency      CHAR(3) DEFAULT 'INR'
)
RETURNS INTEGER AS $$
DECLARE
    v_payment_id INTEGER;
BEGIN
    INSERT INTO payments (enrollment_id, amount, currency, status, gateway, gateway_order_id)
    VALUES (p_enrollment_id, p_amount, p_currency, 'pending', 'razorpay', p_order_id)
    RETURNING payment_id INTO v_payment_id;
    RETURN v_payment_id;
END;
$$ LANGUAGE plpgsql;

-- 10. Confirm a payment (idempotent; safe for both verify and webhook retries).
--     p_gateway_payment_id is the Razorpay PAYMENT id; the order id stays in
--     gateway_order_id so later lookups by order id keep working.
CREATE OR REPLACE FUNCTION fn_confirm_payment(
    p_payment_id         INTEGER,
    p_gateway_payment_id VARCHAR,
    p_gateway            VARCHAR DEFAULT 'razorpay',
    p_method             payment_method_enum DEFAULT 'card'
)
RETURNS VOID AS $$
DECLARE
    v_enrollment_id  INTEGER;
    v_pay_status     payment_status_enum;
    v_enr_status     enrollment_status_enum;
    v_student_id     INTEGER;
    v_title          VARCHAR(255);
BEGIN
    SELECT enrollment_id INTO v_enrollment_id FROM payments WHERE payment_id = p_payment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment record % not found', p_payment_id USING ERRCODE = 'P0002';
    END IF;

    -- lock order: enrollment, then payment
    SELECT e.status, e.student_id, c.title INTO v_enr_status, v_student_id, v_title
      FROM enrollments e JOIN courses c ON c.course_id = e.course_id
     WHERE e.enrollment_id = v_enrollment_id
     FOR UPDATE OF e;

    SELECT status INTO v_pay_status FROM payments WHERE payment_id = p_payment_id FOR UPDATE;

    IF v_pay_status = 'success' THEN
        RETURN;                                   -- already confirmed
    END IF;

    IF v_enr_status = 'dropped' THEN
        -- Seat was released (user dropped / pending enrollment expired) but money
        -- was captured: needs a manual refund, do not silently re-seat.
        RAISE EXCEPTION 'Enrollment % was dropped or expired; payment needs manual refund', v_enrollment_id
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE payments
       SET status = 'success',
           transaction_id = p_gateway_payment_id,
           gateway = p_gateway,
           payment_method = p_method,
           paid_at = now()
     WHERE payment_id = p_payment_id;

    -- other open attempts for the same enrollment are now moot
    UPDATE payments SET status = 'failed'
     WHERE enrollment_id = v_enrollment_id AND payment_id <> p_payment_id AND status = 'pending';

    UPDATE enrollments SET status = 'active'
     WHERE enrollment_id = v_enrollment_id AND status = 'pending';

    INSERT INTO notifications (user_id, title, message, type)
    VALUES (v_student_id,
            'Payment Confirmed & Enrollment Active',
            'Your payment for ' || v_title || ' was confirmed successfully.',
            'payment');
END;
$$ LANGUAGE plpgsql;

-- 11. Drop an enrollment (student-initiated). Ownership is enforced here.
--     Only pending/active enrollments can be dropped; the seat is released once.
CREATE OR REPLACE FUNCTION fn_drop_enrollment(
    p_enrollment_id INTEGER,
    p_student_id    INTEGER,
    p_reason        VARCHAR DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
    v_status   enrollment_status_enum;
    v_batch_id INTEGER;
    v_title    VARCHAR(255);
BEGIN
    SELECT e.status, e.batch_id, c.title INTO v_status, v_batch_id, v_title
      FROM enrollments e JOIN courses c ON c.course_id = e.course_id
     WHERE e.enrollment_id = p_enrollment_id AND e.student_id = p_student_id
     FOR UPDATE OF e;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Enrollment % not found', p_enrollment_id USING ERRCODE = 'P0002';
    END IF;
    IF v_status NOT IN ('pending', 'active') THEN
        RAISE EXCEPTION 'A % enrollment cannot be dropped', v_status USING ERRCODE = 'P0001';
    END IF;

    UPDATE enrollments SET status = 'dropped' WHERE enrollment_id = p_enrollment_id;

    UPDATE payments SET status = 'failed'
     WHERE enrollment_id = p_enrollment_id AND status = 'pending';

    UPDATE batches
       SET current_capacity = GREATEST(current_capacity - 1, 0),
           status = CASE WHEN status = 'full' THEN 'open'::batch_status_enum ELSE status END
     WHERE batch_id = v_batch_id;

    INSERT INTO notifications (user_id, title, message, type)
    VALUES (p_student_id,
            'Enrollment Dropped',
            'Your enrollment for ' || v_title || ' was dropped. Reason: ' || COALESCE(NULLIF(btrim(p_reason), ''), 'User request'),
            'enrollment');
END;
$$ LANGUAGE plpgsql;

-- 12. Release seats held by PENDING enrollments that were never paid.
--     Call from the server on a timer (e.g. every 5 minutes), or from pg_cron:
--         SELECT cron.schedule('expire-pending', '*/5 * * * *',
--                              'SELECT fn_expire_pending_enrollments(30)');
--     Returns how many enrollments were expired.
CREATE OR REPLACE FUNCTION fn_expire_pending_enrollments(p_minutes INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    r       RECORD;
    v_count INTEGER := 0;
BEGIN
    FOR r IN
        SELECT e.enrollment_id, e.student_id, e.batch_id, c.title
          FROM enrollments e JOIN courses c ON c.course_id = e.course_id
         WHERE e.status = 'pending'
           AND e.enroll_date < now() - make_interval(mins => p_minutes)
         FOR UPDATE OF e SKIP LOCKED
    LOOP
        UPDATE enrollments SET status = 'dropped' WHERE enrollment_id = r.enrollment_id;

        UPDATE payments SET status = 'failed'
         WHERE enrollment_id = r.enrollment_id AND status = 'pending';

        UPDATE batches
           SET current_capacity = GREATEST(current_capacity - 1, 0),
               status = CASE WHEN status = 'full' THEN 'open'::batch_status_enum ELSE status END
         WHERE batch_id = r.batch_id;

        INSERT INTO notifications (user_id, title, message, type)
        VALUES (r.student_id,
                'Enrollment Expired',
                'Your enrollment for ' || r.title || ' expired because payment was not completed. You can enroll again.',
                'enrollment');

        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- LEARNING PROGRESS
-- ---------------------------------------------------------------------------

-- 13. Upsert progress. The DB now enforces:
--       * enrollment must be active or completed
--       * the content must belong to the enrollment's course
--       * watch_duration is clamped to [0, duration_sec]
--       * the 80 % rule: a video only counts as completed when watch time
--         reaches 80 % of its duration (items with no duration, e.g. PDFs,
--         complete when the caller says so)
--     Ownership (enrollment belongs to the logged-in user) must still be
--     checked by the API, e.g. via fn_enrollment_belongs_to().
CREATE OR REPLACE FUNCTION fn_upsert_progress(
    p_enrollment_id  INTEGER,
    p_content_id     INTEGER,
    p_watch_duration INTEGER,
    p_completed      BOOLEAN
)
RETURNS VOID AS $$
DECLARE
    v_enr_status     enrollment_status_enum;
    v_enr_course     INTEGER;
    v_content_course INTEGER;
    v_duration       INTEGER;
    v_watch          INTEGER;
    v_completed      BOOLEAN;
BEGIN
    SELECT status, course_id INTO v_enr_status, v_enr_course
      FROM enrollments WHERE enrollment_id = p_enrollment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Enrollment % not found', p_enrollment_id USING ERRCODE = 'P0002';
    END IF;
    IF v_enr_status NOT IN ('active', 'completed') THEN
        RAISE EXCEPTION 'Enrollment is % - progress cannot be recorded', v_enr_status USING ERRCODE = 'P0001';
    END IF;

    SELECT m.course_id, c.duration_sec INTO v_content_course, v_duration
      FROM content c JOIN content_modules m ON m.module_id = c.module_id
     WHERE c.content_id = p_content_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Content % not found', p_content_id USING ERRCODE = 'P0002';
    END IF;
    IF v_content_course <> v_enr_course THEN
        RAISE EXCEPTION 'Content does not belong to this course' USING ERRCODE = 'P0001';
    END IF;

    v_watch := GREATEST(0, COALESCE(p_watch_duration, 0));
    IF v_duration IS NOT NULL AND v_duration > 0 THEN
        v_watch := LEAST(v_watch, v_duration);
    END IF;

    v_completed := COALESCE(p_completed, FALSE)
                   AND (v_duration IS NULL OR v_duration = 0 OR v_watch >= v_duration * 0.8);

    INSERT INTO progress (enrollment_id, content_id, watch_duration, completed, completed_at, last_accessed_at)
    VALUES (p_enrollment_id, p_content_id, v_watch, v_completed,
            CASE WHEN v_completed THEN now() ELSE NULL END, now())
    ON CONFLICT (enrollment_id, content_id) DO UPDATE
    SET watch_duration   = GREATEST(progress.watch_duration, EXCLUDED.watch_duration),
        completed        = progress.completed OR EXCLUDED.completed,
        completed_at     = CASE
                               WHEN progress.completed THEN progress.completed_at
                               WHEN EXCLUDED.completed THEN now()
                               ELSE NULL
                           END,
        last_accessed_at = now();
END;
$$ LANGUAGE plpgsql;

-- 14. Ownership helper for progress / payment / drop endpoints.
CREATE OR REPLACE FUNCTION fn_enrollment_belongs_to(p_enrollment_id INTEGER, p_user_id INTEGER)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (SELECT 1 FROM enrollments
                    WHERE enrollment_id = p_enrollment_id AND student_id = p_user_id);
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- ANNOUNCEMENTS
-- ---------------------------------------------------------------------------

-- 15. Post an announcement and notify every active student of the course.
--     Only the course's instructor (or an admin) may post (42501 otherwise).
CREATE OR REPLACE FUNCTION fn_create_announcement(
    p_course_id INTEGER,
    p_author_id INTEGER,
    p_title     VARCHAR,
    p_content   TEXT
)
RETURNS INTEGER AS $$
DECLARE
    v_id INTEGER;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM courses WHERE course_id = p_course_id) THEN
        RAISE EXCEPTION 'Course % does not exist', p_course_id USING ERRCODE = 'P0002';
    END IF;
    IF NOT fn_can_manage_course(p_course_id, p_author_id) THEN
        RAISE EXCEPTION 'Not allowed to post announcements for this course' USING ERRCODE = '42501';
    END IF;

    INSERT INTO announcements (course_id, author_id, title, content)
    VALUES (p_course_id, p_author_id, btrim(p_title), p_content)
    RETURNING announcement_id INTO v_id;

    INSERT INTO notifications (user_id, title, message, type)
    SELECT DISTINCT e.student_id, 'New Announcement', btrim(p_title), 'announcement'::notification_type_enum
      FROM enrollments e
     WHERE e.course_id = p_course_id AND e.status IN ('active', 'completed');

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;


-- Closes batches whose end_date has passed so they stop appearing as joinable (F12).
-- Called by the server's periodic job; safe to run any time.
CREATE OR REPLACE FUNCTION fn_close_ended_batches()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE batches SET status = 'closed'
     WHERE status <> 'closed' AND end_date < CURRENT_DATE;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;
