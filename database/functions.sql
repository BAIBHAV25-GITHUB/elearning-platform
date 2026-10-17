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
-- (fn_register_user is defined below with the instructor-approval step)

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

-- Admin user management (IMPROVEMENTS.md P0-5) --------------------------------------------------------

-- Paged user list for the admin area. p_search matches name or email (LIKE wildcards in it are escaped);
-- p_role / p_status / p_search may be NULL = no filter. Never returns the password hash.
-- (fn_list_users is defined below with the instructor_status filter)

-- Activate / deactivate / ban an account. The rules live here so no caller can bypass them:
--   * the caller must be an admin                      (42501)
--   * the target must exist                            (P0002)
--   * an admin cannot change their own status          (P0001)
--   * admin accounts cannot be changed through this    (P0001)
-- Returns the previous and the new status so the API can write a real audit-log entry.
CREATE OR REPLACE FUNCTION fn_set_user_status(
    p_admin_id INTEGER,
    p_user_id  INTEGER,
    p_status   user_status_enum
)
RETURNS TABLE (user_id INTEGER, user_name VARCHAR, email VARCHAR,
               old_status user_status_enum, status user_status_enum, role TEXT) AS $$
DECLARE
    v_old  user_status_enum;
    v_role TEXT;
BEGIN
    IF fn_user_role(p_admin_id) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Only an admin can change an account status' USING ERRCODE = '42501';
    END IF;

    SELECT u.status INTO v_old FROM users u WHERE u.user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User % not found', p_user_id USING ERRCODE = 'P0002';
    END IF;
    IF p_user_id = p_admin_id THEN
        RAISE EXCEPTION 'You cannot change your own account status' USING ERRCODE = 'P0001';
    END IF;

    v_role := fn_user_role(p_user_id);
    IF v_role = 'admin' THEN
        RAISE EXCEPTION 'Admin accounts cannot be changed here' USING ERRCODE = 'P0001';
    END IF;

    UPDATE users SET status = p_status WHERE users.user_id = p_user_id;

    RETURN QUERY
        SELECT u.user_id, u.user_name, u.email, v_old, u.status, v_role
          FROM users u WHERE u.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- Role change / instructor approval / course reassignment (step 4, second half) ----------------------

-- Self-registration: an instructor starts as 'pending' and cannot create or publish courses until an
-- admin approves the account.
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
    INSERT INTO users (user_name, email, password, instructor_status)
    VALUES (btrim(p_name), lower(btrim(p_email)), p_password_hash,
            CASE WHEN v_role = 'instructor' THEN 'pending' ELSE NULL END)
    RETURNING users.user_id INTO v_user_id;

    INSERT INTO user_roles (user_id, role_id) VALUES (v_user_id, v_role_id);

    RETURN QUERY
        SELECT u.user_id, u.user_name, u.email, v_role
          FROM users u WHERE u.user_id = v_user_id;
END;
$$ LANGUAGE plpgsql;

-- Paged user list (now with instructor_status and an instructor_status filter).
DROP FUNCTION IF EXISTS fn_list_users(TEXT, TEXT, user_status_enum, INTEGER, INTEGER);
CREATE OR REPLACE FUNCTION fn_list_users(
    p_search            TEXT,
    p_role              TEXT,
    p_status            user_status_enum,
    p_limit             INTEGER,
    p_offset            INTEGER,
    p_instructor_status TEXT DEFAULT NULL
)
RETURNS TABLE (user_id INTEGER, user_name VARCHAR, email VARCHAR,
               status user_status_enum, role TEXT, created_at TIMESTAMPTZ,
               instructor_status VARCHAR, total_count BIGINT) AS $$
    SELECT u.user_id, u.user_name, u.email, u.status, fn_user_role(u.user_id), u.created_at,
           u.instructor_status, count(*) OVER ()
      FROM users u
     WHERE (COALESCE(p_search, '') = ''
            OR u.user_name ILIKE '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            OR u.email     ILIKE '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%')
       AND (p_status IS NULL OR u.status = p_status)
       AND (p_role   IS NULL OR fn_user_role(u.user_id) = p_role)
       AND (p_instructor_status IS NULL OR u.instructor_status = p_instructor_status)
     ORDER BY u.created_at DESC, u.user_id DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$ LANGUAGE sql STABLE;

-- Switch an account between 'student' and 'instructor' (one role per account).
--   * caller must be an admin (42501); target must exist (P0002)
--   * not your own account, not an admin account, no 'admin' as target role (P0001)
--   * an instructor who still owns courses cannot become a student: reassign or delete them first (P0001)
--   * becoming an instructor through an admin is approved at once; becoming a student clears the approval
CREATE OR REPLACE FUNCTION fn_set_user_role(
    p_admin_id INTEGER,
    p_user_id  INTEGER,
    p_role     TEXT
)
RETURNS TABLE (user_id INTEGER, user_name VARCHAR, email VARCHAR,
               old_role TEXT, role TEXT, instructor_status VARCHAR) AS $$
#variable_conflict use_column
DECLARE
    v_old     TEXT;
    v_new     TEXT := lower(btrim(COALESCE(p_role, '')));
    v_role_id SMALLINT;
BEGIN
    IF fn_user_role(p_admin_id) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Only an admin can change a role' USING ERRCODE = '42501';
    END IF;
    IF v_new NOT IN ('student', 'instructor') THEN
        RAISE EXCEPTION 'Role must be student or instructor' USING ERRCODE = 'P0001';
    END IF;

    PERFORM 1 FROM users u WHERE u.user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User % not found', p_user_id USING ERRCODE = 'P0002';
    END IF;
    IF p_user_id = p_admin_id THEN
        RAISE EXCEPTION 'You cannot change your own role' USING ERRCODE = 'P0001';
    END IF;

    v_old := fn_user_role(p_user_id);
    IF v_old = 'admin' THEN
        RAISE EXCEPTION 'Admin accounts cannot be changed here' USING ERRCODE = 'P0001';
    END IF;

    IF v_old IS DISTINCT FROM v_new THEN
        IF v_old = 'instructor' AND EXISTS (SELECT 1 FROM courses c WHERE c.instructor_id = p_user_id) THEN
            RAISE EXCEPTION 'This instructor still owns courses. Reassign or delete them before making the account a student.'
                USING ERRCODE = 'P0001';
        END IF;

        SELECT r.role_id INTO v_role_id FROM roles r WHERE lower(r.role_name) = v_new;
        IF v_role_id IS NULL THEN
            RAISE EXCEPTION 'Role "%" is not configured', v_new USING ERRCODE = 'P0002';
        END IF;

        DELETE FROM user_roles ur WHERE ur.user_id = p_user_id;
        INSERT INTO user_roles (user_id, role_id) VALUES (p_user_id, v_role_id);

        UPDATE users u
           SET instructor_status = CASE WHEN v_new = 'instructor' THEN 'approved' ELSE NULL END
         WHERE u.user_id = p_user_id;
    END IF;

    RETURN QUERY
        SELECT u.user_id, u.user_name, u.email, v_old, v_new, u.instructor_status
          FROM users u WHERE u.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- Approve or reject an instructor account (decision 'approved' | 'rejected'; can be changed later).
-- Only accounts whose role is instructor can be reviewed. Returns the old and the new decision.
CREATE OR REPLACE FUNCTION fn_review_instructor(
    p_admin_id INTEGER,
    p_user_id  INTEGER,
    p_decision TEXT
)
RETURNS TABLE (user_id INTEGER, user_name VARCHAR, email VARCHAR,
               old_instructor_status VARCHAR, instructor_status VARCHAR) AS $$
#variable_conflict use_column
DECLARE
    v_old VARCHAR;
    v_dec TEXT := lower(btrim(COALESCE(p_decision, '')));
BEGIN
    IF fn_user_role(p_admin_id) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Only an admin can review instructors' USING ERRCODE = '42501';
    END IF;
    IF v_dec NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'Decision must be approved or rejected' USING ERRCODE = 'P0001';
    END IF;

    SELECT u.instructor_status INTO v_old FROM users u WHERE u.user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User % not found', p_user_id USING ERRCODE = 'P0002';
    END IF;
    IF fn_user_role(p_user_id) IS DISTINCT FROM 'instructor' THEN
        RAISE EXCEPTION 'Only instructor accounts can be approved or rejected' USING ERRCODE = 'P0001';
    END IF;

    UPDATE users u SET instructor_status = v_dec WHERE u.user_id = p_user_id;

    RETURN QUERY
        SELECT u.user_id, u.user_name, u.email, v_old, u.instructor_status
          FROM users u WHERE u.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- Move a course to another instructor (admin only). The new owner must be an active, approved instructor
-- and must not be enrolled in this course. Students, batches and progress stay untouched.
CREATE OR REPLACE FUNCTION fn_reassign_course(
    p_admin_id      INTEGER,
    p_course_id     INTEGER,
    p_instructor_id INTEGER
)
RETURNS TABLE (course_id INTEGER, title VARCHAR, old_instructor_id INTEGER,
               instructor_id INTEGER, instructor_name VARCHAR) AS $$
#variable_conflict use_column
DECLARE
    v_old INTEGER;
BEGIN
    IF fn_user_role(p_admin_id) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Only an admin can reassign a course' USING ERRCODE = '42501';
    END IF;

    SELECT c.instructor_id INTO v_old FROM courses c WHERE c.course_id = p_course_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Course not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id = p_instructor_id) THEN
        RAISE EXCEPTION 'Instructor % not found', p_instructor_id USING ERRCODE = 'P0002';
    END IF;
    IF fn_user_role(p_instructor_id) IS DISTINCT FROM 'instructor' THEN
        RAISE EXCEPTION 'The new owner must be an instructor account' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM users u WHERE u.user_id = p_instructor_id
                  AND (u.status <> 'active' OR u.instructor_status IS DISTINCT FROM 'approved')) THEN
        RAISE EXCEPTION 'The new owner must be an active, approved instructor' USING ERRCODE = 'P0001';
    END IF;
    IF v_old = p_instructor_id THEN
        RAISE EXCEPTION 'This instructor already owns the course' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM enrollments e
                WHERE e.course_id = p_course_id AND e.student_id = p_instructor_id AND e.status <> 'dropped') THEN
        RAISE EXCEPTION 'That instructor is enrolled in this course as a student' USING ERRCODE = 'P0001';
    END IF;

    UPDATE courses c SET instructor_id = p_instructor_id WHERE c.course_id = p_course_id;

    RETURN QUERY
        SELECT c.course_id, c.title, v_old, c.instructor_id, u.user_name
          FROM courses c JOIN users u ON u.user_id = c.instructor_id
         WHERE c.course_id = p_course_id;
END;
$$ LANGUAGE plpgsql;

-- Refunds (IMPROVEMENTS.md P0-6) -----------------------------------------------------------------------

-- Admin payment list. p_needs_refund = TRUE shows only payments that were captured by the gateway but whose
-- enrollment was already dropped / expired (the old "MANUAL REFUND NEEDED" log line). Filters may be NULL.
CREATE OR REPLACE FUNCTION fn_list_payments(
    p_search       TEXT,
    p_status       payment_status_enum,
    p_needs_refund BOOLEAN,
    p_limit        INTEGER,
    p_offset       INTEGER
)
RETURNS TABLE (payment_id INTEGER, enrollment_id INTEGER, amount DECIMAL, currency CHAR(3),
               status payment_status_enum, payment_method payment_method_enum, transaction_id VARCHAR,
               needs_refund BOOLEAN, created_at TIMESTAMPTZ, paid_at TIMESTAMPTZ, refunded_at TIMESTAMPTZ,
               refund_reason TEXT, student_id INTEGER, student_name VARCHAR, student_email VARCHAR,
               course_id INTEGER, course_title VARCHAR, enrollment_status enrollment_status_enum,
               total_count BIGINT) AS $$
    SELECT p.payment_id, p.enrollment_id, p.amount, p.currency, p.status, p.payment_method, p.transaction_id,
           p.needs_refund, p.created_at, p.paid_at, p.refunded_at, p.refund_reason,
           u.user_id, u.user_name, u.email, c.course_id, c.title, e.status, count(*) OVER ()
      FROM payments p
      JOIN enrollments e ON e.enrollment_id = p.enrollment_id
      JOIN users u       ON u.user_id = e.student_id
      JOIN courses c     ON c.course_id = e.course_id
     WHERE (COALESCE(p_search, '') = ''
            OR u.user_name ILIKE '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            OR u.email     ILIKE '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            OR c.title     ILIKE '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            OR p.transaction_id = btrim(p_search))
       AND (p_status IS NULL OR p.status = p_status)
       AND (p_needs_refund IS NULL OR p.needs_refund = p_needs_refund)
     ORDER BY p.created_at DESC, p.payment_id DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$ LANGUAGE sql STABLE;

-- Called by the Razorpay webhook when money was captured but the enrollment can no longer be activated
-- (dropped / expired). Remembers the gateway payment id and marks the row so an admin sees it.
CREATE OR REPLACE FUNCTION fn_flag_payment_for_refund(p_payment_id INTEGER, p_gateway_payment_id VARCHAR)
RETURNS VOID AS $$
    UPDATE payments
       SET needs_refund   = TRUE,
           transaction_id = COALESCE(transaction_id, p_gateway_payment_id)
     WHERE payment_id = p_payment_id AND status IN ('pending', 'failed');
$$ LANGUAGE sql;

-- Checks that a payment may be refunded and returns what the gateway call needs. Rules:
--   * caller is an admin (42501); payment exists (P0002)
--   * not already refunded, not a free enrollment, a gateway payment id is known (P0001)
--   * the payment must be successful, or flagged needs_refund (captured but enrollment dead) (P0001)
--   * an enrollment that is already COMPLETED (certificate issued) is not refundable (P0001)
CREATE OR REPLACE FUNCTION fn_get_refund_target(p_admin_id INTEGER, p_payment_id INTEGER)
RETURNS TABLE (payment_id INTEGER, amount DECIMAL, transaction_id VARCHAR, enrollment_id INTEGER,
               student_id INTEGER, enrollment_status enrollment_status_enum) AS $$
#variable_conflict use_column
DECLARE
    v_p payments%ROWTYPE;
    v_e enrollments%ROWTYPE;
BEGIN
    IF fn_user_role(p_admin_id) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Only an admin can refund a payment' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_p FROM payments WHERE payments.payment_id = p_payment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_p.status = 'refunded' THEN
        RAISE EXCEPTION 'This payment is already refunded' USING ERRCODE = 'P0001';
    END IF;
    IF v_p.amount <= 0 OR v_p.payment_method = 'free' THEN
        RAISE EXCEPTION 'A free enrollment has nothing to refund' USING ERRCODE = 'P0001';
    END IF;
    IF v_p.status <> 'success' AND NOT v_p.needs_refund THEN
        RAISE EXCEPTION 'Only successful payments can be refunded' USING ERRCODE = 'P0001';
    END IF;
    IF v_p.transaction_id IS NULL THEN
        RAISE EXCEPTION 'This payment has no gateway payment id, so it cannot be refunded automatically' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO v_e FROM enrollments WHERE enrollments.enrollment_id = v_p.enrollment_id;
    IF v_e.status = 'completed' THEN
        RAISE EXCEPTION 'The student has completed this course (certificate issued), so it cannot be refunded' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT v_p.payment_id, v_p.amount, v_p.transaction_id, v_e.enrollment_id, v_e.student_id, v_e.status;
END;
$$ LANGUAGE plpgsql;

-- Records a refund that the gateway has accepted: payment -> 'refunded', a pending / active enrollment is
-- dropped (frees the seat, the student loses access) and the student gets a notification.
CREATE OR REPLACE FUNCTION fn_mark_payment_refunded(
    p_admin_id  INTEGER,
    p_payment_id INTEGER,
    p_refund_id VARCHAR,
    p_reason    TEXT
)
RETURNS TABLE (payment_id INTEGER, status payment_status_enum, enrollment_id INTEGER, student_id INTEGER, amount DECIMAL) AS $$
#variable_conflict use_column
DECLARE
    t RECORD;
    v_title VARCHAR;
BEGIN
    SELECT * INTO t FROM fn_get_refund_target(p_admin_id, p_payment_id);

    UPDATE payments
       SET status = 'refunded', refunded_at = now(), refund_id = p_refund_id,
           refund_reason = left(p_reason, 300), needs_refund = FALSE
     WHERE payments.payment_id = p_payment_id;

    IF t.enrollment_status IN ('pending', 'active') THEN
        PERFORM fn_drop_enrollment(t.enrollment_id, t.student_id, 'Refunded');
    END IF;

    SELECT c.title INTO v_title FROM enrollments e JOIN courses c ON c.course_id = e.course_id
     WHERE e.enrollment_id = t.enrollment_id;
    INSERT INTO notifications (user_id, title, message, type)
    VALUES (t.student_id, 'Payment refunded',
            'Your payment of INR ' || t.amount || ' for "' || v_title || '" was refunded. It can take 5-7 working days to reach your account.',
            'payment');

    RETURN QUERY SELECT p_payment_id, 'refunded'::payment_status_enum, t.enrollment_id, t.student_id, t.amount;
END;
$$ LANGUAGE plpgsql;

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


-- Course edit + lifecycle (IMPROVEMENTS.md P0-7) ------------------------------------------------------

-- Edit a course. p_patch is a JSON object; only the keys that are present are changed:
--   title, description, price, thumbnail_url   (description / thumbnail_url may be null to clear them)
-- Rules (so no caller can bypass them):
--   * the course must exist (P0002) and the caller must be its instructor or an admin (42501)
--   * an archived course is read-only until it is restored (P0001)
--   * the price is locked once any student has an enrollment that is not 'dropped' (P0001),
--     because pending / paid enrollments were made at the old price
CREATE OR REPLACE FUNCTION fn_update_course(
    p_course_id INTEGER,
    p_user_id   INTEGER,
    p_patch     JSONB
)
RETURNS SETOF courses AS $$
DECLARE
    v_course courses%ROWTYPE;
    v_title  TEXT;
    v_price  NUMERIC;
BEGIN
    SELECT * INTO v_course FROM courses WHERE course_id = p_course_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Course not found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT fn_can_manage_course(p_course_id, p_user_id) THEN
        RAISE EXCEPTION 'You do not manage this course' USING ERRCODE = '42501';
    END IF;
    IF v_course.status = 'archived' THEN
        RAISE EXCEPTION 'An archived course cannot be edited. Restore it first.' USING ERRCODE = 'P0001';
    END IF;

    IF p_patch ? 'title' THEN
        v_title := btrim(p_patch ->> 'title');
        IF v_title IS NULL OR v_title = '' OR length(v_title) > 255 THEN
            RAISE EXCEPTION 'Course title is required (max 255 characters)' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    IF p_patch ? 'price' THEN
        v_price := (p_patch ->> 'price')::NUMERIC;
        IF v_price IS NULL OR v_price < 0 THEN
            RAISE EXCEPTION 'Price must be 0 or more' USING ERRCODE = 'P0001';
        END IF;
        IF v_price IS DISTINCT FROM v_course.price
           AND EXISTS (SELECT 1 FROM enrollments e
                        WHERE e.course_id = p_course_id AND e.status <> 'dropped') THEN
            RAISE EXCEPTION 'The price cannot be changed once students have enrolled in this course' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    UPDATE courses c
       SET title         = CASE WHEN p_patch ? 'title'         THEN v_title                    ELSE c.title END,
           description   = CASE WHEN p_patch ? 'description'   THEN p_patch ->> 'description'   ELSE c.description END,
           price         = CASE WHEN p_patch ? 'price'         THEN v_price                    ELSE c.price END,
           thumbnail_url = CASE WHEN p_patch ? 'thumbnail_url' THEN p_patch ->> 'thumbnail_url' ELSE c.thumbnail_url END
     WHERE c.course_id = p_course_id;

    RETURN QUERY SELECT * FROM courses WHERE course_id = p_course_id;
END;
$$ LANGUAGE plpgsql;

-- Change a course's status: draft <-> published <-> archived.
--   * publishing needs at least one 'ready' lesson and one joinable batch (open, not ended)
--   * moving a course back to draft is blocked while students are enrolled (active / completed),
--     because they would lose access; archive it instead (existing students keep their access,
--     new enrollments are blocked)
-- Errors: P0002 not found, 42501 not allowed, P0001 rule violated (message is shown to the user).
CREATE OR REPLACE FUNCTION fn_set_course_status(
    p_course_id INTEGER,
    p_user_id   INTEGER,
    p_status    course_status_enum
)
RETURNS SETOF courses AS $$
DECLARE
    v_course courses%ROWTYPE;
BEGIN
    SELECT * INTO v_course FROM courses WHERE course_id = p_course_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Course not found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT fn_can_manage_course(p_course_id, p_user_id) THEN
        RAISE EXCEPTION 'You do not manage this course' USING ERRCODE = '42501';
    END IF;

    IF v_course.status = p_status THEN
        RETURN NEXT v_course;   -- nothing to do
        RETURN;
    END IF;

    IF p_status = 'published' THEN
        IF NOT EXISTS (SELECT 1 FROM content_modules m JOIN content ct ON ct.module_id = m.module_id
                        WHERE m.course_id = p_course_id AND ct.status = 'ready') THEN
            RAISE EXCEPTION 'Add at least one ready lesson before publishing' USING ERRCODE = 'P0001';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM batches b
                        WHERE b.course_id = p_course_id AND b.status = 'open' AND b.end_date >= CURRENT_DATE) THEN
            RAISE EXCEPTION 'Add at least one open batch (end date not passed) before publishing' USING ERRCODE = 'P0001';
        END IF;
    ELSIF p_status = 'draft' THEN
        IF EXISTS (SELECT 1 FROM enrollments e
                    WHERE e.course_id = p_course_id AND e.status IN ('active', 'completed')) THEN
            RAISE EXCEPTION 'Students are enrolled in this course, so it cannot go back to draft. Archive it instead.' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    UPDATE courses SET status = p_status WHERE course_id = p_course_id;
    RETURN QUERY SELECT * FROM courses WHERE course_id = p_course_id;
END;
$$ LANGUAGE plpgsql;


-- Module edit / reorder / delete, batch edit / close, course delete (IMPROVEMENTS.md P0-7, second half) ----

-- Edit a module's title / description. p_patch keys present are changed.
CREATE OR REPLACE FUNCTION fn_update_module(
    p_course_id INTEGER,
    p_module_id INTEGER,
    p_user_id   INTEGER,
    p_patch     JSONB
)
RETURNS SETOF content_modules AS $$
DECLARE
    v_title TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM content_modules WHERE module_id = p_module_id AND course_id = p_course_id) THEN
        RAISE EXCEPTION 'Module not found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT fn_can_manage_course(p_course_id, p_user_id) THEN
        RAISE EXCEPTION 'You do not manage this course' USING ERRCODE = '42501';
    END IF;
    IF (SELECT status FROM courses WHERE course_id = p_course_id) = 'archived' THEN
        RAISE EXCEPTION 'An archived course cannot be edited. Restore it first.' USING ERRCODE = 'P0001';
    END IF;
    IF p_patch ? 'title' THEN
        v_title := btrim(p_patch ->> 'title');
        IF v_title IS NULL OR v_title = '' OR length(v_title) > 200 THEN
            RAISE EXCEPTION 'Module title is required (max 200 characters)' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    UPDATE content_modules m
       SET title       = CASE WHEN p_patch ? 'title'       THEN v_title                  ELSE m.title END,
           description = CASE WHEN p_patch ? 'description' THEN p_patch ->> 'description' ELSE m.description END
     WHERE m.module_id = p_module_id;

    RETURN QUERY SELECT * FROM content_modules WHERE module_id = p_module_id;
END;
$$ LANGUAGE plpgsql;

-- Reorder: p_module_ids must list EVERY module of the course exactly once, in the new order.
-- Sequence numbers become 1..n. The unique key is checked at the end of the statement set
-- (DEFERRED), so the numbers can swap without colliding.
CREATE OR REPLACE FUNCTION fn_reorder_modules(
    p_course_id   INTEGER,
    p_user_id     INTEGER,
    p_module_ids  INTEGER[]
)
RETURNS VOID AS $$
DECLARE
    v_existing INTEGER[];
BEGIN
    IF NOT EXISTS (SELECT 1 FROM courses WHERE course_id = p_course_id) THEN
        RAISE EXCEPTION 'Course not found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT fn_can_manage_course(p_course_id, p_user_id) THEN
        RAISE EXCEPTION 'You do not manage this course' USING ERRCODE = '42501';
    END IF;
    IF (SELECT status FROM courses WHERE course_id = p_course_id) = 'archived' THEN
        RAISE EXCEPTION 'An archived course cannot be edited. Restore it first.' USING ERRCODE = 'P0001';
    END IF;

    -- lock the course's modules first; FOR UPDATE cannot be combined with array_agg in one statement
    PERFORM 1 FROM content_modules WHERE course_id = p_course_id FOR UPDATE;
    SELECT array_agg(module_id ORDER BY module_id) INTO v_existing
      FROM content_modules WHERE course_id = p_course_id;

    IF v_existing IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(p_module_ids) AS x) THEN
        RAISE EXCEPTION 'The new order must list every module of this course exactly once' USING ERRCODE = 'P0001';
    END IF;

    SET CONSTRAINTS uq_module_seq DEFERRED;
    UPDATE content_modules m
       SET sequence_no = o.ord
      FROM unnest(p_module_ids) WITH ORDINALITY AS o(module_id, ord)
     WHERE m.module_id = o.module_id;
END;
$$ LANGUAGE plpgsql;

-- Edit a batch. p_patch keys (all optional): batch_name, start_date, end_date, max_capacity, status
--   * status may be 'open' or 'closed' ('full' is set by the system); closing is allowed any time,
--     existing students keep their seat; reopening needs end_date today or later
--   * max_capacity cannot go below the seats already taken
--   * a batch that has reached max_capacity becomes 'full', one that has free seats again becomes 'open'
CREATE OR REPLACE FUNCTION fn_update_batch(
    p_batch_id  INTEGER,
    p_user_id   INTEGER,
    p_patch     JSONB
)
RETURNS SETOF batches AS $$
DECLARE
    v_b      batches%ROWTYPE;
    v_name   TEXT;
    v_start  DATE;
    v_end    DATE;
    v_cap    INTEGER;
    v_status batch_status_enum;
BEGIN
    SELECT * INTO v_b FROM batches WHERE batch_id = p_batch_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Batch not found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT fn_can_manage_course(v_b.course_id, p_user_id) THEN
        RAISE EXCEPTION 'You do not manage this course' USING ERRCODE = '42501';
    END IF;
    IF (SELECT status FROM courses WHERE course_id = v_b.course_id) = 'archived' THEN
        RAISE EXCEPTION 'An archived course cannot be edited. Restore it first.' USING ERRCODE = 'P0001';
    END IF;

    v_name   := CASE WHEN p_patch ? 'batch_name'   THEN btrim(p_patch ->> 'batch_name')    ELSE v_b.batch_name END;
    v_start  := CASE WHEN p_patch ? 'start_date'   THEN (p_patch ->> 'start_date')::DATE   ELSE v_b.start_date END;
    v_end    := CASE WHEN p_patch ? 'end_date'     THEN (p_patch ->> 'end_date')::DATE     ELSE v_b.end_date END;
    v_cap    := CASE WHEN p_patch ? 'max_capacity' THEN (p_patch ->> 'max_capacity')::INTEGER ELSE v_b.max_capacity END;
    v_status := CASE WHEN p_patch ? 'status'       THEN (p_patch ->> 'status')::batch_status_enum ELSE v_b.status END;

    IF v_name IS NULL OR v_name = '' OR length(v_name) > 100 THEN
        RAISE EXCEPTION 'Batch name is required (max 100 characters)' USING ERRCODE = 'P0001';
    END IF;
    IF v_end <= v_start THEN
        RAISE EXCEPTION 'The start date must be earlier than the end date' USING ERRCODE = 'P0001';
    END IF;
    IF v_cap < 1 OR v_cap > 30 THEN
        RAISE EXCEPTION 'Capacity must be between 1 and 30' USING ERRCODE = 'P0001';
    END IF;
    IF v_cap < v_b.current_capacity THEN
        RAISE EXCEPTION 'Capacity cannot be lower than the % seat(s) already taken', v_b.current_capacity USING ERRCODE = 'P0001';
    END IF;
    IF v_status NOT IN ('open', 'closed', 'full') OR (v_status = 'full' AND v_b.status <> 'full') THEN
        RAISE EXCEPTION 'Status must be open or closed' USING ERRCODE = 'P0001';
    END IF;

    IF v_status = 'closed' THEN
        NULL;  -- stays closed
    ELSE
        IF v_b.status = 'closed' AND v_end < CURRENT_DATE THEN
            RAISE EXCEPTION 'This batch has already ended. Move the end date forward to reopen it.' USING ERRCODE = 'P0001';
        END IF;
        IF v_end < CURRENT_DATE THEN
            v_status := 'closed';
        ELSIF v_b.current_capacity >= v_cap THEN
            v_status := 'full';
        ELSE
            v_status := 'open';
        END IF;
    END IF;

    UPDATE batches
       SET batch_name = v_name, start_date = v_start, end_date = v_end,
           max_capacity = v_cap, status = v_status
     WHERE batch_id = p_batch_id;

    RETURN QUERY SELECT * FROM batches WHERE batch_id = p_batch_id;
END;
$$ LANGUAGE plpgsql;

-- Anonymise (soft-delete) a user: GDPR-style erase without breaking payments / enrollments / certificates (migration 008)
CREATE OR REPLACE FUNCTION fn_anonymise_user(p_admin_id INTEGER, p_user_id INTEGER)
RETURNS TABLE (user_id INTEGER, role TEXT) AS $$
DECLARE
    v_role TEXT;
BEGIN
    IF fn_user_role(p_admin_id) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Only an admin can delete an account' USING ERRCODE = '42501';
    END IF;

    PERFORM 1 FROM users u WHERE u.user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User % not found', p_user_id USING ERRCODE = 'P0002';
    END IF;
    IF p_user_id = p_admin_id THEN
        RAISE EXCEPTION 'You cannot delete your own account here' USING ERRCODE = 'P0001';
    END IF;

    v_role := fn_user_role(p_user_id);
    IF v_role = 'admin' THEN
        RAISE EXCEPTION 'Admin accounts cannot be deleted here' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM users u WHERE u.user_id = p_user_id AND u.email LIKE 'deleted-%@deleted.invalid') THEN
        RAISE EXCEPTION 'This account is already deleted' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM courses c WHERE c.instructor_id = p_user_id AND c.status = 'published') THEN
        RAISE EXCEPTION 'This instructor still has published courses. Reassign or archive them first'
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE users
       SET user_name = 'Deleted user',
           email     = 'deleted-' || p_user_id || '@deleted.invalid',
           password  = '!deleted',          -- not a valid bcrypt hash: nobody can ever log in
           status    = 'inactive'
     WHERE users.user_id = p_user_id;

    DELETE FROM notifications n WHERE n.user_id = p_user_id;
    UPDATE audit_logs a SET ip_address = NULL WHERE a.user_id = p_user_id;

    RETURN QUERY SELECT p_user_id, v_role;
END;
$$ LANGUAGE plpgsql;
