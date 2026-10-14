-- E-Learning Platform: complete database setup (single script)
-- Creates the database, schema, functions, triggers, views, base seed data
-- and the Python course content (52 modules / 828 video parts).
--
-- Run ONCE as a superuser, from any database (e.g. "postgres"):
--   psql -U postgres -v ON_ERROR_STOP=1 -f elearning_full_setup.sql
--
-- Requires the psql client (uses \gexec and \connect). PostgreSQL 14+.
-- To rebuild from scratch, uncomment the DROP line below (destroys all data).
-- All seeded users share the password:  Password123!

-- DROP DATABASE IF EXISTS elearning_db WITH (FORCE);

SELECT 'CREATE DATABASE elearning_db'
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'elearning_db')\gexec

\connect elearning_db
\set ON_ERROR_STOP on

-- ======================================================================
-- 1. SCHEMA
-- ======================================================================
-- PostgreSQL Schema for E-Learning Platform
-- 11 ENUM types, 17 tables, constraints and indexes.
--
-- Run against an existing database (see 00_create_db.sql):
--   psql -U postgres -d elearning_db -v ON_ERROR_STOP=1 -f schema.sql
--
-- Design decisions in this version (vs. the first draft):
--   * ONE course title column (`title`); `course_name` was removed.
--   * All timestamps are TIMESTAMPTZ.
--   * Payments keep the Razorpay ORDER id (gateway_order_id) and the PAYMENT id
--     (transaction_id) in separate columns, and one enrollment may have several
--     payment attempts but only one successful payment.
--   * Dropped enrollments no longer block re-enrolling (partial unique indexes).
--   * enrollments(batch_id, course_id) is a composite FK, so a batch can never
--     be paired with a course it does not belong to.

-- 1. ENUM Types
CREATE TYPE user_status_enum        AS ENUM ('active', 'inactive', 'banned');
CREATE TYPE course_status_enum      AS ENUM ('draft', 'published', 'archived');
CREATE TYPE batch_status_enum       AS ENUM ('open', 'full', 'closed');
CREATE TYPE content_type_enum       AS ENUM ('video', 'pdf', 'text');
CREATE TYPE content_status_enum     AS ENUM ('uploading', 'processing', 'ready', 'error');
CREATE TYPE enrollment_status_enum  AS ENUM ('pending', 'active', 'completed', 'dropped');
CREATE TYPE payment_method_enum     AS ENUM ('card', 'upi', 'netbanking', 'wallet', 'free');
CREATE TYPE payment_status_enum     AS ENUM ('pending', 'success', 'failed', 'refunded');
CREATE TYPE notification_type_enum  AS ENUM ('enrollment', 'payment', 'certificate', 'announcement', 'system');
CREATE TYPE report_format_enum      AS ENUM ('pdf', 'csv', 'xlsx');
CREATE TYPE audit_action_enum       AS ENUM ('INSERT', 'UPDATE', 'DELETE');

-- 2. Core Identity Tables
CREATE TABLE roles (
    role_id     SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    role_name   VARCHAR(50) NOT NULL UNIQUE,
    description TEXT
);

CREATE TABLE users (
    user_id     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_name   VARCHAR(100) NOT NULL,
    email       VARCHAR(255) NOT NULL,
    password    VARCHAR(255) NOT NULL,          -- bcrypt hash, never plain text
    phone       VARCHAR(20),
    status      user_status_enum NOT NULL DEFAULT 'active',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_users_email CHECK (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$')
);
-- Case-insensitive uniqueness (Alice@x.com and alice@x.com are the same account)
CREATE UNIQUE INDEX uq_users_email_lower ON users (lower(email));

CREATE TABLE user_roles (
    user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
    role_id       SMALLINT NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE ON UPDATE CASCADE,
    assigned_date TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_id)
);

-- 3. Course Structure
CREATE TABLE courses (
    course_id     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    instructor_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    title         VARCHAR(255) NOT NULL,
    description   TEXT,
    price         DECIMAL(10,2) NOT NULL DEFAULT 0.00,   -- INR
    thumbnail_url TEXT,
    status        course_status_enum NOT NULL DEFAULT 'draft',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_courses_price CHECK (price >= 0),
    CONSTRAINT chk_courses_title CHECK (length(btrim(title)) > 0)
);

CREATE TABLE batches (
    batch_id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    course_id        INTEGER NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE ON UPDATE CASCADE,
    batch_name       VARCHAR(100) NOT NULL,
    start_date       DATE NOT NULL,
    end_date         DATE NOT NULL,
    max_capacity     SMALLINT NOT NULL DEFAULT 30,
    current_capacity SMALLINT NOT NULL DEFAULT 0,
    status           batch_status_enum NOT NULL DEFAULT 'open',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_batch_capacity CHECK (max_capacity BETWEEN 1 AND 30),
    CONSTRAINT chk_batch_dates CHECK (end_date > start_date),
    CONSTRAINT chk_batch_cur_cap CHECK (current_capacity BETWEEN 0 AND max_capacity),
    -- target for the composite FK from enrollments
    CONSTRAINT uq_batches_id_course UNIQUE (batch_id, course_id)
);

CREATE TABLE content_modules (
    module_id   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    course_id   INTEGER NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE ON UPDATE CASCADE,
    title       VARCHAR(200) NOT NULL,
    description TEXT,
    sequence_no SMALLINT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_module_seq UNIQUE (course_id, sequence_no),
    CONSTRAINT chk_module_seq CHECK (sequence_no > 0)
);

CREATE TABLE content (
    content_id    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    module_id     INTEGER NOT NULL REFERENCES content_modules(module_id) ON DELETE CASCADE ON UPDATE CASCADE,
    title         VARCHAR(200) NOT NULL,
    type          content_type_enum NOT NULL DEFAULT 'video',
    video_url     VARCHAR(512),
    cloudinary_id VARCHAR(255),
    duration_sec  INTEGER,
    sequence_no   SMALLINT NOT NULL,
    status        content_status_enum NOT NULL DEFAULT 'ready',
    CONSTRAINT uq_content_seq UNIQUE (module_id, sequence_no),
    CONSTRAINT chk_content_seq CHECK (sequence_no > 0),
    CONSTRAINT chk_content_dur CHECK (duration_sec IS NULL OR duration_sec >= 0)
);

-- 4. Enrollment & Payments
CREATE TABLE enrollments (
    enrollment_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    student_id    INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    course_id     INTEGER NOT NULL REFERENCES courses(course_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    batch_id      INTEGER NOT NULL,
    enroll_date   TIMESTAMPTZ NOT NULL DEFAULT now(),
    status        enrollment_status_enum NOT NULL DEFAULT 'pending',
    -- the batch must belong to the same course
    CONSTRAINT fk_enrollments_batch_course FOREIGN KEY (batch_id, course_id)
        REFERENCES batches(batch_id, course_id) ON DELETE RESTRICT ON UPDATE CASCADE
);
-- A student may hold ONE non-dropped enrollment per course. Dropped rows are
-- history only and do not block re-enrolling.
CREATE UNIQUE INDEX uq_enrollments_student_course_open
    ON enrollments (student_id, course_id) WHERE status <> 'dropped';

CREATE TABLE payments (
    payment_id       INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    enrollment_id    INTEGER NOT NULL REFERENCES enrollments(enrollment_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    amount           DECIMAL(10,2) NOT NULL,
    currency         CHAR(3) NOT NULL DEFAULT 'INR',
    payment_method   payment_method_enum,                 -- NULL until the gateway tells us
    status           payment_status_enum NOT NULL DEFAULT 'pending',
    gateway_order_id VARCHAR(255) UNIQUE,                 -- Razorpay order_xxx
    transaction_id   VARCHAR(255) UNIQUE,                 -- Razorpay pay_xxx (or FREE-...)
    gateway          VARCHAR(50),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at          TIMESTAMPTZ,
    CONSTRAINT chk_payments_amount CHECK (amount >= 0),
    CONSTRAINT chk_payments_method_when_paid CHECK (status <> 'success' OR payment_method IS NOT NULL)
);
-- Several attempts per enrollment are allowed, but only one can succeed.
CREATE UNIQUE INDEX uq_payments_one_success ON payments (enrollment_id) WHERE status = 'success';

-- 5. Learning Progress & Certificates
CREATE TABLE progress (
    progress_id      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    enrollment_id    INTEGER NOT NULL REFERENCES enrollments(enrollment_id) ON DELETE CASCADE ON UPDATE CASCADE,
    content_id       INTEGER NOT NULL REFERENCES content(content_id) ON DELETE CASCADE ON UPDATE CASCADE,
    watch_duration   INTEGER NOT NULL DEFAULT 0,
    completed        BOOLEAN NOT NULL DEFAULT FALSE,
    completed_at     TIMESTAMPTZ,
    last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_progress_enrl_content UNIQUE (enrollment_id, content_id),
    CONSTRAINT chk_progress_duration CHECK (watch_duration >= 0)
);

CREATE TABLE certificates (
    certificate_id  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    enrollment_id   INTEGER NOT NULL UNIQUE REFERENCES enrollments(enrollment_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    certificate_url VARCHAR(512) NOT NULL,
    issue_date      TIMESTAMPTZ NOT NULL DEFAULT now(),
    email_sent      BOOLEAN NOT NULL DEFAULT FALSE
);

-- 6. Communication
CREATE TABLE notifications (
    notification_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
    title           VARCHAR(200) NOT NULL,
    message         TEXT NOT NULL,
    type            notification_type_enum NOT NULL DEFAULT 'system',
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE comments (
    comment_id        INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    module_id         INTEGER NOT NULL REFERENCES content_modules(module_id) ON DELETE CASCADE ON UPDATE CASCADE,
    user_id           INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
    parent_comment_id INTEGER REFERENCES comments(comment_id) ON DELETE CASCADE ON UPDATE CASCADE,
    content           TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_comment_not_blank CHECK (length(btrim(content)) > 0)
);

CREATE TABLE announcements (
    announcement_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    course_id       INTEGER NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE ON UPDATE CASCADE,
    author_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    title           VARCHAR(200) NOT NULL,
    content         TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. Reporting & Audit
CREATE TABLE reports (
    report_id    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    report_type  VARCHAR(100) NOT NULL,
    format       report_format_enum NOT NULL DEFAULT 'pdf',
    generated_by INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    file_url     VARCHAR(512),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The API audit middleware writes one row per request, so record_id may be
-- NULL (e.g. a POST before the id is known) and old/new values and the client
-- IP are stored directly on the row.
CREATE TABLE audit_logs (
    log_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     INTEGER REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE,
    table_name  VARCHAR(100) NOT NULL,
    record_id   BIGINT,
    action_type audit_action_enum NOT NULL,
    old_values  JSONB,
    new_values  JSONB,
    ip_address  TEXT,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log_details (
    detail_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    log_id      BIGINT NOT NULL REFERENCES audit_logs(log_id) ON DELETE CASCADE ON UPDATE CASCADE,
    column_name VARCHAR(100) NOT NULL,
    old_val     TEXT,
    new_val     TEXT
);

-- 8. Indexes
CREATE INDEX idx_user_roles_role     ON user_roles(role_id);
CREATE INDEX idx_courses_instructor  ON courses(instructor_id);
CREATE INDEX idx_courses_status      ON courses(status);
CREATE INDEX idx_batches_course      ON batches(course_id);
CREATE INDEX idx_modules_course      ON content_modules(course_id);
CREATE INDEX idx_content_module      ON content(module_id);
CREATE INDEX idx_enrollments_student ON enrollments(student_id);
CREATE INDEX idx_enrollments_course  ON enrollments(course_id);
CREATE INDEX idx_enrollments_batch   ON enrollments(batch_id);
CREATE INDEX idx_enrollments_pending ON enrollments(enroll_date) WHERE status = 'pending';
CREATE INDEX idx_payments_enrollment ON payments(enrollment_id);
CREATE INDEX idx_progress_enrollment ON progress(enrollment_id);
CREATE INDEX idx_progress_content    ON progress(content_id);
CREATE INDEX idx_notif_user_read     ON notifications(user_id, is_read);
CREATE INDEX idx_comments_module     ON comments(module_id);
CREATE INDEX idx_announcements_course ON announcements(course_id);
CREATE INDEX idx_audit_ts            ON audit_logs("timestamp");

-- ======================================================================
-- 2. FUNCTIONS
-- ======================================================================
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

-- ======================================================================
-- 3. TRIGGERS
-- ======================================================================
-- PostgreSQL Triggers for E-Learning Platform
-- Run after functions.sql:  psql -U postgres -d elearning_db -v ON_ERROR_STOP=1 -f triggers.sql

-- Standard set_updated_at triggers
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_courses_updated_at
    BEFORE UPDATE ON courses
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- T-01: Capacity Guard on Enrollment (BEFORE INSERT ON enrollments)
CREATE OR REPLACE FUNCTION trg_enrollment_capacity_guard()
RETURNS TRIGGER AS $$
DECLARE
    v_max_cap SMALLINT;
    v_cur_cap SMALLINT;
    v_status  batch_status_enum;
BEGIN
    SELECT max_capacity, current_capacity, status
      INTO v_max_cap, v_cur_cap, v_status
      FROM batches
     WHERE batch_id = NEW.batch_id FOR UPDATE;

    IF v_status = 'closed' THEN
        RAISE EXCEPTION 'Cannot enroll in a closed batch' USING ERRCODE = 'P0001';
    END IF;

    IF v_cur_cap >= v_max_cap THEN
        RAISE EXCEPTION 'Batch capacity limit reached (% max)', v_max_cap USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_T01_enrollment_before_insert
    BEFORE INSERT ON enrollments
    FOR EACH ROW EXECUTE FUNCTION trg_enrollment_capacity_guard();

-- T-02: Increment Batch Capacity & Flip to Full (AFTER INSERT ON enrollments)
CREATE OR REPLACE FUNCTION trg_enrollment_increment_capacity()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE batches
       SET current_capacity = current_capacity + 1,
           status = CASE WHEN current_capacity + 1 >= max_capacity THEN 'full'::batch_status_enum ELSE status END
     WHERE batch_id = NEW.batch_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_T02_enrollment_after_insert
    AFTER INSERT ON enrollments
    FOR EACH ROW EXECUTE FUNCTION trg_enrollment_increment_capacity();

-- T-03: Decrement Capacity on Hard Delete (AFTER DELETE ON enrollments)
-- Only frees a seat if the row still held one (i.e. it was not already dropped,
-- because fn_drop_enrollment / fn_expire_pending_enrollments release it).
CREATE OR REPLACE FUNCTION trg_enrollment_decrement_capacity()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status <> 'dropped' THEN
        UPDATE batches
           SET current_capacity = GREATEST(current_capacity - 1, 0),
               status = CASE WHEN status = 'full' THEN 'open'::batch_status_enum ELSE status END
         WHERE batch_id = OLD.batch_id;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_T03_enrollment_after_delete
    AFTER DELETE ON enrollments
    FOR EACH ROW EXECUTE FUNCTION trg_enrollment_decrement_capacity();

-- T-04: Auto-Generate Certificates (AFTER INSERT and AFTER UPDATE of progress)
-- Fix vs. first draft: completed items are now counted only if the content is
-- itself 'ready', so total and completed are measured on the same set.
CREATE OR REPLACE FUNCTION trg_progress_check_completion()
RETURNS TRIGGER AS $$
DECLARE
    v_course_id         INTEGER;
    v_student_id        INTEGER;
    v_enr_status        enrollment_status_enum;
    v_total_content     INTEGER;
    v_completed_content INTEGER;
BEGIN
    SELECT course_id, student_id, status INTO v_course_id, v_student_id, v_enr_status
      FROM enrollments WHERE enrollment_id = NEW.enrollment_id;

    IF v_enr_status <> 'active' THEN
        RETURN NEW;                  -- completed already, or not entitled
    END IF;

    SELECT COUNT(c.content_id) INTO v_total_content
      FROM content c
      JOIN content_modules m ON c.module_id = m.module_id
     WHERE m.course_id = v_course_id AND c.status = 'ready';

    IF v_total_content = 0 THEN
        RETURN NEW;
    END IF;

    SELECT COUNT(p.progress_id) INTO v_completed_content
      FROM progress p
      JOIN content c ON p.content_id = c.content_id
      JOIN content_modules m ON c.module_id = m.module_id
     WHERE p.enrollment_id = NEW.enrollment_id
       AND m.course_id = v_course_id
       AND c.status = 'ready'
       AND p.completed = TRUE;

    IF v_completed_content >= v_total_content THEN
        -- enrollment_id is UNIQUE on certificates, so this is also race-safe
        INSERT INTO certificates (enrollment_id, user_id, certificate_url)
        VALUES (
            NEW.enrollment_id,
            v_student_id,
            'https://elearning.org/certificates/CERT-' || NEW.enrollment_id || '-' || EXTRACT(EPOCH FROM now())::BIGINT
        )
        ON CONFLICT (enrollment_id) DO NOTHING;

        IF FOUND THEN
            UPDATE enrollments SET status = 'completed' WHERE enrollment_id = NEW.enrollment_id;

            INSERT INTO notifications (user_id, title, message, type)
            VALUES (
                v_student_id,
                'Course Completed!',
                'Congratulations! You have completed all modules and your certificate has been issued.',
                'certificate'
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_T04_progress_after_insert
    AFTER INSERT ON progress
    FOR EACH ROW WHEN (NEW.completed = TRUE)
    EXECUTE FUNCTION trg_progress_check_completion();

CREATE TRIGGER trg_T04_progress_after_update
    AFTER UPDATE ON progress
    FOR EACH ROW WHEN (NEW.completed = TRUE AND OLD.completed = FALSE)
    EXECUTE FUNCTION trg_progress_check_completion();

-- T-05: Payment Guard - enrollment must exist and be pending/active
-- (BEFORE INSERT ON payments)
CREATE OR REPLACE FUNCTION trg_payment_enrollment_guard()
RETURNS TRIGGER AS $$
DECLARE
    v_status enrollment_status_enum;
BEGIN
    SELECT status INTO v_status FROM enrollments WHERE enrollment_id = NEW.enrollment_id;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Associated enrollment % does not exist', NEW.enrollment_id USING ERRCODE = 'P0002';
    END IF;

    IF v_status NOT IN ('pending', 'active') THEN
        RAISE EXCEPTION 'Cannot attach payment to enrollment in % status', v_status USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_T05_payment_before_insert
    BEFORE INSERT ON payments
    FOR EACH ROW EXECUTE FUNCTION trg_payment_enrollment_guard();

-- T-06: Comment replies must stay inside the same module (and stay 1 level deep)
CREATE OR REPLACE FUNCTION trg_comment_parent_guard()
RETURNS TRIGGER AS $$
DECLARE
    v_parent_module INTEGER;
    v_parent_parent INTEGER;
BEGIN
    IF NEW.parent_comment_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT module_id, parent_comment_id INTO v_parent_module, v_parent_parent
      FROM comments WHERE comment_id = NEW.parent_comment_id;

    IF v_parent_module IS DISTINCT FROM NEW.module_id THEN
        RAISE EXCEPTION 'Reply must belong to the same module as its parent' USING ERRCODE = 'P0001';
    END IF;
    IF v_parent_parent IS NOT NULL THEN
        RAISE EXCEPTION 'Nested replies are restricted to a maximum depth of 1 level' USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_T06_comment_before_insert
    BEFORE INSERT ON comments
    FOR EACH ROW EXECUTE FUNCTION trg_comment_parent_guard();

-- ======================================================================
-- 4. VIEWS
-- ======================================================================
-- PostgreSQL Analytical Views for E-Learning Platform
-- Run after triggers.sql:  psql -U postgres -d elearning_db -v ON_ERROR_STOP=1 -f views.sql
--
-- Column names match what the API/analytics code and the dashboard read:
--   course_title, completion_percentage, is_full, ...
-- instructor_id is exposed on every view so the API can scope rows
-- (WHERE instructor_id = $1 for instructors, no filter for admins).

-- 1. Batch Capacity View
CREATE OR REPLACE VIEW vw_batch_capacity AS
SELECT
    b.batch_id,
    b.batch_name,
    c.course_id,
    c.title AS course_title,
    c.instructor_id,
    b.max_capacity,
    b.current_capacity,
    (b.max_capacity - b.current_capacity) AS available_seats,
    (b.current_capacity >= b.max_capacity) AS is_full,
    b.status AS batch_status,
    b.start_date,
    b.end_date
FROM batches b
JOIN courses c ON b.course_id = c.course_id;

-- 2. Student Progress Analytics View (dropped enrollments excluded)
CREATE OR REPLACE VIEW vw_student_progress AS
SELECT
    e.enrollment_id,
    e.student_id,
    u.user_name  AS student_name,
    u.email      AS student_email,
    c.course_id,
    c.title      AS course_title,
    c.instructor_id,
    COUNT(cnt.content_id) AS total_contents,
    COUNT(p.progress_id) FILTER (WHERE p.completed = TRUE) AS completed_contents,
    ROUND(
        COALESCE(
            (COUNT(p.progress_id) FILTER (WHERE p.completed = TRUE)::NUMERIC
                / NULLIF(COUNT(cnt.content_id), 0)) * 100,
            0
        ),
        2
    ) AS completion_percentage,
    e.status AS enrollment_status
FROM enrollments e
JOIN users u ON e.student_id = u.user_id
JOIN courses c ON e.course_id = c.course_id
LEFT JOIN content_modules m ON c.course_id = m.course_id
LEFT JOIN content cnt ON m.module_id = cnt.module_id AND cnt.status = 'ready'
LEFT JOIN progress p ON e.enrollment_id = p.enrollment_id AND cnt.content_id = p.content_id
WHERE e.status <> 'dropped'
GROUP BY e.enrollment_id, e.student_id, u.user_name, u.email,
         c.course_id, c.title, c.instructor_id, e.status;

-- 3. Course Revenue View
CREATE OR REPLACE VIEW vw_course_revenue AS
SELECT
    c.course_id,
    c.title AS course_title,
    c.instructor_id,
    u.user_name AS instructor_name,
    COUNT(DISTINCT e.enrollment_id) FILTER (WHERE e.status <> 'dropped') AS total_enrollments,
    COUNT(DISTINCT p.payment_id)    FILTER (WHERE p.status = 'success')  AS successful_payments,
    COALESCE(SUM(p.amount)          FILTER (WHERE p.status = 'success'), 0.00) AS total_revenue
FROM courses c
JOIN users u ON c.instructor_id = u.user_id
LEFT JOIN enrollments e ON c.course_id = e.course_id
LEFT JOIN payments p ON e.enrollment_id = p.enrollment_id
GROUP BY c.course_id, c.title, c.instructor_id, u.user_name;

-- 4. Catalog view: published courses with instructor name (+ module/content counts)
CREATE OR REPLACE VIEW vw_published_courses AS
SELECT
    c.course_id,
    c.instructor_id,
    u.user_name AS instructor_name,
    c.title,
    c.description,
    c.price,
    c.thumbnail_url,
    c.status,
    c.created_at,
    (SELECT COUNT(*) FROM content_modules m WHERE m.course_id = c.course_id) AS module_count,
    (SELECT COUNT(*) FROM content ct JOIN content_modules m ON m.module_id = ct.module_id
      WHERE m.course_id = c.course_id AND ct.status = 'ready') AS content_count
FROM courses c
JOIN users u ON u.user_id = c.instructor_id
WHERE c.status = 'published';

-- ======================================================================
-- 5. BASE SEED DATA
-- ======================================================================
-- Base Seed Data for E-Learning Platform
-- Run last:  psql -U postgres -d elearning_db -v ON_ERROR_STOP=1 -f seed/base_seed.sql
--
-- ALL seeded users share the password:  Password123!
-- (hash below is a real bcrypt hash of that password, cost 10)
-- Regenerate with:
--   node -e "console.log(require('bcryptjs').hashSync('Password123!', 10))"

-- 1. Roles
INSERT INTO roles (role_name, description) VALUES
('Admin',      'System administrator with full system management permissions'),
('Instructor', 'Course creator and manager'),
('Student',    'Platform learner enrolled in courses');

-- 2. Users
INSERT INTO users (user_name, email, password, phone, status) VALUES
('System Admin',       'admin@elearning.com',      '$2b$10$wtctRnZnhSkAi0v6YKVk6.G5/mN34W8H8R/Q8iC1BwygCOhd9YDui', '+911111111111', 'active'),
('Professor John Doe', 'john.doe@elearning.com',   '$2b$10$wtctRnZnhSkAi0v6YKVk6.G5/mN34W8H8R/Q8iC1BwygCOhd9YDui', '+911222222222', 'active'),
('Dr. Sarah Smith',    'sarah.smith@elearning.com','$2b$10$wtctRnZnhSkAi0v6YKVk6.G5/mN34W8H8R/Q8iC1BwygCOhd9YDui', '+911333333333', 'active'),
('Alice Johnson',      'alice@student.com',        '$2b$10$wtctRnZnhSkAi0v6YKVk6.G5/mN34W8H8R/Q8iC1BwygCOhd9YDui', '+911444444444', 'active'),
('Bob Williams',       'bob@student.com',          '$2b$10$wtctRnZnhSkAi0v6YKVk6.G5/mN34W8H8R/Q8iC1BwygCOhd9YDui', '+911555555555', 'active');

-- Assign roles by name, not by guessing ids
INSERT INTO user_roles (user_id, role_id)
SELECT u.user_id, r.role_id
  FROM (VALUES
        ('admin@elearning.com',       'Admin'),
        ('john.doe@elearning.com',    'Instructor'),
        ('sarah.smith@elearning.com', 'Instructor'),
        ('alice@student.com',         'Student'),
        ('bob@student.com',           'Student')
       ) AS m(email, role_name)
  JOIN users u ON u.email = m.email
  JOIN roles r ON r.role_name = m.role_name;

-- 3. Courses (prices in INR). "Intro to Git" is free (tests the no-payment flow),
--    "System Design Primer" is a draft (must NOT appear in the public catalog).
--    Rows below are inserted in a fixed order (ORDER BY ord) so ids are stable:
--    1 Full-Stack, 2 DSA, 3 Git (free), 4 System Design (draft).
INSERT INTO courses (instructor_id, title, description, price, status)
SELECT u.user_id, v.title, v.description, v.price, v.status::course_status_enum
  FROM (VALUES
        (1, 'john.doe@elearning.com',    'Full-Stack Web Development Bootcamp',
         'Master modern web development with Node.js, Express, React, and PostgreSQL.', 4999.00, 'published'),
        (2, 'sarah.smith@elearning.com', 'Data Structures & Algorithms Masterclass',
         'Comprehensive guide to mastering DSA for technical interviews.',              2499.00, 'published'),
        (3, 'john.doe@elearning.com',    'Intro to Git & GitHub (Free)',
         'A short free course covering the Git workflow every developer needs.',           0.00, 'published'),
        (4, 'sarah.smith@elearning.com', 'System Design Primer (Draft)',
         'Work in progress - not yet published.',                                       3999.00, 'draft')
       ) AS v(ord, email, title, description, price, status)
  JOIN users u ON u.email = v.email
 ORDER BY v.ord;

-- 4. Batches (all in the future). Courses are looked up by title, not by guessed id.
INSERT INTO batches (course_id, batch_name, start_date, end_date, max_capacity)
SELECT c.course_id, v.batch_name, v.start_date::date, v.end_date::date, v.max_capacity
  FROM (VALUES
        (1, 'Full-Stack Web Development Bootcamp',        'Winter 2026 Cohort 1', '2026-11-02', '2027-01-02', 30),
        (2, 'Data Structures & Algorithms Masterclass',   'Winter 2026 Cohort 1', '2026-11-09', '2027-01-09', 25),
        (3, 'Intro to Git & GitHub (Free)',               'Open Cohort',          '2026-11-01', '2027-02-01', 30),
        (4, 'System Design Primer (Draft)',               'Spring 2027 Cohort 1', '2027-02-01', '2027-04-01', 20)
       ) AS v(ord, course_title, batch_name, start_date, end_date, max_capacity)
  JOIN courses c ON c.title = v.course_title
 ORDER BY v.ord;

-- 5. Content Modules
INSERT INTO content_modules (course_id, title, description, sequence_no)
SELECT c.course_id, v.title, v.description, v.sequence_no
  FROM (VALUES
        (1, 'Full-Stack Web Development Bootcamp', 'Module 1: Backend Fundamentals',            'Learn Express, REST APIs, and ES Modules',     1),
        (2, 'Full-Stack Web Development Bootcamp', 'Module 2: PostgreSQL Database Architecture','Master SQL schemas, triggers, and functions', 2),
        (3, 'Intro to Git & GitHub (Free)',        'Module 1: Git Basics',                      'Commits, branches and remotes',                1)
       ) AS v(ord, course_title, title, description, sequence_no)
  JOIN courses c ON c.title = v.course_title
 ORDER BY v.ord;

-- 6. Content Items (demo URLs are placeholders; replace with real Cloudinary uploads
--    or load real lessons with server/seed-content.mjs)
INSERT INTO content (module_id, title, type, video_url, cloudinary_id, duration_sec, sequence_no, status)
SELECT m.module_id, v.title, v.type::content_type_enum, v.video_url, v.cloudinary_id, v.duration_sec, v.sequence_no, 'ready'
  FROM (VALUES
        (1, 'Module 1: Backend Fundamentals',            'Introduction to Node & Express',        'video', 'https://res.cloudinary.com/demo/video/upload/v1/sample.mp4',  'cloudinary_sample_1',    600,  1),
        (2, 'Module 1: Backend Fundamentals',            'REST API Principles PDF',               'pdf',   'https://res.cloudinary.com/demo/image/upload/v1/sample.pdf',  'cloudinary_sample_pdf',  NULL, 2),
        (3, 'Module 2: PostgreSQL Database Architecture','Database Schemas & Triggers Deep Dive', 'video', 'https://res.cloudinary.com/demo/video/upload/v1/sample2.mp4', 'cloudinary_sample_2',   1200,  1),
        (4, 'Module 1: Git Basics',                      'What is Git?',                          'video', 'https://res.cloudinary.com/demo/video/upload/v1/sample.mp4',  'cloudinary_sample_git1',  300,  1),
        (5, 'Module 1: Git Basics',                      'Branching and Merging',                 'video', 'https://res.cloudinary.com/demo/video/upload/v1/sample2.mp4', 'cloudinary_sample_git2',  420,  2)
       ) AS v(ord, module_title, title, type, video_url, cloudinary_id, duration_sec, sequence_no)
  JOIN content_modules m ON m.title = v.module_title
 ORDER BY v.ord;

-- ======================================================================
-- 6. PYTHON COURSE (course 5) - content from server/manifest.json + module-titles.json
-- ======================================================================

-- Course (instructor: John Doe). Free course (price 0). Description is a placeholder: edit as needed.
INSERT INTO courses (instructor_id, title, description, price, status)
SELECT u.user_id, 'Python Programming Course',
       'Python from the basics (refresher, OOP, exception handling) through data structures and algorithms.',
       0.00, 'published'
  FROM users u WHERE u.email = 'john.doe@elearning.com';

INSERT INTO batches (course_id, batch_name, start_date, end_date, max_capacity)
SELECT course_id, 'Open Cohort', '2026-11-01', '2027-02-01', 30
  FROM courses WHERE title = 'Python Programming Course';

-- 52 modules, in lesson order
INSERT INTO content_modules (course_id, title, sequence_no)
SELECT c.course_id, v.title, v.seq
  FROM (VALUES
  (1, 'Lesson 1'),
  (2, 'Lesson 2'),
  (3, 'Lesson 3'),
  (4, 'Lesson 4'),
  (5, 'Lesson 5'),
  (6, 'Lesson 6'),
  (7, 'Lesson 7'),
  (8, 'Lesson 8'),
  (9, 'Lesson 9'),
  (10, 'Lesson 10'),
  (11, 'Lesson 11'),
  (12, 'Lesson 12'),
  (13, 'Lesson 13'),
  (14, 'Lesson 14'),
  (15, 'Lesson 15'),
  (16, 'Lesson 16'),
  (17, 'Lesson 17'),
  (18, 'Introduction to Problem Solving'),
  (19, 'Time Complexity 1'),
  (20, 'Time Complexity 2'),
  (21, 'Sorting and Searching'),
  (22, 'Introduction to Arrays'),
  (23, 'Arrays: Prefix Sum'),
  (24, 'Arrays: Carry Forward'),
  (25, 'Arrays: Subarrays'),
  (26, 'Arrays: Matrices'),
  (27, 'Interview Questions'),
  (28, 'Bit Manipulation 1'),
  (29, 'Bit Manipulation 2'),
  (30, 'Modular Arithmetic'),
  (31, 'Arrays and Maths'),
  (32, 'Sorting'),
  (33, 'Sorting (Continued)'),
  (34, 'Strings'),
  (35, 'Hashing 1'),
  (36, 'Hashing 2'),
  (37, 'Problem Solving'),
  (38, 'Intermediate DSA: Problem Solving 1'),
  (39, 'Recursion 1'),
  (40, 'Recursion 1: Follow-up'),
  (41, 'Recursion 2'),
  (42, 'Subsets and Subsequences'),
  (43, 'Linked List Basics'),
  (44, 'Stacks and Queues'),
  (45, 'Trees Basics 1'),
  (46, 'Trees Basics 2'),
  (47, 'Python Refresher 1'),
  (48, 'Python Refresher 2'),
  (49, 'Python Refresher 3'),
  (50, 'Python OOPs 1'),
  (51, 'Python OOPs 2'),
  (52, 'Exception Handling')
       ) AS v(seq, title)
  CROSS JOIN (SELECT course_id FROM courses WHERE title = 'Python Programming Course') c
 ORDER BY v.seq;

-- 828 video parts (~10 min each)
INSERT INTO content (module_id, title, type, video_url, cloudinary_id, duration_sec, sequence_no, status)
SELECT m.module_id, v.mtitle || ' - Part ' || v.part, 'video', v.video_url, v.cloudinary_id, v.duration_sec, v.part, 'ready'
  FROM (VALUES
  (1, 'Lesson 1', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791954750/python-course/00001/part-000.mp4', 'python-course/00001/part-000', 600),
  (1, 'Lesson 1', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791954753/python-course/00001/part-001.mp4', 'python-course/00001/part-001', 600),
  (1, 'Lesson 1', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791954754/python-course/00001/part-002.mp4', 'python-course/00001/part-002', 600),
  (1, 'Lesson 1', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791954756/python-course/00001/part-003.mp4', 'python-course/00001/part-003', 600),
  (1, 'Lesson 1', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791954757/python-course/00001/part-004.mp4', 'python-course/00001/part-004', 600),
  (1, 'Lesson 1', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791954759/python-course/00001/part-005.mp4', 'python-course/00001/part-005', 600),
  (1, 'Lesson 1', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791954760/python-course/00001/part-006.mp4', 'python-course/00001/part-006', 600),
  (1, 'Lesson 1', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791954762/python-course/00001/part-007.mp4', 'python-course/00001/part-007', 600),
  (1, 'Lesson 1', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791954764/python-course/00001/part-008.mp4', 'python-course/00001/part-008', 600),
  (1, 'Lesson 1', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791954765/python-course/00001/part-009.mp4', 'python-course/00001/part-009', 600),
  (1, 'Lesson 1', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791954767/python-course/00001/part-010.mp4', 'python-course/00001/part-010', 600),
  (1, 'Lesson 1', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791954769/python-course/00001/part-011.mp4', 'python-course/00001/part-011', 600),
  (1, 'Lesson 1', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791954770/python-course/00001/part-012.mp4', 'python-course/00001/part-012', 600),
  (1, 'Lesson 1', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791954772/python-course/00001/part-013.mp4', 'python-course/00001/part-013', 600),
  (1, 'Lesson 1', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791954775/python-course/00001/part-014.mp4', 'python-course/00001/part-014', 600),
  (1, 'Lesson 1', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791954777/python-course/00001/part-015.mp4', 'python-course/00001/part-015', 176),
  (2, 'Lesson 2', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955096/python-course/00002/part-000.mp4', 'python-course/00002/part-000', 600),
  (2, 'Lesson 2', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955098/python-course/00002/part-001.mp4', 'python-course/00002/part-001', 600),
  (2, 'Lesson 2', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955100/python-course/00002/part-002.mp4', 'python-course/00002/part-002', 600),
  (2, 'Lesson 2', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955102/python-course/00002/part-003.mp4', 'python-course/00002/part-003', 600),
  (2, 'Lesson 2', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955104/python-course/00002/part-004.mp4', 'python-course/00002/part-004', 600),
  (2, 'Lesson 2', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955107/python-course/00002/part-005.mp4', 'python-course/00002/part-005', 600),
  (2, 'Lesson 2', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955109/python-course/00002/part-006.mp4', 'python-course/00002/part-006', 600),
  (2, 'Lesson 2', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955112/python-course/00002/part-007.mp4', 'python-course/00002/part-007', 600),
  (2, 'Lesson 2', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955114/python-course/00002/part-008.mp4', 'python-course/00002/part-008', 600),
  (2, 'Lesson 2', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955116/python-course/00002/part-009.mp4', 'python-course/00002/part-009', 600),
  (2, 'Lesson 2', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955119/python-course/00002/part-010.mp4', 'python-course/00002/part-010', 600),
  (2, 'Lesson 2', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955121/python-course/00002/part-011.mp4', 'python-course/00002/part-011', 600),
  (2, 'Lesson 2', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955122/python-course/00002/part-012.mp4', 'python-course/00002/part-012', 600),
  (2, 'Lesson 2', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955124/python-course/00002/part-013.mp4', 'python-course/00002/part-013', 447),
  (3, 'Lesson 3', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955127/python-course/00003/part-000.mp4', 'python-course/00003/part-000', 600),
  (3, 'Lesson 3', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955129/python-course/00003/part-001.mp4', 'python-course/00003/part-001', 600),
  (3, 'Lesson 3', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955131/python-course/00003/part-002.mp4', 'python-course/00003/part-002', 600),
  (3, 'Lesson 3', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955134/python-course/00003/part-003.mp4', 'python-course/00003/part-003', 600),
  (3, 'Lesson 3', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955136/python-course/00003/part-004.mp4', 'python-course/00003/part-004', 600),
  (3, 'Lesson 3', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955139/python-course/00003/part-005.mp4', 'python-course/00003/part-005', 600),
  (3, 'Lesson 3', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955141/python-course/00003/part-006.mp4', 'python-course/00003/part-006', 600),
  (3, 'Lesson 3', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955144/python-course/00003/part-007.mp4', 'python-course/00003/part-007', 600),
  (3, 'Lesson 3', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955146/python-course/00003/part-008.mp4', 'python-course/00003/part-008', 600),
  (3, 'Lesson 3', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955148/python-course/00003/part-009.mp4', 'python-course/00003/part-009', 600),
  (3, 'Lesson 3', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955151/python-course/00003/part-010.mp4', 'python-course/00003/part-010', 600),
  (3, 'Lesson 3', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955153/python-course/00003/part-011.mp4', 'python-course/00003/part-011', 600),
  (3, 'Lesson 3', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955156/python-course/00003/part-012.mp4', 'python-course/00003/part-012', 600),
  (3, 'Lesson 3', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955157/python-course/00003/part-013.mp4', 'python-course/00003/part-013', 550),
  (4, 'Lesson 4', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955162/python-course/00004/part-000.mp4', 'python-course/00004/part-000', 600),
  (4, 'Lesson 4', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955165/python-course/00004/part-001.mp4', 'python-course/00004/part-001', 600),
  (4, 'Lesson 4', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955166/python-course/00004/part-002.mp4', 'python-course/00004/part-002', 462),
  (5, 'Lesson 5', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955169/python-course/00005/part-000.mp4', 'python-course/00005/part-000', 600),
  (5, 'Lesson 5', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955171/python-course/00005/part-001.mp4', 'python-course/00005/part-001', 600),
  (5, 'Lesson 5', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955174/python-course/00005/part-002.mp4', 'python-course/00005/part-002', 600),
  (5, 'Lesson 5', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955177/python-course/00005/part-003.mp4', 'python-course/00005/part-003', 600),
  (5, 'Lesson 5', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955179/python-course/00005/part-004.mp4', 'python-course/00005/part-004', 600),
  (5, 'Lesson 5', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955182/python-course/00005/part-005.mp4', 'python-course/00005/part-005', 600),
  (5, 'Lesson 5', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955184/python-course/00005/part-006.mp4', 'python-course/00005/part-006', 600),
  (5, 'Lesson 5', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955186/python-course/00005/part-007.mp4', 'python-course/00005/part-007', 600),
  (5, 'Lesson 5', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955188/python-course/00005/part-008.mp4', 'python-course/00005/part-008', 600),
  (5, 'Lesson 5', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955190/python-course/00005/part-009.mp4', 'python-course/00005/part-009', 600),
  (5, 'Lesson 5', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955193/python-course/00005/part-010.mp4', 'python-course/00005/part-010', 600),
  (5, 'Lesson 5', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955195/python-course/00005/part-011.mp4', 'python-course/00005/part-011', 600),
  (5, 'Lesson 5', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955197/python-course/00005/part-012.mp4', 'python-course/00005/part-012', 600),
  (5, 'Lesson 5', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955198/python-course/00005/part-013.mp4', 'python-course/00005/part-013', 470),
  (6, 'Lesson 6', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955200/python-course/00006/part-000.mp4', 'python-course/00006/part-000', 600),
  (6, 'Lesson 6', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955202/python-course/00006/part-001.mp4', 'python-course/00006/part-001', 600),
  (6, 'Lesson 6', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955204/python-course/00006/part-002.mp4', 'python-course/00006/part-002', 600),
  (6, 'Lesson 6', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955206/python-course/00006/part-003.mp4', 'python-course/00006/part-003', 600),
  (6, 'Lesson 6', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955208/python-course/00006/part-004.mp4', 'python-course/00006/part-004', 600),
  (6, 'Lesson 6', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955210/python-course/00006/part-005.mp4', 'python-course/00006/part-005', 600),
  (6, 'Lesson 6', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955212/python-course/00006/part-006.mp4', 'python-course/00006/part-006', 600),
  (6, 'Lesson 6', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955214/python-course/00006/part-007.mp4', 'python-course/00006/part-007', 600),
  (6, 'Lesson 6', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955215/python-course/00006/part-008.mp4', 'python-course/00006/part-008', 600),
  (6, 'Lesson 6', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955217/python-course/00006/part-009.mp4', 'python-course/00006/part-009', 600),
  (6, 'Lesson 6', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955219/python-course/00006/part-010.mp4', 'python-course/00006/part-010', 600),
  (6, 'Lesson 6', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955220/python-course/00006/part-011.mp4', 'python-course/00006/part-011', 600),
  (6, 'Lesson 6', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955223/python-course/00006/part-012.mp4', 'python-course/00006/part-012', 600),
  (6, 'Lesson 6', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955224/python-course/00006/part-013.mp4', 'python-course/00006/part-013', 51),
  (7, 'Lesson 7', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955226/python-course/00007/part-000.mp4', 'python-course/00007/part-000', 600),
  (7, 'Lesson 7', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955228/python-course/00007/part-001.mp4', 'python-course/00007/part-001', 600),
  (7, 'Lesson 7', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955230/python-course/00007/part-002.mp4', 'python-course/00007/part-002', 600),
  (7, 'Lesson 7', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955231/python-course/00007/part-003.mp4', 'python-course/00007/part-003', 600),
  (7, 'Lesson 7', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955233/python-course/00007/part-004.mp4', 'python-course/00007/part-004', 600),
  (7, 'Lesson 7', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955235/python-course/00007/part-005.mp4', 'python-course/00007/part-005', 600),
  (7, 'Lesson 7', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955236/python-course/00007/part-006.mp4', 'python-course/00007/part-006', 600),
  (7, 'Lesson 7', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955238/python-course/00007/part-007.mp4', 'python-course/00007/part-007', 600),
  (7, 'Lesson 7', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955241/python-course/00007/part-008.mp4', 'python-course/00007/part-008', 600),
  (7, 'Lesson 7', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955242/python-course/00007/part-009.mp4', 'python-course/00007/part-009', 600),
  (7, 'Lesson 7', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955244/python-course/00007/part-010.mp4', 'python-course/00007/part-010', 600),
  (7, 'Lesson 7', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955246/python-course/00007/part-011.mp4', 'python-course/00007/part-011', 600),
  (7, 'Lesson 7', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955247/python-course/00007/part-012.mp4', 'python-course/00007/part-012', 600),
  (7, 'Lesson 7', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955249/python-course/00007/part-013.mp4', 'python-course/00007/part-013', 600),
  (7, 'Lesson 7', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955250/python-course/00007/part-014.mp4', 'python-course/00007/part-014', 600),
  (7, 'Lesson 7', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955252/python-course/00007/part-015.mp4', 'python-course/00007/part-015', 38),
  (8, 'Lesson 8', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955498/python-course/0008/part-000.mp4', 'python-course/0008/part-000', 600),
  (8, 'Lesson 8', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955500/python-course/0008/part-001.mp4', 'python-course/0008/part-001', 600),
  (8, 'Lesson 8', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955502/python-course/0008/part-002.mp4', 'python-course/0008/part-002', 600),
  (8, 'Lesson 8', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955504/python-course/0008/part-003.mp4', 'python-course/0008/part-003', 600),
  (8, 'Lesson 8', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955506/python-course/0008/part-004.mp4', 'python-course/0008/part-004', 600),
  (8, 'Lesson 8', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955508/python-course/0008/part-005.mp4', 'python-course/0008/part-005', 600),
  (8, 'Lesson 8', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955510/python-course/0008/part-006.mp4', 'python-course/0008/part-006', 600),
  (8, 'Lesson 8', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955511/python-course/0008/part-007.mp4', 'python-course/0008/part-007', 600),
  (8, 'Lesson 8', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955513/python-course/0008/part-008.mp4', 'python-course/0008/part-008', 600),
  (8, 'Lesson 8', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955515/python-course/0008/part-009.mp4', 'python-course/0008/part-009', 600),
  (8, 'Lesson 8', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955517/python-course/0008/part-010.mp4', 'python-course/0008/part-010', 600),
  (8, 'Lesson 8', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955518/python-course/0008/part-011.mp4', 'python-course/0008/part-011', 600),
  (8, 'Lesson 8', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955520/python-course/0008/part-012.mp4', 'python-course/0008/part-012', 524),
  (9, 'Lesson 9', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955522/python-course/0009/part-000.mp4', 'python-course/0009/part-000', 600),
  (9, 'Lesson 9', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955524/python-course/0009/part-001.mp4', 'python-course/0009/part-001', 600),
  (9, 'Lesson 9', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955526/python-course/0009/part-002.mp4', 'python-course/0009/part-002', 600),
  (9, 'Lesson 9', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955528/python-course/0009/part-003.mp4', 'python-course/0009/part-003', 600),
  (9, 'Lesson 9', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955530/python-course/0009/part-004.mp4', 'python-course/0009/part-004', 600),
  (9, 'Lesson 9', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955533/python-course/0009/part-005.mp4', 'python-course/0009/part-005', 600),
  (9, 'Lesson 9', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955535/python-course/0009/part-006.mp4', 'python-course/0009/part-006', 600),
  (9, 'Lesson 9', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955537/python-course/0009/part-007.mp4', 'python-course/0009/part-007', 600),
  (9, 'Lesson 9', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955538/python-course/0009/part-008.mp4', 'python-course/0009/part-008', 600),
  (9, 'Lesson 9', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955540/python-course/0009/part-009.mp4', 'python-course/0009/part-009', 600),
  (9, 'Lesson 9', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955542/python-course/0009/part-010.mp4', 'python-course/0009/part-010', 600),
  (9, 'Lesson 9', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955544/python-course/0009/part-011.mp4', 'python-course/0009/part-011', 600),
  (9, 'Lesson 9', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955546/python-course/0009/part-012.mp4', 'python-course/0009/part-012', 600),
  (9, 'Lesson 9', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955547/python-course/0009/part-013.mp4', 'python-course/0009/part-013', 600),
  (9, 'Lesson 9', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955549/python-course/0009/part-014.mp4', 'python-course/0009/part-014', 43),
  (10, 'Lesson 10', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955253/python-course/00010/part-000.mp4', 'python-course/00010/part-000', 600),
  (10, 'Lesson 10', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955255/python-course/00010/part-001.mp4', 'python-course/00010/part-001', 600),
  (10, 'Lesson 10', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955257/python-course/00010/part-002.mp4', 'python-course/00010/part-002', 600),
  (10, 'Lesson 10', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955259/python-course/00010/part-003.mp4', 'python-course/00010/part-003', 600),
  (10, 'Lesson 10', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955261/python-course/00010/part-004.mp4', 'python-course/00010/part-004', 600),
  (10, 'Lesson 10', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955263/python-course/00010/part-005.mp4', 'python-course/00010/part-005', 600),
  (10, 'Lesson 10', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955265/python-course/00010/part-006.mp4', 'python-course/00010/part-006', 600),
  (10, 'Lesson 10', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955267/python-course/00010/part-007.mp4', 'python-course/00010/part-007', 600),
  (10, 'Lesson 10', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955269/python-course/00010/part-008.mp4', 'python-course/00010/part-008', 600),
  (10, 'Lesson 10', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955271/python-course/00010/part-009.mp4', 'python-course/00010/part-009', 600),
  (10, 'Lesson 10', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955274/python-course/00010/part-010.mp4', 'python-course/00010/part-010', 600),
  (10, 'Lesson 10', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955276/python-course/00010/part-011.mp4', 'python-course/00010/part-011', 600),
  (10, 'Lesson 10', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955277/python-course/00010/part-012.mp4', 'python-course/00010/part-012', 600),
  (10, 'Lesson 10', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955279/python-course/00010/part-013.mp4', 'python-course/00010/part-013', 15),
  (11, 'Lesson 11', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955281/python-course/00011/part-000.mp4', 'python-course/00011/part-000', 600),
  (11, 'Lesson 11', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955283/python-course/00011/part-001.mp4', 'python-course/00011/part-001', 600),
  (11, 'Lesson 11', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955285/python-course/00011/part-002.mp4', 'python-course/00011/part-002', 600),
  (11, 'Lesson 11', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955286/python-course/00011/part-003.mp4', 'python-course/00011/part-003', 600),
  (11, 'Lesson 11', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955288/python-course/00011/part-004.mp4', 'python-course/00011/part-004', 600),
  (11, 'Lesson 11', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955290/python-course/00011/part-005.mp4', 'python-course/00011/part-005', 600),
  (11, 'Lesson 11', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955292/python-course/00011/part-006.mp4', 'python-course/00011/part-006', 600),
  (11, 'Lesson 11', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955296/python-course/00011/part-007.mp4', 'python-course/00011/part-007', 600),
  (11, 'Lesson 11', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955298/python-course/00011/part-008.mp4', 'python-course/00011/part-008', 600),
  (11, 'Lesson 11', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955300/python-course/00011/part-009.mp4', 'python-course/00011/part-009', 600),
  (11, 'Lesson 11', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955302/python-course/00011/part-010.mp4', 'python-course/00011/part-010', 600),
  (11, 'Lesson 11', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955304/python-course/00011/part-011.mp4', 'python-course/00011/part-011', 600),
  (11, 'Lesson 11', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955306/python-course/00011/part-012.mp4', 'python-course/00011/part-012', 600),
  (11, 'Lesson 11', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955308/python-course/00011/part-013.mp4', 'python-course/00011/part-013', 600),
  (11, 'Lesson 11', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955309/python-course/00011/part-014.mp4', 'python-course/00011/part-014', 227),
  (12, 'Lesson 12', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955311/python-course/00012/part-000.mp4', 'python-course/00012/part-000', 600),
  (12, 'Lesson 12', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955313/python-course/00012/part-001.mp4', 'python-course/00012/part-001', 600),
  (12, 'Lesson 12', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955315/python-course/00012/part-002.mp4', 'python-course/00012/part-002', 600),
  (12, 'Lesson 12', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955317/python-course/00012/part-003.mp4', 'python-course/00012/part-003', 600),
  (12, 'Lesson 12', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955319/python-course/00012/part-004.mp4', 'python-course/00012/part-004', 600),
  (12, 'Lesson 12', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955321/python-course/00012/part-005.mp4', 'python-course/00012/part-005', 600),
  (12, 'Lesson 12', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955323/python-course/00012/part-006.mp4', 'python-course/00012/part-006', 600),
  (12, 'Lesson 12', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955327/python-course/00012/part-007.mp4', 'python-course/00012/part-007', 600),
  (12, 'Lesson 12', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955328/python-course/00012/part-008.mp4', 'python-course/00012/part-008', 600),
  (12, 'Lesson 12', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955330/python-course/00012/part-009.mp4', 'python-course/00012/part-009', 600),
  (12, 'Lesson 12', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955332/python-course/00012/part-010.mp4', 'python-course/00012/part-010', 600),
  (12, 'Lesson 12', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955334/python-course/00012/part-011.mp4', 'python-course/00012/part-011', 600),
  (12, 'Lesson 12', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955335/python-course/00012/part-012.mp4', 'python-course/00012/part-012', 600),
  (12, 'Lesson 12', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955337/python-course/00012/part-013.mp4', 'python-course/00012/part-013', 63),
  (13, 'Lesson 13', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955339/python-course/00013/part-000.mp4', 'python-course/00013/part-000', 600),
  (13, 'Lesson 13', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955341/python-course/00013/part-001.mp4', 'python-course/00013/part-001', 600),
  (13, 'Lesson 13', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955342/python-course/00013/part-002.mp4', 'python-course/00013/part-002', 600),
  (13, 'Lesson 13', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955344/python-course/00013/part-003.mp4', 'python-course/00013/part-003', 600),
  (13, 'Lesson 13', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955346/python-course/00013/part-004.mp4', 'python-course/00013/part-004', 600),
  (13, 'Lesson 13', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955349/python-course/00013/part-005.mp4', 'python-course/00013/part-005', 600),
  (13, 'Lesson 13', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955351/python-course/00013/part-006.mp4', 'python-course/00013/part-006', 600),
  (13, 'Lesson 13', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955353/python-course/00013/part-007.mp4', 'python-course/00013/part-007', 600),
  (13, 'Lesson 13', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955355/python-course/00013/part-008.mp4', 'python-course/00013/part-008', 600),
  (13, 'Lesson 13', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955357/python-course/00013/part-009.mp4', 'python-course/00013/part-009', 600),
  (13, 'Lesson 13', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955359/python-course/00013/part-010.mp4', 'python-course/00013/part-010', 600),
  (13, 'Lesson 13', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955362/python-course/00013/part-011.mp4', 'python-course/00013/part-011', 600),
  (13, 'Lesson 13', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955365/python-course/00013/part-012.mp4', 'python-course/00013/part-012', 600),
  (13, 'Lesson 13', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955367/python-course/00013/part-013.mp4', 'python-course/00013/part-013', 600),
  (13, 'Lesson 13', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955369/python-course/00013/part-014.mp4', 'python-course/00013/part-014', 600),
  (13, 'Lesson 13', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955371/python-course/00013/part-015.mp4', 'python-course/00013/part-015', 133),
  (14, 'Lesson 14', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955373/python-course/00014/part-000.mp4', 'python-course/00014/part-000', 600),
  (14, 'Lesson 14', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955376/python-course/00014/part-001.mp4', 'python-course/00014/part-001', 600),
  (14, 'Lesson 14', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955378/python-course/00014/part-002.mp4', 'python-course/00014/part-002', 600),
  (14, 'Lesson 14', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955380/python-course/00014/part-003.mp4', 'python-course/00014/part-003', 600),
  (14, 'Lesson 14', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955382/python-course/00014/part-004.mp4', 'python-course/00014/part-004', 600),
  (14, 'Lesson 14', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955384/python-course/00014/part-005.mp4', 'python-course/00014/part-005', 600),
  (14, 'Lesson 14', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955386/python-course/00014/part-006.mp4', 'python-course/00014/part-006', 600),
  (14, 'Lesson 14', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955388/python-course/00014/part-007.mp4', 'python-course/00014/part-007', 600),
  (14, 'Lesson 14', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955390/python-course/00014/part-008.mp4', 'python-course/00014/part-008', 600),
  (14, 'Lesson 14', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955392/python-course/00014/part-009.mp4', 'python-course/00014/part-009', 600),
  (14, 'Lesson 14', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955394/python-course/00014/part-010.mp4', 'python-course/00014/part-010', 600),
  (14, 'Lesson 14', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955396/python-course/00014/part-011.mp4', 'python-course/00014/part-011', 600),
  (14, 'Lesson 14', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955398/python-course/00014/part-012.mp4', 'python-course/00014/part-012', 600),
  (14, 'Lesson 14', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955400/python-course/00014/part-013.mp4', 'python-course/00014/part-013', 600),
  (14, 'Lesson 14', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955402/python-course/00014/part-014.mp4', 'python-course/00014/part-014', 77),
  (15, 'Lesson 15', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955404/python-course/00015/part-000.mp4', 'python-course/00015/part-000', 600),
  (15, 'Lesson 15', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955406/python-course/00015/part-001.mp4', 'python-course/00015/part-001', 600),
  (15, 'Lesson 15', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955409/python-course/00015/part-002.mp4', 'python-course/00015/part-002', 600),
  (15, 'Lesson 15', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955412/python-course/00015/part-003.mp4', 'python-course/00015/part-003', 600),
  (15, 'Lesson 15', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955413/python-course/00015/part-004.mp4', 'python-course/00015/part-004', 600),
  (15, 'Lesson 15', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955415/python-course/00015/part-005.mp4', 'python-course/00015/part-005', 600),
  (15, 'Lesson 15', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955417/python-course/00015/part-006.mp4', 'python-course/00015/part-006', 600),
  (15, 'Lesson 15', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955419/python-course/00015/part-007.mp4', 'python-course/00015/part-007', 600),
  (15, 'Lesson 15', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955421/python-course/00015/part-008.mp4', 'python-course/00015/part-008', 600),
  (15, 'Lesson 15', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955423/python-course/00015/part-009.mp4', 'python-course/00015/part-009', 600),
  (15, 'Lesson 15', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955425/python-course/00015/part-010.mp4', 'python-course/00015/part-010', 600),
  (15, 'Lesson 15', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955427/python-course/00015/part-011.mp4', 'python-course/00015/part-011', 600),
  (15, 'Lesson 15', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955428/python-course/00015/part-012.mp4', 'python-course/00015/part-012', 600),
  (15, 'Lesson 15', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955430/python-course/00015/part-013.mp4', 'python-course/00015/part-013', 600),
  (15, 'Lesson 15', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955433/python-course/00015/part-014.mp4', 'python-course/00015/part-014', 600),
  (15, 'Lesson 15', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955435/python-course/00015/part-015.mp4', 'python-course/00015/part-015', 600),
  (15, 'Lesson 15', 17, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955436/python-course/00015/part-016.mp4', 'python-course/00015/part-016', 436),
  (16, 'Lesson 16', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955439/python-course/00016/part-000.mp4', 'python-course/00016/part-000', 600),
  (16, 'Lesson 16', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955441/python-course/00016/part-001.mp4', 'python-course/00016/part-001', 600),
  (16, 'Lesson 16', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955444/python-course/00016/part-002.mp4', 'python-course/00016/part-002', 600),
  (16, 'Lesson 16', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955447/python-course/00016/part-003.mp4', 'python-course/00016/part-003', 600),
  (16, 'Lesson 16', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955449/python-course/00016/part-004.mp4', 'python-course/00016/part-004', 600),
  (16, 'Lesson 16', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955451/python-course/00016/part-005.mp4', 'python-course/00016/part-005', 600),
  (16, 'Lesson 16', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955453/python-course/00016/part-006.mp4', 'python-course/00016/part-006', 600),
  (16, 'Lesson 16', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955455/python-course/00016/part-007.mp4', 'python-course/00016/part-007', 600),
  (16, 'Lesson 16', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955457/python-course/00016/part-008.mp4', 'python-course/00016/part-008', 600),
  (16, 'Lesson 16', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955458/python-course/00016/part-009.mp4', 'python-course/00016/part-009', 600),
  (16, 'Lesson 16', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955460/python-course/00016/part-010.mp4', 'python-course/00016/part-010', 600),
  (16, 'Lesson 16', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955462/python-course/00016/part-011.mp4', 'python-course/00016/part-011', 600),
  (16, 'Lesson 16', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955463/python-course/00016/part-012.mp4', 'python-course/00016/part-012', 600),
  (16, 'Lesson 16', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955465/python-course/00016/part-013.mp4', 'python-course/00016/part-013', 600),
  (16, 'Lesson 16', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955466/python-course/00016/part-014.mp4', 'python-course/00016/part-014', 98),
  (17, 'Lesson 17', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955468/python-course/00017/part-000.mp4', 'python-course/00017/part-000', 600),
  (17, 'Lesson 17', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955470/python-course/00017/part-001.mp4', 'python-course/00017/part-001', 600),
  (17, 'Lesson 17', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955472/python-course/00017/part-002.mp4', 'python-course/00017/part-002', 600),
  (17, 'Lesson 17', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955474/python-course/00017/part-003.mp4', 'python-course/00017/part-003', 600),
  (17, 'Lesson 17', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955476/python-course/00017/part-004.mp4', 'python-course/00017/part-004', 600),
  (17, 'Lesson 17', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955477/python-course/00017/part-005.mp4', 'python-course/00017/part-005', 600),
  (17, 'Lesson 17', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955479/python-course/00017/part-006.mp4', 'python-course/00017/part-006', 600),
  (17, 'Lesson 17', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955481/python-course/00017/part-007.mp4', 'python-course/00017/part-007', 600),
  (17, 'Lesson 17', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955483/python-course/00017/part-008.mp4', 'python-course/00017/part-008', 600),
  (17, 'Lesson 17', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955485/python-course/00017/part-009.mp4', 'python-course/00017/part-009', 600),
  (17, 'Lesson 17', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955487/python-course/00017/part-010.mp4', 'python-course/00017/part-010', 600),
  (17, 'Lesson 17', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955489/python-course/00017/part-011.mp4', 'python-course/00017/part-011', 600),
  (17, 'Lesson 17', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955490/python-course/00017/part-012.mp4', 'python-course/00017/part-012', 600),
  (17, 'Lesson 17', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955492/python-course/00017/part-013.mp4', 'python-course/00017/part-013', 355),
  (18, 'Introduction to Problem Solving', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955550/python-course/18-intro-to-problem-solving/part-000.mp4', 'python-course/18-intro-to-problem-solving/part-000', 600),
  (18, 'Introduction to Problem Solving', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955551/python-course/18-intro-to-problem-solving/part-001.mp4', 'python-course/18-intro-to-problem-solving/part-001', 600),
  (18, 'Introduction to Problem Solving', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955553/python-course/18-intro-to-problem-solving/part-002.mp4', 'python-course/18-intro-to-problem-solving/part-002', 600),
  (18, 'Introduction to Problem Solving', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955555/python-course/18-intro-to-problem-solving/part-003.mp4', 'python-course/18-intro-to-problem-solving/part-003', 600),
  (18, 'Introduction to Problem Solving', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955556/python-course/18-intro-to-problem-solving/part-004.mp4', 'python-course/18-intro-to-problem-solving/part-004', 600),
  (18, 'Introduction to Problem Solving', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955558/python-course/18-intro-to-problem-solving/part-005.mp4', 'python-course/18-intro-to-problem-solving/part-005', 600),
  (18, 'Introduction to Problem Solving', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955560/python-course/18-intro-to-problem-solving/part-006.mp4', 'python-course/18-intro-to-problem-solving/part-006', 600),
  (18, 'Introduction to Problem Solving', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955561/python-course/18-intro-to-problem-solving/part-007.mp4', 'python-course/18-intro-to-problem-solving/part-007', 600),
  (18, 'Introduction to Problem Solving', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955563/python-course/18-intro-to-problem-solving/part-008.mp4', 'python-course/18-intro-to-problem-solving/part-008', 600),
  (18, 'Introduction to Problem Solving', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955565/python-course/18-intro-to-problem-solving/part-009.mp4', 'python-course/18-intro-to-problem-solving/part-009', 600),
  (18, 'Introduction to Problem Solving', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955567/python-course/18-intro-to-problem-solving/part-010.mp4', 'python-course/18-intro-to-problem-solving/part-010', 600),
  (18, 'Introduction to Problem Solving', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955569/python-course/18-intro-to-problem-solving/part-011.mp4', 'python-course/18-intro-to-problem-solving/part-011', 600),
  (18, 'Introduction to Problem Solving', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955571/python-course/18-intro-to-problem-solving/part-012.mp4', 'python-course/18-intro-to-problem-solving/part-012', 600),
  (18, 'Introduction to Problem Solving', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955572/python-course/18-intro-to-problem-solving/part-013.mp4', 'python-course/18-intro-to-problem-solving/part-013', 600),
  (18, 'Introduction to Problem Solving', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955574/python-course/18-intro-to-problem-solving/part-014.mp4', 'python-course/18-intro-to-problem-solving/part-014', 600),
  (18, 'Introduction to Problem Solving', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955576/python-course/18-intro-to-problem-solving/part-015.mp4', 'python-course/18-intro-to-problem-solving/part-015', 600),
  (18, 'Introduction to Problem Solving', 17, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955577/python-course/18-intro-to-problem-solving/part-016.mp4', 'python-course/18-intro-to-problem-solving/part-016', 600),
  (18, 'Introduction to Problem Solving', 18, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955579/python-course/18-intro-to-problem-solving/part-017.mp4', 'python-course/18-intro-to-problem-solving/part-017', 600),
  (18, 'Introduction to Problem Solving', 19, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955580/python-course/18-intro-to-problem-solving/part-018.mp4', 'python-course/18-intro-to-problem-solving/part-018', 600),
  (18, 'Introduction to Problem Solving', 20, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955582/python-course/18-intro-to-problem-solving/part-019.mp4', 'python-course/18-intro-to-problem-solving/part-019', 410),
  (19, 'Time Complexity 1', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955584/python-course/19-Time-Complexity-1/part-000.mp4', 'python-course/19-Time-Complexity-1/part-000', 600),
  (19, 'Time Complexity 1', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955585/python-course/19-Time-Complexity-1/part-001.mp4', 'python-course/19-Time-Complexity-1/part-001', 600),
  (19, 'Time Complexity 1', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955588/python-course/19-Time-Complexity-1/part-002.mp4', 'python-course/19-Time-Complexity-1/part-002', 600),
  (19, 'Time Complexity 1', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955589/python-course/19-Time-Complexity-1/part-003.mp4', 'python-course/19-Time-Complexity-1/part-003', 600),
  (19, 'Time Complexity 1', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955591/python-course/19-Time-Complexity-1/part-004.mp4', 'python-course/19-Time-Complexity-1/part-004', 600),
  (19, 'Time Complexity 1', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955592/python-course/19-Time-Complexity-1/part-005.mp4', 'python-course/19-Time-Complexity-1/part-005', 600),
  (19, 'Time Complexity 1', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955595/python-course/19-Time-Complexity-1/part-006.mp4', 'python-course/19-Time-Complexity-1/part-006', 600),
  (19, 'Time Complexity 1', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955596/python-course/19-Time-Complexity-1/part-007.mp4', 'python-course/19-Time-Complexity-1/part-007', 600),
  (19, 'Time Complexity 1', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955598/python-course/19-Time-Complexity-1/part-008.mp4', 'python-course/19-Time-Complexity-1/part-008', 600),
  (19, 'Time Complexity 1', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955600/python-course/19-Time-Complexity-1/part-009.mp4', 'python-course/19-Time-Complexity-1/part-009', 600),
  (19, 'Time Complexity 1', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955601/python-course/19-Time-Complexity-1/part-010.mp4', 'python-course/19-Time-Complexity-1/part-010', 600),
  (19, 'Time Complexity 1', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955603/python-course/19-Time-Complexity-1/part-011.mp4', 'python-course/19-Time-Complexity-1/part-011', 600),
  (19, 'Time Complexity 1', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955604/python-course/19-Time-Complexity-1/part-012.mp4', 'python-course/19-Time-Complexity-1/part-012', 600),
  (19, 'Time Complexity 1', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955606/python-course/19-Time-Complexity-1/part-013.mp4', 'python-course/19-Time-Complexity-1/part-013', 600),
  (19, 'Time Complexity 1', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955608/python-course/19-Time-Complexity-1/part-014.mp4', 'python-course/19-Time-Complexity-1/part-014', 600),
  (19, 'Time Complexity 1', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955610/python-course/19-Time-Complexity-1/part-015.mp4', 'python-course/19-Time-Complexity-1/part-015', 600),
  (19, 'Time Complexity 1', 17, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955611/python-course/19-Time-Complexity-1/part-016.mp4', 'python-course/19-Time-Complexity-1/part-016', 600),
  (19, 'Time Complexity 1', 18, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955613/python-course/19-Time-Complexity-1/part-017.mp4', 'python-course/19-Time-Complexity-1/part-017', 600),
  (19, 'Time Complexity 1', 19, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955615/python-course/19-Time-Complexity-1/part-018.mp4', 'python-course/19-Time-Complexity-1/part-018', 458),
  (20, 'Time Complexity 2', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955616/python-course/20-Time-Complexity-2/part-000.mp4', 'python-course/20-Time-Complexity-2/part-000', 600),
  (20, 'Time Complexity 2', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955618/python-course/20-Time-Complexity-2/part-001.mp4', 'python-course/20-Time-Complexity-2/part-001', 600),
  (20, 'Time Complexity 2', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955620/python-course/20-Time-Complexity-2/part-002.mp4', 'python-course/20-Time-Complexity-2/part-002', 600),
  (20, 'Time Complexity 2', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955621/python-course/20-Time-Complexity-2/part-003.mp4', 'python-course/20-Time-Complexity-2/part-003', 600),
  (20, 'Time Complexity 2', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955623/python-course/20-Time-Complexity-2/part-004.mp4', 'python-course/20-Time-Complexity-2/part-004', 600),
  (20, 'Time Complexity 2', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955625/python-course/20-Time-Complexity-2/part-005.mp4', 'python-course/20-Time-Complexity-2/part-005', 600),
  (20, 'Time Complexity 2', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955626/python-course/20-Time-Complexity-2/part-006.mp4', 'python-course/20-Time-Complexity-2/part-006', 600),
  (20, 'Time Complexity 2', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955628/python-course/20-Time-Complexity-2/part-007.mp4', 'python-course/20-Time-Complexity-2/part-007', 600),
  (20, 'Time Complexity 2', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955630/python-course/20-Time-Complexity-2/part-008.mp4', 'python-course/20-Time-Complexity-2/part-008', 600),
  (20, 'Time Complexity 2', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955632/python-course/20-Time-Complexity-2/part-009.mp4', 'python-course/20-Time-Complexity-2/part-009', 600),
  (20, 'Time Complexity 2', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955633/python-course/20-Time-Complexity-2/part-010.mp4', 'python-course/20-Time-Complexity-2/part-010', 600),
  (20, 'Time Complexity 2', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955634/python-course/20-Time-Complexity-2/part-011.mp4', 'python-course/20-Time-Complexity-2/part-011', 600),
  (20, 'Time Complexity 2', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955636/python-course/20-Time-Complexity-2/part-012.mp4', 'python-course/20-Time-Complexity-2/part-012', 600),
  (20, 'Time Complexity 2', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955638/python-course/20-Time-Complexity-2/part-013.mp4', 'python-course/20-Time-Complexity-2/part-013', 600),
  (20, 'Time Complexity 2', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955640/python-course/20-Time-Complexity-2/part-014.mp4', 'python-course/20-Time-Complexity-2/part-014', 600),
  (20, 'Time Complexity 2', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955642/python-course/20-Time-Complexity-2/part-015.mp4', 'python-course/20-Time-Complexity-2/part-015', 600),
  (20, 'Time Complexity 2', 17, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955644/python-course/20-Time-Complexity-2/part-016.mp4', 'python-course/20-Time-Complexity-2/part-016', 600),
  (20, 'Time Complexity 2', 18, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955645/python-course/20-Time-Complexity-2/part-017.mp4', 'python-course/20-Time-Complexity-2/part-017', 504),
  (21, 'Sorting and Searching', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955647/python-course/21-Sorting-and-searching/part-000.mp4', 'python-course/21-Sorting-and-searching/part-000', 600),
  (21, 'Sorting and Searching', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955649/python-course/21-Sorting-and-searching/part-001.mp4', 'python-course/21-Sorting-and-searching/part-001', 600),
  (21, 'Sorting and Searching', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955652/python-course/21-Sorting-and-searching/part-002.mp4', 'python-course/21-Sorting-and-searching/part-002', 600),
  (21, 'Sorting and Searching', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955653/python-course/21-Sorting-and-searching/part-003.mp4', 'python-course/21-Sorting-and-searching/part-003', 600),
  (21, 'Sorting and Searching', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955655/python-course/21-Sorting-and-searching/part-004.mp4', 'python-course/21-Sorting-and-searching/part-004', 600),
  (21, 'Sorting and Searching', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955656/python-course/21-Sorting-and-searching/part-005.mp4', 'python-course/21-Sorting-and-searching/part-005', 600),
  (21, 'Sorting and Searching', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955658/python-course/21-Sorting-and-searching/part-006.mp4', 'python-course/21-Sorting-and-searching/part-006', 600),
  (21, 'Sorting and Searching', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955660/python-course/21-Sorting-and-searching/part-007.mp4', 'python-course/21-Sorting-and-searching/part-007', 600),
  (21, 'Sorting and Searching', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955662/python-course/21-Sorting-and-searching/part-008.mp4', 'python-course/21-Sorting-and-searching/part-008', 600),
  (21, 'Sorting and Searching', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955664/python-course/21-Sorting-and-searching/part-009.mp4', 'python-course/21-Sorting-and-searching/part-009', 600),
  (21, 'Sorting and Searching', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955665/python-course/21-Sorting-and-searching/part-010.mp4', 'python-course/21-Sorting-and-searching/part-010', 600),
  (21, 'Sorting and Searching', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955668/python-course/21-Sorting-and-searching/part-011.mp4', 'python-course/21-Sorting-and-searching/part-011', 600),
  (21, 'Sorting and Searching', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955669/python-course/21-Sorting-and-searching/part-012.mp4', 'python-course/21-Sorting-and-searching/part-012', 600),
  (21, 'Sorting and Searching', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955671/python-course/21-Sorting-and-searching/part-013.mp4', 'python-course/21-Sorting-and-searching/part-013', 355),
  (22, 'Introduction to Arrays', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955672/python-course/22-Intro-to-Arays/part-000.mp4', 'python-course/22-Intro-to-Arays/part-000', 600),
  (22, 'Introduction to Arrays', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955674/python-course/22-Intro-to-Arays/part-001.mp4', 'python-course/22-Intro-to-Arays/part-001', 600),
  (22, 'Introduction to Arrays', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955675/python-course/22-Intro-to-Arays/part-002.mp4', 'python-course/22-Intro-to-Arays/part-002', 600),
  (22, 'Introduction to Arrays', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955676/python-course/22-Intro-to-Arays/part-003.mp4', 'python-course/22-Intro-to-Arays/part-003', 600),
  (22, 'Introduction to Arrays', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955678/python-course/22-Intro-to-Arays/part-004.mp4', 'python-course/22-Intro-to-Arays/part-004', 600),
  (22, 'Introduction to Arrays', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955680/python-course/22-Intro-to-Arays/part-005.mp4', 'python-course/22-Intro-to-Arays/part-005', 600),
  (22, 'Introduction to Arrays', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955682/python-course/22-Intro-to-Arays/part-006.mp4', 'python-course/22-Intro-to-Arays/part-006', 600),
  (22, 'Introduction to Arrays', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955684/python-course/22-Intro-to-Arays/part-007.mp4', 'python-course/22-Intro-to-Arays/part-007', 600),
  (22, 'Introduction to Arrays', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955685/python-course/22-Intro-to-Arays/part-008.mp4', 'python-course/22-Intro-to-Arays/part-008', 600),
  (22, 'Introduction to Arrays', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955687/python-course/22-Intro-to-Arays/part-009.mp4', 'python-course/22-Intro-to-Arays/part-009', 600),
  (22, 'Introduction to Arrays', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955688/python-course/22-Intro-to-Arays/part-010.mp4', 'python-course/22-Intro-to-Arays/part-010', 600),
  (22, 'Introduction to Arrays', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955690/python-course/22-Intro-to-Arays/part-011.mp4', 'python-course/22-Intro-to-Arays/part-011', 600),
  (22, 'Introduction to Arrays', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955691/python-course/22-Intro-to-Arays/part-012.mp4', 'python-course/22-Intro-to-Arays/part-012', 600),
  (22, 'Introduction to Arrays', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955693/python-course/22-Intro-to-Arays/part-013.mp4', 'python-course/22-Intro-to-Arays/part-013', 600),
  (22, 'Introduction to Arrays', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955696/python-course/22-Intro-to-Arays/part-014.mp4', 'python-course/22-Intro-to-Arays/part-014', 600),
  (22, 'Introduction to Arrays', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955697/python-course/22-Intro-to-Arays/part-015.mp4', 'python-course/22-Intro-to-Arays/part-015', 554),
  (23, 'Arrays: Prefix Sum', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955701/python-course/23-Arrays---prefix-sum/part-000.mp4', 'python-course/23-Arrays---prefix-sum/part-000', 600),
  (23, 'Arrays: Prefix Sum', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955703/python-course/23-Arrays---prefix-sum/part-001.mp4', 'python-course/23-Arrays---prefix-sum/part-001', 600),
  (23, 'Arrays: Prefix Sum', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955705/python-course/23-Arrays---prefix-sum/part-002.mp4', 'python-course/23-Arrays---prefix-sum/part-002', 600),
  (23, 'Arrays: Prefix Sum', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955707/python-course/23-Arrays---prefix-sum/part-003.mp4', 'python-course/23-Arrays---prefix-sum/part-003', 600),
  (23, 'Arrays: Prefix Sum', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955709/python-course/23-Arrays---prefix-sum/part-004.mp4', 'python-course/23-Arrays---prefix-sum/part-004', 600),
  (23, 'Arrays: Prefix Sum', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955711/python-course/23-Arrays---prefix-sum/part-005.mp4', 'python-course/23-Arrays---prefix-sum/part-005', 600),
  (23, 'Arrays: Prefix Sum', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955713/python-course/23-Arrays---prefix-sum/part-006.mp4', 'python-course/23-Arrays---prefix-sum/part-006', 600),
  (23, 'Arrays: Prefix Sum', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955715/python-course/23-Arrays---prefix-sum/part-007.mp4', 'python-course/23-Arrays---prefix-sum/part-007', 600),
  (23, 'Arrays: Prefix Sum', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955717/python-course/23-Arrays---prefix-sum/part-008.mp4', 'python-course/23-Arrays---prefix-sum/part-008', 600),
  (23, 'Arrays: Prefix Sum', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955719/python-course/23-Arrays---prefix-sum/part-009.mp4', 'python-course/23-Arrays---prefix-sum/part-009', 600),
  (23, 'Arrays: Prefix Sum', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955722/python-course/23-Arrays---prefix-sum/part-010.mp4', 'python-course/23-Arrays---prefix-sum/part-010', 600),
  (23, 'Arrays: Prefix Sum', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955724/python-course/23-Arrays---prefix-sum/part-011.mp4', 'python-course/23-Arrays---prefix-sum/part-011', 600),
  (23, 'Arrays: Prefix Sum', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955726/python-course/23-Arrays---prefix-sum/part-012.mp4', 'python-course/23-Arrays---prefix-sum/part-012', 600),
  (23, 'Arrays: Prefix Sum', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955728/python-course/23-Arrays---prefix-sum/part-013.mp4', 'python-course/23-Arrays---prefix-sum/part-013', 600),
  (23, 'Arrays: Prefix Sum', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955730/python-course/23-Arrays---prefix-sum/part-014.mp4', 'python-course/23-Arrays---prefix-sum/part-014', 600),
  (23, 'Arrays: Prefix Sum', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955731/python-course/23-Arrays---prefix-sum/part-015.mp4', 'python-course/23-Arrays---prefix-sum/part-015', 600),
  (23, 'Arrays: Prefix Sum', 17, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955733/python-course/23-Arrays---prefix-sum/part-016.mp4', 'python-course/23-Arrays---prefix-sum/part-016', 600),
  (23, 'Arrays: Prefix Sum', 18, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955735/python-course/23-Arrays---prefix-sum/part-017.mp4', 'python-course/23-Arrays---prefix-sum/part-017', 498),
  (24, 'Arrays: Carry Forward', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955737/python-course/24-Arays---Carry-FORWARD/part-000.mp4', 'python-course/24-Arays---Carry-FORWARD/part-000', 600),
  (24, 'Arrays: Carry Forward', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955739/python-course/24-Arays---Carry-FORWARD/part-001.mp4', 'python-course/24-Arays---Carry-FORWARD/part-001', 600),
  (24, 'Arrays: Carry Forward', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955741/python-course/24-Arays---Carry-FORWARD/part-002.mp4', 'python-course/24-Arays---Carry-FORWARD/part-002', 600),
  (24, 'Arrays: Carry Forward', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955744/python-course/24-Arays---Carry-FORWARD/part-003.mp4', 'python-course/24-Arays---Carry-FORWARD/part-003', 600),
  (24, 'Arrays: Carry Forward', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955746/python-course/24-Arays---Carry-FORWARD/part-004.mp4', 'python-course/24-Arays---Carry-FORWARD/part-004', 600),
  (24, 'Arrays: Carry Forward', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955748/python-course/24-Arays---Carry-FORWARD/part-005.mp4', 'python-course/24-Arays---Carry-FORWARD/part-005', 600),
  (24, 'Arrays: Carry Forward', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955751/python-course/24-Arays---Carry-FORWARD/part-006.mp4', 'python-course/24-Arays---Carry-FORWARD/part-006', 600),
  (24, 'Arrays: Carry Forward', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955753/python-course/24-Arays---Carry-FORWARD/part-007.mp4', 'python-course/24-Arays---Carry-FORWARD/part-007', 600),
  (24, 'Arrays: Carry Forward', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955754/python-course/24-Arays---Carry-FORWARD/part-008.mp4', 'python-course/24-Arays---Carry-FORWARD/part-008', 600),
  (24, 'Arrays: Carry Forward', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955757/python-course/24-Arays---Carry-FORWARD/part-009.mp4', 'python-course/24-Arays---Carry-FORWARD/part-009', 600),
  (24, 'Arrays: Carry Forward', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955759/python-course/24-Arays---Carry-FORWARD/part-010.mp4', 'python-course/24-Arays---Carry-FORWARD/part-010', 600),
  (24, 'Arrays: Carry Forward', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955762/python-course/24-Arays---Carry-FORWARD/part-011.mp4', 'python-course/24-Arays---Carry-FORWARD/part-011', 600),
  (24, 'Arrays: Carry Forward', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955764/python-course/24-Arays---Carry-FORWARD/part-012.mp4', 'python-course/24-Arays---Carry-FORWARD/part-012', 600),
  (24, 'Arrays: Carry Forward', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955766/python-course/24-Arays---Carry-FORWARD/part-013.mp4', 'python-course/24-Arays---Carry-FORWARD/part-013', 600),
  (24, 'Arrays: Carry Forward', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955768/python-course/24-Arays---Carry-FORWARD/part-014.mp4', 'python-course/24-Arays---Carry-FORWARD/part-014', 600),
  (24, 'Arrays: Carry Forward', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955770/python-course/24-Arays---Carry-FORWARD/part-015.mp4', 'python-course/24-Arays---Carry-FORWARD/part-015', 600),
  (24, 'Arrays: Carry Forward', 17, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955772/python-course/24-Arays---Carry-FORWARD/part-016.mp4', 'python-course/24-Arays---Carry-FORWARD/part-016', 600),
  (24, 'Arrays: Carry Forward', 18, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955774/python-course/24-Arays---Carry-FORWARD/part-017.mp4', 'python-course/24-Arays---Carry-FORWARD/part-017', 46),
  (25, 'Arrays: Subarrays', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955775/python-course/25-Array-Subarray/part-000.mp4', 'python-course/25-Array-Subarray/part-000', 600),
  (25, 'Arrays: Subarrays', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955777/python-course/25-Array-Subarray/part-001.mp4', 'python-course/25-Array-Subarray/part-001', 600),
  (25, 'Arrays: Subarrays', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955779/python-course/25-Array-Subarray/part-002.mp4', 'python-course/25-Array-Subarray/part-002', 600),
  (25, 'Arrays: Subarrays', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955782/python-course/25-Array-Subarray/part-003.mp4', 'python-course/25-Array-Subarray/part-003', 600),
  (25, 'Arrays: Subarrays', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955785/python-course/25-Array-Subarray/part-004.mp4', 'python-course/25-Array-Subarray/part-004', 600),
  (25, 'Arrays: Subarrays', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955788/python-course/25-Array-Subarray/part-005.mp4', 'python-course/25-Array-Subarray/part-005', 600),
  (25, 'Arrays: Subarrays', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955790/python-course/25-Array-Subarray/part-006.mp4', 'python-course/25-Array-Subarray/part-006', 600),
  (25, 'Arrays: Subarrays', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955792/python-course/25-Array-Subarray/part-007.mp4', 'python-course/25-Array-Subarray/part-007', 600),
  (25, 'Arrays: Subarrays', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955794/python-course/25-Array-Subarray/part-008.mp4', 'python-course/25-Array-Subarray/part-008', 600),
  (25, 'Arrays: Subarrays', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955796/python-course/25-Array-Subarray/part-009.mp4', 'python-course/25-Array-Subarray/part-009', 600),
  (25, 'Arrays: Subarrays', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955798/python-course/25-Array-Subarray/part-010.mp4', 'python-course/25-Array-Subarray/part-010', 600),
  (25, 'Arrays: Subarrays', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955799/python-course/25-Array-Subarray/part-011.mp4', 'python-course/25-Array-Subarray/part-011', 600),
  (25, 'Arrays: Subarrays', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955801/python-course/25-Array-Subarray/part-012.mp4', 'python-course/25-Array-Subarray/part-012', 600),
  (25, 'Arrays: Subarrays', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955803/python-course/25-Array-Subarray/part-013.mp4', 'python-course/25-Array-Subarray/part-013', 600),
  (25, 'Arrays: Subarrays', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955805/python-course/25-Array-Subarray/part-014.mp4', 'python-course/25-Array-Subarray/part-014', 600),
  (25, 'Arrays: Subarrays', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955807/python-course/25-Array-Subarray/part-015.mp4', 'python-course/25-Array-Subarray/part-015', 600),
  (25, 'Arrays: Subarrays', 17, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955808/python-course/25-Array-Subarray/part-016.mp4', 'python-course/25-Array-Subarray/part-016', 600),
  (25, 'Arrays: Subarrays', 18, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955810/python-course/25-Array-Subarray/part-017.mp4', 'python-course/25-Array-Subarray/part-017', 127),
  (26, 'Arrays: Matrices', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955811/python-course/26-Array---Matrices/part-000.mp4', 'python-course/26-Array---Matrices/part-000', 600),
  (26, 'Arrays: Matrices', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955813/python-course/26-Array---Matrices/part-001.mp4', 'python-course/26-Array---Matrices/part-001', 600),
  (26, 'Arrays: Matrices', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955814/python-course/26-Array---Matrices/part-002.mp4', 'python-course/26-Array---Matrices/part-002', 600),
  (26, 'Arrays: Matrices', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955816/python-course/26-Array---Matrices/part-003.mp4', 'python-course/26-Array---Matrices/part-003', 600),
  (26, 'Arrays: Matrices', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955818/python-course/26-Array---Matrices/part-004.mp4', 'python-course/26-Array---Matrices/part-004', 600),
  (26, 'Arrays: Matrices', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955820/python-course/26-Array---Matrices/part-005.mp4', 'python-course/26-Array---Matrices/part-005', 600),
  (26, 'Arrays: Matrices', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955821/python-course/26-Array---Matrices/part-006.mp4', 'python-course/26-Array---Matrices/part-006', 600),
  (26, 'Arrays: Matrices', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955823/python-course/26-Array---Matrices/part-007.mp4', 'python-course/26-Array---Matrices/part-007', 600),
  (26, 'Arrays: Matrices', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955826/python-course/26-Array---Matrices/part-008.mp4', 'python-course/26-Array---Matrices/part-008', 600),
  (26, 'Arrays: Matrices', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955828/python-course/26-Array---Matrices/part-009.mp4', 'python-course/26-Array---Matrices/part-009', 600),
  (26, 'Arrays: Matrices', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955830/python-course/26-Array---Matrices/part-010.mp4', 'python-course/26-Array---Matrices/part-010', 600),
  (26, 'Arrays: Matrices', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955831/python-course/26-Array---Matrices/part-011.mp4', 'python-course/26-Array---Matrices/part-011', 600),
  (26, 'Arrays: Matrices', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955833/python-course/26-Array---Matrices/part-012.mp4', 'python-course/26-Array---Matrices/part-012', 600),
  (26, 'Arrays: Matrices', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955835/python-course/26-Array---Matrices/part-013.mp4', 'python-course/26-Array---Matrices/part-013', 600),
  (26, 'Arrays: Matrices', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955837/python-course/26-Array---Matrices/part-014.mp4', 'python-course/26-Array---Matrices/part-014', 261),
  (27, 'Interview Questions', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955838/python-course/27-Interview-Questions/part-000.mp4', 'python-course/27-Interview-Questions/part-000', 600),
  (27, 'Interview Questions', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955840/python-course/27-Interview-Questions/part-001.mp4', 'python-course/27-Interview-Questions/part-001', 600),
  (27, 'Interview Questions', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955842/python-course/27-Interview-Questions/part-002.mp4', 'python-course/27-Interview-Questions/part-002', 600),
  (27, 'Interview Questions', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955844/python-course/27-Interview-Questions/part-003.mp4', 'python-course/27-Interview-Questions/part-003', 600),
  (27, 'Interview Questions', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955846/python-course/27-Interview-Questions/part-004.mp4', 'python-course/27-Interview-Questions/part-004', 600),
  (27, 'Interview Questions', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955847/python-course/27-Interview-Questions/part-005.mp4', 'python-course/27-Interview-Questions/part-005', 600),
  (27, 'Interview Questions', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955849/python-course/27-Interview-Questions/part-006.mp4', 'python-course/27-Interview-Questions/part-006', 600),
  (27, 'Interview Questions', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955851/python-course/27-Interview-Questions/part-007.mp4', 'python-course/27-Interview-Questions/part-007', 600),
  (27, 'Interview Questions', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955852/python-course/27-Interview-Questions/part-008.mp4', 'python-course/27-Interview-Questions/part-008', 600),
  (27, 'Interview Questions', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955854/python-course/27-Interview-Questions/part-009.mp4', 'python-course/27-Interview-Questions/part-009', 600),
  (27, 'Interview Questions', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955857/python-course/27-Interview-Questions/part-010.mp4', 'python-course/27-Interview-Questions/part-010', 600),
  (27, 'Interview Questions', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955858/python-course/27-Interview-Questions/part-011.mp4', 'python-course/27-Interview-Questions/part-011', 600),
  (27, 'Interview Questions', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955860/python-course/27-Interview-Questions/part-012.mp4', 'python-course/27-Interview-Questions/part-012', 600),
  (27, 'Interview Questions', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955862/python-course/27-Interview-Questions/part-013.mp4', 'python-course/27-Interview-Questions/part-013', 600),
  (27, 'Interview Questions', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955864/python-course/27-Interview-Questions/part-014.mp4', 'python-course/27-Interview-Questions/part-014', 600),
  (27, 'Interview Questions', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955866/python-course/27-Interview-Questions/part-015.mp4', 'python-course/27-Interview-Questions/part-015', 600),
  (27, 'Interview Questions', 17, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955868/python-course/27-Interview-Questions/part-016.mp4', 'python-course/27-Interview-Questions/part-016', 600),
  (27, 'Interview Questions', 18, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955871/python-course/27-Interview-Questions/part-017.mp4', 'python-course/27-Interview-Questions/part-017', 434),
  (28, 'Bit Manipulation 1', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955873/python-course/28-bit-manipulation-1/part-000.mp4', 'python-course/28-bit-manipulation-1/part-000', 600),
  (28, 'Bit Manipulation 1', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955878/python-course/28-bit-manipulation-1/part-001.mp4', 'python-course/28-bit-manipulation-1/part-001', 600),
  (28, 'Bit Manipulation 1', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955880/python-course/28-bit-manipulation-1/part-002.mp4', 'python-course/28-bit-manipulation-1/part-002', 600),
  (28, 'Bit Manipulation 1', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955882/python-course/28-bit-manipulation-1/part-003.mp4', 'python-course/28-bit-manipulation-1/part-003', 600),
  (28, 'Bit Manipulation 1', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955885/python-course/28-bit-manipulation-1/part-004.mp4', 'python-course/28-bit-manipulation-1/part-004', 600),
  (28, 'Bit Manipulation 1', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955887/python-course/28-bit-manipulation-1/part-005.mp4', 'python-course/28-bit-manipulation-1/part-005', 600),
  (28, 'Bit Manipulation 1', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955889/python-course/28-bit-manipulation-1/part-006.mp4', 'python-course/28-bit-manipulation-1/part-006', 600),
  (28, 'Bit Manipulation 1', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955891/python-course/28-bit-manipulation-1/part-007.mp4', 'python-course/28-bit-manipulation-1/part-007', 600),
  (28, 'Bit Manipulation 1', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955893/python-course/28-bit-manipulation-1/part-008.mp4', 'python-course/28-bit-manipulation-1/part-008', 600),
  (28, 'Bit Manipulation 1', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955894/python-course/28-bit-manipulation-1/part-009.mp4', 'python-course/28-bit-manipulation-1/part-009', 600),
  (28, 'Bit Manipulation 1', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955896/python-course/28-bit-manipulation-1/part-010.mp4', 'python-course/28-bit-manipulation-1/part-010', 600),
  (28, 'Bit Manipulation 1', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955898/python-course/28-bit-manipulation-1/part-011.mp4', 'python-course/28-bit-manipulation-1/part-011', 600),
  (28, 'Bit Manipulation 1', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955901/python-course/28-bit-manipulation-1/part-012.mp4', 'python-course/28-bit-manipulation-1/part-012', 600),
  (28, 'Bit Manipulation 1', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955903/python-course/28-bit-manipulation-1/part-013.mp4', 'python-course/28-bit-manipulation-1/part-013', 549),
  (29, 'Bit Manipulation 2', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955904/python-course/29-bit-manipulations-2/part-000.mp4', 'python-course/29-bit-manipulations-2/part-000', 600),
  (29, 'Bit Manipulation 2', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955906/python-course/29-bit-manipulations-2/part-001.mp4', 'python-course/29-bit-manipulations-2/part-001', 600),
  (29, 'Bit Manipulation 2', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955909/python-course/29-bit-manipulations-2/part-002.mp4', 'python-course/29-bit-manipulations-2/part-002', 600),
  (29, 'Bit Manipulation 2', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955911/python-course/29-bit-manipulations-2/part-003.mp4', 'python-course/29-bit-manipulations-2/part-003', 600),
  (29, 'Bit Manipulation 2', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955913/python-course/29-bit-manipulations-2/part-004.mp4', 'python-course/29-bit-manipulations-2/part-004', 600),
  (29, 'Bit Manipulation 2', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955915/python-course/29-bit-manipulations-2/part-005.mp4', 'python-course/29-bit-manipulations-2/part-005', 600),
  (29, 'Bit Manipulation 2', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955918/python-course/29-bit-manipulations-2/part-006.mp4', 'python-course/29-bit-manipulations-2/part-006', 600),
  (29, 'Bit Manipulation 2', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955919/python-course/29-bit-manipulations-2/part-007.mp4', 'python-course/29-bit-manipulations-2/part-007', 600),
  (29, 'Bit Manipulation 2', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955921/python-course/29-bit-manipulations-2/part-008.mp4', 'python-course/29-bit-manipulations-2/part-008', 600),
  (29, 'Bit Manipulation 2', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955924/python-course/29-bit-manipulations-2/part-009.mp4', 'python-course/29-bit-manipulations-2/part-009', 600),
  (29, 'Bit Manipulation 2', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955925/python-course/29-bit-manipulations-2/part-010.mp4', 'python-course/29-bit-manipulations-2/part-010', 600),
  (29, 'Bit Manipulation 2', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955927/python-course/29-bit-manipulations-2/part-011.mp4', 'python-course/29-bit-manipulations-2/part-011', 600),
  (29, 'Bit Manipulation 2', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955932/python-course/29-bit-manipulations-2/part-012.mp4', 'python-course/29-bit-manipulations-2/part-012', 600),
  (29, 'Bit Manipulation 2', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955935/python-course/29-bit-manipulations-2/part-013.mp4', 'python-course/29-bit-manipulations-2/part-013', 600),
  (29, 'Bit Manipulation 2', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955937/python-course/29-bit-manipulations-2/part-014.mp4', 'python-course/29-bit-manipulations-2/part-014', 600),
  (29, 'Bit Manipulation 2', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955938/python-course/29-bit-manipulations-2/part-015.mp4', 'python-course/29-bit-manipulations-2/part-015', 96),
  (30, 'Modular Arithmetic', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955941/python-course/30-Modular-arithmetic/part-000.mp4', 'python-course/30-Modular-arithmetic/part-000', 600),
  (30, 'Modular Arithmetic', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955944/python-course/30-Modular-arithmetic/part-001.mp4', 'python-course/30-Modular-arithmetic/part-001', 600),
  (30, 'Modular Arithmetic', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955946/python-course/30-Modular-arithmetic/part-002.mp4', 'python-course/30-Modular-arithmetic/part-002', 600),
  (30, 'Modular Arithmetic', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955948/python-course/30-Modular-arithmetic/part-003.mp4', 'python-course/30-Modular-arithmetic/part-003', 600),
  (30, 'Modular Arithmetic', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955950/python-course/30-Modular-arithmetic/part-004.mp4', 'python-course/30-Modular-arithmetic/part-004', 600),
  (30, 'Modular Arithmetic', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955952/python-course/30-Modular-arithmetic/part-005.mp4', 'python-course/30-Modular-arithmetic/part-005', 600),
  (30, 'Modular Arithmetic', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955955/python-course/30-Modular-arithmetic/part-006.mp4', 'python-course/30-Modular-arithmetic/part-006', 600),
  (30, 'Modular Arithmetic', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955956/python-course/30-Modular-arithmetic/part-007.mp4', 'python-course/30-Modular-arithmetic/part-007', 600),
  (30, 'Modular Arithmetic', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955958/python-course/30-Modular-arithmetic/part-008.mp4', 'python-course/30-Modular-arithmetic/part-008', 600),
  (30, 'Modular Arithmetic', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955960/python-course/30-Modular-arithmetic/part-009.mp4', 'python-course/30-Modular-arithmetic/part-009', 600),
  (30, 'Modular Arithmetic', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955963/python-course/30-Modular-arithmetic/part-010.mp4', 'python-course/30-Modular-arithmetic/part-010', 600),
  (30, 'Modular Arithmetic', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955965/python-course/30-Modular-arithmetic/part-011.mp4', 'python-course/30-Modular-arithmetic/part-011', 600),
  (30, 'Modular Arithmetic', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955967/python-course/30-Modular-arithmetic/part-012.mp4', 'python-course/30-Modular-arithmetic/part-012', 600),
  (30, 'Modular Arithmetic', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955969/python-course/30-Modular-arithmetic/part-013.mp4', 'python-course/30-Modular-arithmetic/part-013', 600),
  (30, 'Modular Arithmetic', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955972/python-course/30-Modular-arithmetic/part-014.mp4', 'python-course/30-Modular-arithmetic/part-014', 600),
  (30, 'Modular Arithmetic', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955974/python-course/30-Modular-arithmetic/part-015.mp4', 'python-course/30-Modular-arithmetic/part-015', 600),
  (30, 'Modular Arithmetic', 17, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955976/python-course/30-Modular-arithmetic/part-016.mp4', 'python-course/30-Modular-arithmetic/part-016', 600),
  (30, 'Modular Arithmetic', 18, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955980/python-course/30-Modular-arithmetic/part-017.mp4', 'python-course/30-Modular-arithmetic/part-017', 600),
  (30, 'Modular Arithmetic', 19, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955982/python-course/30-Modular-arithmetic/part-018.mp4', 'python-course/30-Modular-arithmetic/part-018', 425),
  (31, 'Arrays and Maths', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955984/python-course/31-Arrays-and-maths/part-000.mp4', 'python-course/31-Arrays-and-maths/part-000', 600),
  (31, 'Arrays and Maths', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955986/python-course/31-Arrays-and-maths/part-001.mp4', 'python-course/31-Arrays-and-maths/part-001', 600),
  (31, 'Arrays and Maths', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955988/python-course/31-Arrays-and-maths/part-002.mp4', 'python-course/31-Arrays-and-maths/part-002', 600),
  (31, 'Arrays and Maths', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955991/python-course/31-Arrays-and-maths/part-003.mp4', 'python-course/31-Arrays-and-maths/part-003', 600),
  (31, 'Arrays and Maths', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955993/python-course/31-Arrays-and-maths/part-004.mp4', 'python-course/31-Arrays-and-maths/part-004', 600),
  (31, 'Arrays and Maths', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955995/python-course/31-Arrays-and-maths/part-005.mp4', 'python-course/31-Arrays-and-maths/part-005', 600),
  (31, 'Arrays and Maths', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955997/python-course/31-Arrays-and-maths/part-006.mp4', 'python-course/31-Arrays-and-maths/part-006', 600),
  (31, 'Arrays and Maths', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791955999/python-course/31-Arrays-and-maths/part-007.mp4', 'python-course/31-Arrays-and-maths/part-007', 600),
  (31, 'Arrays and Maths', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956001/python-course/31-Arrays-and-maths/part-008.mp4', 'python-course/31-Arrays-and-maths/part-008', 600),
  (31, 'Arrays and Maths', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956003/python-course/31-Arrays-and-maths/part-009.mp4', 'python-course/31-Arrays-and-maths/part-009', 600),
  (31, 'Arrays and Maths', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956006/python-course/31-Arrays-and-maths/part-010.mp4', 'python-course/31-Arrays-and-maths/part-010', 600),
  (31, 'Arrays and Maths', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956008/python-course/31-Arrays-and-maths/part-011.mp4', 'python-course/31-Arrays-and-maths/part-011', 600),
  (31, 'Arrays and Maths', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956010/python-course/31-Arrays-and-maths/part-012.mp4', 'python-course/31-Arrays-and-maths/part-012', 600),
  (31, 'Arrays and Maths', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956012/python-course/31-Arrays-and-maths/part-013.mp4', 'python-course/31-Arrays-and-maths/part-013', 600),
  (31, 'Arrays and Maths', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956014/python-course/31-Arrays-and-maths/part-014.mp4', 'python-course/31-Arrays-and-maths/part-014', 600),
  (31, 'Arrays and Maths', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956016/python-course/31-Arrays-and-maths/part-015.mp4', 'python-course/31-Arrays-and-maths/part-015', 600),
  (31, 'Arrays and Maths', 17, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956019/python-course/31-Arrays-and-maths/part-016.mp4', 'python-course/31-Arrays-and-maths/part-016', 600),
  (31, 'Arrays and Maths', 18, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956021/python-course/31-Arrays-and-maths/part-017.mp4', 'python-course/31-Arrays-and-maths/part-017', 600),
  (31, 'Arrays and Maths', 19, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956023/python-course/31-Arrays-and-maths/part-018.mp4', 'python-course/31-Arrays-and-maths/part-018', 600),
  (31, 'Arrays and Maths', 20, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956025/python-course/31-Arrays-and-maths/part-019.mp4', 'python-course/31-Arrays-and-maths/part-019', 600),
  (31, 'Arrays and Maths', 21, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956026/python-course/31-Arrays-and-maths/part-020.mp4', 'python-course/31-Arrays-and-maths/part-020', 394),
  (32, 'Sorting', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956028/python-course/32-SORTING/part-000.mp4', 'python-course/32-SORTING/part-000', 600),
  (32, 'Sorting', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956030/python-course/32-SORTING/part-001.mp4', 'python-course/32-SORTING/part-001', 600),
  (32, 'Sorting', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956033/python-course/32-SORTING/part-002.mp4', 'python-course/32-SORTING/part-002', 600),
  (32, 'Sorting', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956035/python-course/32-SORTING/part-003.mp4', 'python-course/32-SORTING/part-003', 600),
  (32, 'Sorting', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956037/python-course/32-SORTING/part-004.mp4', 'python-course/32-SORTING/part-004', 600),
  (32, 'Sorting', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956039/python-course/32-SORTING/part-005.mp4', 'python-course/32-SORTING/part-005', 600),
  (32, 'Sorting', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956040/python-course/32-SORTING/part-006.mp4', 'python-course/32-SORTING/part-006', 600),
  (32, 'Sorting', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956042/python-course/32-SORTING/part-007.mp4', 'python-course/32-SORTING/part-007', 600),
  (32, 'Sorting', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956044/python-course/32-SORTING/part-008.mp4', 'python-course/32-SORTING/part-008', 600),
  (32, 'Sorting', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956045/python-course/32-SORTING/part-009.mp4', 'python-course/32-SORTING/part-009', 600),
  (32, 'Sorting', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956047/python-course/32-SORTING/part-010.mp4', 'python-course/32-SORTING/part-010', 600),
  (32, 'Sorting', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956049/python-course/32-SORTING/part-011.mp4', 'python-course/32-SORTING/part-011', 600),
  (32, 'Sorting', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956050/python-course/32-SORTING/part-012.mp4', 'python-course/32-SORTING/part-012', 600),
  (32, 'Sorting', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956052/python-course/32-SORTING/part-013.mp4', 'python-course/32-SORTING/part-013', 600),
  (32, 'Sorting', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956054/python-course/32-SORTING/part-014.mp4', 'python-course/32-SORTING/part-014', 600),
  (32, 'Sorting', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956056/python-course/32-SORTING/part-015.mp4', 'python-course/32-SORTING/part-015', 600),
  (32, 'Sorting', 17, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956058/python-course/32-SORTING/part-016.mp4', 'python-course/32-SORTING/part-016', 600),
  (32, 'Sorting', 18, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956059/python-course/32-SORTING/part-017.mp4', 'python-course/32-SORTING/part-017', 571),
  (33, 'Sorting (Continued)', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956061/python-course/33-Sorting-continued/part-000.mp4', 'python-course/33-Sorting-continued/part-000', 600),
  (33, 'Sorting (Continued)', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956063/python-course/33-Sorting-continued/part-001.mp4', 'python-course/33-Sorting-continued/part-001', 600),
  (33, 'Sorting (Continued)', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956065/python-course/33-Sorting-continued/part-002.mp4', 'python-course/33-Sorting-continued/part-002', 600),
  (33, 'Sorting (Continued)', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956066/python-course/33-Sorting-continued/part-003.mp4', 'python-course/33-Sorting-continued/part-003', 600),
  (33, 'Sorting (Continued)', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956068/python-course/33-Sorting-continued/part-004.mp4', 'python-course/33-Sorting-continued/part-004', 600),
  (33, 'Sorting (Continued)', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956070/python-course/33-Sorting-continued/part-005.mp4', 'python-course/33-Sorting-continued/part-005', 600),
  (33, 'Sorting (Continued)', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956072/python-course/33-Sorting-continued/part-006.mp4', 'python-course/33-Sorting-continued/part-006', 600),
  (33, 'Sorting (Continued)', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956074/python-course/33-Sorting-continued/part-007.mp4', 'python-course/33-Sorting-continued/part-007', 600),
  (33, 'Sorting (Continued)', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956076/python-course/33-Sorting-continued/part-008.mp4', 'python-course/33-Sorting-continued/part-008', 600),
  (33, 'Sorting (Continued)', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956078/python-course/33-Sorting-continued/part-009.mp4', 'python-course/33-Sorting-continued/part-009', 600),
  (33, 'Sorting (Continued)', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956080/python-course/33-Sorting-continued/part-010.mp4', 'python-course/33-Sorting-continued/part-010', 600),
  (33, 'Sorting (Continued)', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956082/python-course/33-Sorting-continued/part-011.mp4', 'python-course/33-Sorting-continued/part-011', 600),
  (33, 'Sorting (Continued)', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956083/python-course/33-Sorting-continued/part-012.mp4', 'python-course/33-Sorting-continued/part-012', 600),
  (33, 'Sorting (Continued)', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956085/python-course/33-Sorting-continued/part-013.mp4', 'python-course/33-Sorting-continued/part-013', 600),
  (33, 'Sorting (Continued)', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956087/python-course/33-Sorting-continued/part-014.mp4', 'python-course/33-Sorting-continued/part-014', 600),
  (33, 'Sorting (Continued)', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956089/python-course/33-Sorting-continued/part-015.mp4', 'python-course/33-Sorting-continued/part-015', 600),
  (33, 'Sorting (Continued)', 17, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956090/python-course/33-Sorting-continued/part-016.mp4', 'python-course/33-Sorting-continued/part-016', 240),
  (34, 'Strings', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956092/python-course/34-Strings/part-000.mp4', 'python-course/34-Strings/part-000', 600),
  (34, 'Strings', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956093/python-course/34-Strings/part-001.mp4', 'python-course/34-Strings/part-001', 600),
  (34, 'Strings', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956095/python-course/34-Strings/part-002.mp4', 'python-course/34-Strings/part-002', 600),
  (34, 'Strings', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956097/python-course/34-Strings/part-003.mp4', 'python-course/34-Strings/part-003', 600),
  (34, 'Strings', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956099/python-course/34-Strings/part-004.mp4', 'python-course/34-Strings/part-004', 600),
  (34, 'Strings', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956100/python-course/34-Strings/part-005.mp4', 'python-course/34-Strings/part-005', 600),
  (34, 'Strings', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956102/python-course/34-Strings/part-006.mp4', 'python-course/34-Strings/part-006', 600),
  (34, 'Strings', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956103/python-course/34-Strings/part-007.mp4', 'python-course/34-Strings/part-007', 600),
  (34, 'Strings', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956105/python-course/34-Strings/part-008.mp4', 'python-course/34-Strings/part-008', 600),
  (34, 'Strings', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956107/python-course/34-Strings/part-009.mp4', 'python-course/34-Strings/part-009', 600),
  (34, 'Strings', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956109/python-course/34-Strings/part-010.mp4', 'python-course/34-Strings/part-010', 600),
  (34, 'Strings', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956110/python-course/34-Strings/part-011.mp4', 'python-course/34-Strings/part-011', 600),
  (34, 'Strings', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956111/python-course/34-Strings/part-012.mp4', 'python-course/34-Strings/part-012', 600),
  (34, 'Strings', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956113/python-course/34-Strings/part-013.mp4', 'python-course/34-Strings/part-013', 600),
  (34, 'Strings', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956115/python-course/34-Strings/part-014.mp4', 'python-course/34-Strings/part-014', 600),
  (34, 'Strings', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956117/python-course/34-Strings/part-015.mp4', 'python-course/34-Strings/part-015', 600),
  (34, 'Strings', 17, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956118/python-course/34-Strings/part-016.mp4', 'python-course/34-Strings/part-016', 600),
  (34, 'Strings', 18, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956120/python-course/34-Strings/part-017.mp4', 'python-course/34-Strings/part-017', 396),
  (35, 'Hashing 1', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956122/python-course/35-Hashing-1/part-000.mp4', 'python-course/35-Hashing-1/part-000', 600),
  (35, 'Hashing 1', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956124/python-course/35-Hashing-1/part-001.mp4', 'python-course/35-Hashing-1/part-001', 600),
  (35, 'Hashing 1', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956125/python-course/35-Hashing-1/part-002.mp4', 'python-course/35-Hashing-1/part-002', 600),
  (35, 'Hashing 1', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956127/python-course/35-Hashing-1/part-003.mp4', 'python-course/35-Hashing-1/part-003', 600),
  (35, 'Hashing 1', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956129/python-course/35-Hashing-1/part-004.mp4', 'python-course/35-Hashing-1/part-004', 600),
  (35, 'Hashing 1', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956131/python-course/35-Hashing-1/part-005.mp4', 'python-course/35-Hashing-1/part-005', 600),
  (35, 'Hashing 1', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956134/python-course/35-Hashing-1/part-006.mp4', 'python-course/35-Hashing-1/part-006', 600),
  (35, 'Hashing 1', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956136/python-course/35-Hashing-1/part-007.mp4', 'python-course/35-Hashing-1/part-007', 600),
  (35, 'Hashing 1', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956138/python-course/35-Hashing-1/part-008.mp4', 'python-course/35-Hashing-1/part-008', 600),
  (35, 'Hashing 1', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956140/python-course/35-Hashing-1/part-009.mp4', 'python-course/35-Hashing-1/part-009', 600),
  (35, 'Hashing 1', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956141/python-course/35-Hashing-1/part-010.mp4', 'python-course/35-Hashing-1/part-010', 600),
  (35, 'Hashing 1', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956143/python-course/35-Hashing-1/part-011.mp4', 'python-course/35-Hashing-1/part-011', 600),
  (35, 'Hashing 1', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956145/python-course/35-Hashing-1/part-012.mp4', 'python-course/35-Hashing-1/part-012', 600),
  (35, 'Hashing 1', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956147/python-course/35-Hashing-1/part-013.mp4', 'python-course/35-Hashing-1/part-013', 600),
  (35, 'Hashing 1', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956150/python-course/35-Hashing-1/part-014.mp4', 'python-course/35-Hashing-1/part-014', 600),
  (35, 'Hashing 1', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956151/python-course/35-Hashing-1/part-015.mp4', 'python-course/35-Hashing-1/part-015', 532),
  (36, 'Hashing 2', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956228/python-course/36-Hashing-2/part-000.mp4', 'python-course/36-Hashing-2/part-000', 600),
  (36, 'Hashing 2', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956230/python-course/36-Hashing-2/part-001.mp4', 'python-course/36-Hashing-2/part-001', 600),
  (36, 'Hashing 2', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956232/python-course/36-Hashing-2/part-002.mp4', 'python-course/36-Hashing-2/part-002', 600),
  (36, 'Hashing 2', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956234/python-course/36-Hashing-2/part-003.mp4', 'python-course/36-Hashing-2/part-003', 600),
  (36, 'Hashing 2', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956236/python-course/36-Hashing-2/part-004.mp4', 'python-course/36-Hashing-2/part-004', 600),
  (36, 'Hashing 2', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956238/python-course/36-Hashing-2/part-005.mp4', 'python-course/36-Hashing-2/part-005', 600),
  (36, 'Hashing 2', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956240/python-course/36-Hashing-2/part-006.mp4', 'python-course/36-Hashing-2/part-006', 600),
  (36, 'Hashing 2', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956242/python-course/36-Hashing-2/part-007.mp4', 'python-course/36-Hashing-2/part-007', 600),
  (36, 'Hashing 2', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956245/python-course/36-Hashing-2/part-008.mp4', 'python-course/36-Hashing-2/part-008', 600),
  (36, 'Hashing 2', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956247/python-course/36-Hashing-2/part-009.mp4', 'python-course/36-Hashing-2/part-009', 600),
  (36, 'Hashing 2', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956249/python-course/36-Hashing-2/part-010.mp4', 'python-course/36-Hashing-2/part-010', 600),
  (36, 'Hashing 2', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956251/python-course/36-Hashing-2/part-011.mp4', 'python-course/36-Hashing-2/part-011', 600),
  (36, 'Hashing 2', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956253/python-course/36-Hashing-2/part-012.mp4', 'python-course/36-Hashing-2/part-012', 600),
  (36, 'Hashing 2', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956255/python-course/36-Hashing-2/part-013.mp4', 'python-course/36-Hashing-2/part-013', 600),
  (36, 'Hashing 2', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956256/python-course/36-Hashing-2/part-014.mp4', 'python-course/36-Hashing-2/part-014', 600),
  (36, 'Hashing 2', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956258/python-course/36-Hashing-2/part-015.mp4', 'python-course/36-Hashing-2/part-015', 98),
  (37, 'Problem Solving', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956153/python-course/36-1-Problem-solving/part-000.mp4', 'python-course/36-1-Problem-solving/part-000', 600),
  (37, 'Problem Solving', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956155/python-course/36-1-Problem-solving/part-001.mp4', 'python-course/36-1-Problem-solving/part-001', 600),
  (37, 'Problem Solving', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956157/python-course/36-1-Problem-solving/part-002.mp4', 'python-course/36-1-Problem-solving/part-002', 600),
  (37, 'Problem Solving', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956159/python-course/36-1-Problem-solving/part-003.mp4', 'python-course/36-1-Problem-solving/part-003', 600),
  (37, 'Problem Solving', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956161/python-course/36-1-Problem-solving/part-004.mp4', 'python-course/36-1-Problem-solving/part-004', 600),
  (37, 'Problem Solving', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956163/python-course/36-1-Problem-solving/part-005.mp4', 'python-course/36-1-Problem-solving/part-005', 600),
  (37, 'Problem Solving', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956166/python-course/36-1-Problem-solving/part-006.mp4', 'python-course/36-1-Problem-solving/part-006', 600),
  (37, 'Problem Solving', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956168/python-course/36-1-Problem-solving/part-007.mp4', 'python-course/36-1-Problem-solving/part-007', 600),
  (37, 'Problem Solving', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956170/python-course/36-1-Problem-solving/part-008.mp4', 'python-course/36-1-Problem-solving/part-008', 600),
  (37, 'Problem Solving', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956173/python-course/36-1-Problem-solving/part-009.mp4', 'python-course/36-1-Problem-solving/part-009', 600),
  (37, 'Problem Solving', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956175/python-course/36-1-Problem-solving/part-010.mp4', 'python-course/36-1-Problem-solving/part-010', 600),
  (37, 'Problem Solving', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956177/python-course/36-1-Problem-solving/part-011.mp4', 'python-course/36-1-Problem-solving/part-011', 600),
  (37, 'Problem Solving', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956180/python-course/36-1-Problem-solving/part-012.mp4', 'python-course/36-1-Problem-solving/part-012', 600),
  (37, 'Problem Solving', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956183/python-course/36-1-Problem-solving/part-013.mp4', 'python-course/36-1-Problem-solving/part-013', 600),
  (37, 'Problem Solving', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956186/python-course/36-1-Problem-solving/part-014.mp4', 'python-course/36-1-Problem-solving/part-014', 600),
  (37, 'Problem Solving', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956188/python-course/36-1-Problem-solving/part-015.mp4', 'python-course/36-1-Problem-solving/part-015', 600),
  (37, 'Problem Solving', 17, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956191/python-course/36-1-Problem-solving/part-016.mp4', 'python-course/36-1-Problem-solving/part-016', 600),
  (37, 'Problem Solving', 18, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956193/python-course/36-1-Problem-solving/part-017.mp4', 'python-course/36-1-Problem-solving/part-017', 600),
  (37, 'Problem Solving', 19, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956195/python-course/36-1-Problem-solving/part-018.mp4', 'python-course/36-1-Problem-solving/part-018', 600),
  (37, 'Problem Solving', 20, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956198/python-course/36-1-Problem-solving/part-019.mp4', 'python-course/36-1-Problem-solving/part-019', 494),
  (38, 'Intermediate DSA: Problem Solving 1', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956200/python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-000.mp4', 'python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-000', 600),
  (38, 'Intermediate DSA: Problem Solving 1', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956202/python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-001.mp4', 'python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-001', 600),
  (38, 'Intermediate DSA: Problem Solving 1', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956204/python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-002.mp4', 'python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-002', 600),
  (38, 'Intermediate DSA: Problem Solving 1', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956206/python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-003.mp4', 'python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-003', 600),
  (38, 'Intermediate DSA: Problem Solving 1', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956208/python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-004.mp4', 'python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-004', 600),
  (38, 'Intermediate DSA: Problem Solving 1', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956210/python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-005.mp4', 'python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-005', 600),
  (38, 'Intermediate DSA: Problem Solving 1', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956212/python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-006.mp4', 'python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-006', 600),
  (38, 'Intermediate DSA: Problem Solving 1', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956214/python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-007.mp4', 'python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-007', 600),
  (38, 'Intermediate DSA: Problem Solving 1', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956216/python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-008.mp4', 'python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-008', 600),
  (38, 'Intermediate DSA: Problem Solving 1', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956218/python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-009.mp4', 'python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-009', 600),
  (38, 'Intermediate DSA: Problem Solving 1', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956220/python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-010.mp4', 'python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-010', 600),
  (38, 'Intermediate DSA: Problem Solving 1', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956222/python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-011.mp4', 'python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-011', 600),
  (38, 'Intermediate DSA: Problem Solving 1', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956224/python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-012.mp4', 'python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-012', 600),
  (38, 'Intermediate DSA: Problem Solving 1', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956225/python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-013.mp4', 'python-course/36-2-DSML-Intermediate-DSA_-Problem-Solving---1/part-013', 321),
  (39, 'Recursion 1', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956292/python-course/37-Recursion-1/part-000.mp4', 'python-course/37-Recursion-1/part-000', 600),
  (39, 'Recursion 1', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956295/python-course/37-Recursion-1/part-001.mp4', 'python-course/37-Recursion-1/part-001', 600),
  (39, 'Recursion 1', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956296/python-course/37-Recursion-1/part-002.mp4', 'python-course/37-Recursion-1/part-002', 600),
  (39, 'Recursion 1', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956298/python-course/37-Recursion-1/part-003.mp4', 'python-course/37-Recursion-1/part-003', 600),
  (39, 'Recursion 1', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956299/python-course/37-Recursion-1/part-004.mp4', 'python-course/37-Recursion-1/part-004', 600),
  (39, 'Recursion 1', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956301/python-course/37-Recursion-1/part-005.mp4', 'python-course/37-Recursion-1/part-005', 600),
  (39, 'Recursion 1', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956303/python-course/37-Recursion-1/part-006.mp4', 'python-course/37-Recursion-1/part-006', 600),
  (39, 'Recursion 1', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956304/python-course/37-Recursion-1/part-007.mp4', 'python-course/37-Recursion-1/part-007', 217),
  (40, 'Recursion 1: Follow-up', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956259/python-course/37-1-recursion-1-follow-up-/part-000.mp4', 'python-course/37-1-recursion-1-follow-up-/part-000', 600),
  (40, 'Recursion 1: Follow-up', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956261/python-course/37-1-recursion-1-follow-up-/part-001.mp4', 'python-course/37-1-recursion-1-follow-up-/part-001', 600),
  (40, 'Recursion 1: Follow-up', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956263/python-course/37-1-recursion-1-follow-up-/part-002.mp4', 'python-course/37-1-recursion-1-follow-up-/part-002', 600),
  (40, 'Recursion 1: Follow-up', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956265/python-course/37-1-recursion-1-follow-up-/part-003.mp4', 'python-course/37-1-recursion-1-follow-up-/part-003', 600),
  (40, 'Recursion 1: Follow-up', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956267/python-course/37-1-recursion-1-follow-up-/part-004.mp4', 'python-course/37-1-recursion-1-follow-up-/part-004', 600),
  (40, 'Recursion 1: Follow-up', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956269/python-course/37-1-recursion-1-follow-up-/part-005.mp4', 'python-course/37-1-recursion-1-follow-up-/part-005', 600),
  (40, 'Recursion 1: Follow-up', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956272/python-course/37-1-recursion-1-follow-up-/part-006.mp4', 'python-course/37-1-recursion-1-follow-up-/part-006', 600),
  (40, 'Recursion 1: Follow-up', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956275/python-course/37-1-recursion-1-follow-up-/part-007.mp4', 'python-course/37-1-recursion-1-follow-up-/part-007', 600),
  (40, 'Recursion 1: Follow-up', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956277/python-course/37-1-recursion-1-follow-up-/part-008.mp4', 'python-course/37-1-recursion-1-follow-up-/part-008', 600),
  (40, 'Recursion 1: Follow-up', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956280/python-course/37-1-recursion-1-follow-up-/part-009.mp4', 'python-course/37-1-recursion-1-follow-up-/part-009', 600),
  (40, 'Recursion 1: Follow-up', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956282/python-course/37-1-recursion-1-follow-up-/part-010.mp4', 'python-course/37-1-recursion-1-follow-up-/part-010', 600),
  (40, 'Recursion 1: Follow-up', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956284/python-course/37-1-recursion-1-follow-up-/part-011.mp4', 'python-course/37-1-recursion-1-follow-up-/part-011', 600),
  (40, 'Recursion 1: Follow-up', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956286/python-course/37-1-recursion-1-follow-up-/part-012.mp4', 'python-course/37-1-recursion-1-follow-up-/part-012', 600),
  (40, 'Recursion 1: Follow-up', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956288/python-course/37-1-recursion-1-follow-up-/part-013.mp4', 'python-course/37-1-recursion-1-follow-up-/part-013', 600),
  (40, 'Recursion 1: Follow-up', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956290/python-course/37-1-recursion-1-follow-up-/part-014.mp4', 'python-course/37-1-recursion-1-follow-up-/part-014', 132),
  (41, 'Recursion 2', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956307/python-course/38-Recusrion-2/part-000.mp4', 'python-course/38-Recusrion-2/part-000', 600),
  (41, 'Recursion 2', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956309/python-course/38-Recusrion-2/part-001.mp4', 'python-course/38-Recusrion-2/part-001', 600),
  (41, 'Recursion 2', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956311/python-course/38-Recusrion-2/part-002.mp4', 'python-course/38-Recusrion-2/part-002', 600),
  (41, 'Recursion 2', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956313/python-course/38-Recusrion-2/part-003.mp4', 'python-course/38-Recusrion-2/part-003', 600),
  (41, 'Recursion 2', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956315/python-course/38-Recusrion-2/part-004.mp4', 'python-course/38-Recusrion-2/part-004', 600),
  (41, 'Recursion 2', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956317/python-course/38-Recusrion-2/part-005.mp4', 'python-course/38-Recusrion-2/part-005', 600),
  (41, 'Recursion 2', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956319/python-course/38-Recusrion-2/part-006.mp4', 'python-course/38-Recusrion-2/part-006', 600),
  (41, 'Recursion 2', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956321/python-course/38-Recusrion-2/part-007.mp4', 'python-course/38-Recusrion-2/part-007', 600),
  (41, 'Recursion 2', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956323/python-course/38-Recusrion-2/part-008.mp4', 'python-course/38-Recusrion-2/part-008', 600),
  (41, 'Recursion 2', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956326/python-course/38-Recusrion-2/part-009.mp4', 'python-course/38-Recusrion-2/part-009', 600),
  (41, 'Recursion 2', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956328/python-course/38-Recusrion-2/part-010.mp4', 'python-course/38-Recusrion-2/part-010', 600),
  (41, 'Recursion 2', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956330/python-course/38-Recusrion-2/part-011.mp4', 'python-course/38-Recusrion-2/part-011', 600),
  (41, 'Recursion 2', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956331/python-course/38-Recusrion-2/part-012.mp4', 'python-course/38-Recusrion-2/part-012', 600),
  (41, 'Recursion 2', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956333/python-course/38-Recusrion-2/part-013.mp4', 'python-course/38-Recusrion-2/part-013', 600),
  (41, 'Recursion 2', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956335/python-course/38-Recusrion-2/part-014.mp4', 'python-course/38-Recusrion-2/part-014', 600),
  (41, 'Recursion 2', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956337/python-course/38-Recusrion-2/part-015.mp4', 'python-course/38-Recusrion-2/part-015', 600),
  (41, 'Recursion 2', 17, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956338/python-course/38-Recusrion-2/part-016.mp4', 'python-course/38-Recusrion-2/part-016', 46),
  (42, 'Subsets and Subsequences', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956340/python-course/39-Subset-and-subsequence-/part-000.mp4', 'python-course/39-Subset-and-subsequence-/part-000', 600),
  (42, 'Subsets and Subsequences', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956342/python-course/39-Subset-and-subsequence-/part-001.mp4', 'python-course/39-Subset-and-subsequence-/part-001', 600),
  (42, 'Subsets and Subsequences', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956343/python-course/39-Subset-and-subsequence-/part-002.mp4', 'python-course/39-Subset-and-subsequence-/part-002', 600),
  (42, 'Subsets and Subsequences', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956345/python-course/39-Subset-and-subsequence-/part-003.mp4', 'python-course/39-Subset-and-subsequence-/part-003', 600),
  (42, 'Subsets and Subsequences', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956347/python-course/39-Subset-and-subsequence-/part-004.mp4', 'python-course/39-Subset-and-subsequence-/part-004', 600),
  (42, 'Subsets and Subsequences', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956349/python-course/39-Subset-and-subsequence-/part-005.mp4', 'python-course/39-Subset-and-subsequence-/part-005', 600),
  (42, 'Subsets and Subsequences', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956351/python-course/39-Subset-and-subsequence-/part-006.mp4', 'python-course/39-Subset-and-subsequence-/part-006', 600),
  (42, 'Subsets and Subsequences', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956352/python-course/39-Subset-and-subsequence-/part-007.mp4', 'python-course/39-Subset-and-subsequence-/part-007', 600),
  (42, 'Subsets and Subsequences', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956354/python-course/39-Subset-and-subsequence-/part-008.mp4', 'python-course/39-Subset-and-subsequence-/part-008', 600),
  (42, 'Subsets and Subsequences', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956355/python-course/39-Subset-and-subsequence-/part-009.mp4', 'python-course/39-Subset-and-subsequence-/part-009', 600),
  (42, 'Subsets and Subsequences', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956357/python-course/39-Subset-and-subsequence-/part-010.mp4', 'python-course/39-Subset-and-subsequence-/part-010', 600),
  (42, 'Subsets and Subsequences', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956359/python-course/39-Subset-and-subsequence-/part-011.mp4', 'python-course/39-Subset-and-subsequence-/part-011', 600),
  (42, 'Subsets and Subsequences', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956360/python-course/39-Subset-and-subsequence-/part-012.mp4', 'python-course/39-Subset-and-subsequence-/part-012', 600),
  (42, 'Subsets and Subsequences', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956362/python-course/39-Subset-and-subsequence-/part-013.mp4', 'python-course/39-Subset-and-subsequence-/part-013', 600),
  (42, 'Subsets and Subsequences', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956364/python-course/39-Subset-and-subsequence-/part-014.mp4', 'python-course/39-Subset-and-subsequence-/part-014', 600),
  (42, 'Subsets and Subsequences', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956366/python-course/39-Subset-and-subsequence-/part-015.mp4', 'python-course/39-Subset-and-subsequence-/part-015', 600),
  (42, 'Subsets and Subsequences', 17, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956367/python-course/39-Subset-and-subsequence-/part-016.mp4', 'python-course/39-Subset-and-subsequence-/part-016', 600),
  (42, 'Subsets and Subsequences', 18, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956368/python-course/39-Subset-and-subsequence-/part-017.mp4', 'python-course/39-Subset-and-subsequence-/part-017', 274),
  (43, 'Linked List Basics', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956370/python-course/40-Linked-List-basics/part-000.mp4', 'python-course/40-Linked-List-basics/part-000', 600),
  (43, 'Linked List Basics', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956372/python-course/40-Linked-List-basics/part-001.mp4', 'python-course/40-Linked-List-basics/part-001', 600),
  (43, 'Linked List Basics', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956373/python-course/40-Linked-List-basics/part-002.mp4', 'python-course/40-Linked-List-basics/part-002', 600),
  (43, 'Linked List Basics', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956375/python-course/40-Linked-List-basics/part-003.mp4', 'python-course/40-Linked-List-basics/part-003', 600),
  (43, 'Linked List Basics', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956376/python-course/40-Linked-List-basics/part-004.mp4', 'python-course/40-Linked-List-basics/part-004', 600),
  (43, 'Linked List Basics', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956378/python-course/40-Linked-List-basics/part-005.mp4', 'python-course/40-Linked-List-basics/part-005', 600),
  (43, 'Linked List Basics', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956380/python-course/40-Linked-List-basics/part-006.mp4', 'python-course/40-Linked-List-basics/part-006', 600),
  (43, 'Linked List Basics', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956381/python-course/40-Linked-List-basics/part-007.mp4', 'python-course/40-Linked-List-basics/part-007', 600),
  (43, 'Linked List Basics', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956383/python-course/40-Linked-List-basics/part-008.mp4', 'python-course/40-Linked-List-basics/part-008', 600),
  (43, 'Linked List Basics', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956384/python-course/40-Linked-List-basics/part-009.mp4', 'python-course/40-Linked-List-basics/part-009', 600),
  (43, 'Linked List Basics', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956386/python-course/40-Linked-List-basics/part-010.mp4', 'python-course/40-Linked-List-basics/part-010', 600),
  (43, 'Linked List Basics', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956388/python-course/40-Linked-List-basics/part-011.mp4', 'python-course/40-Linked-List-basics/part-011', 600),
  (43, 'Linked List Basics', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956389/python-course/40-Linked-List-basics/part-012.mp4', 'python-course/40-Linked-List-basics/part-012', 600),
  (43, 'Linked List Basics', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956391/python-course/40-Linked-List-basics/part-013.mp4', 'python-course/40-Linked-List-basics/part-013', 600),
  (43, 'Linked List Basics', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956393/python-course/40-Linked-List-basics/part-014.mp4', 'python-course/40-Linked-List-basics/part-014', 600),
  (43, 'Linked List Basics', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956395/python-course/40-Linked-List-basics/part-015.mp4', 'python-course/40-Linked-List-basics/part-015', 600),
  (43, 'Linked List Basics', 17, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956396/python-course/40-Linked-List-basics/part-016.mp4', 'python-course/40-Linked-List-basics/part-016', 247),
  (44, 'Stacks and Queues', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956399/python-course/41-Stack-and-Queues/part-000.mp4', 'python-course/41-Stack-and-Queues/part-000', 600),
  (44, 'Stacks and Queues', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956401/python-course/41-Stack-and-Queues/part-001.mp4', 'python-course/41-Stack-and-Queues/part-001', 600),
  (44, 'Stacks and Queues', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956403/python-course/41-Stack-and-Queues/part-002.mp4', 'python-course/41-Stack-and-Queues/part-002', 600),
  (44, 'Stacks and Queues', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956405/python-course/41-Stack-and-Queues/part-003.mp4', 'python-course/41-Stack-and-Queues/part-003', 600),
  (44, 'Stacks and Queues', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956407/python-course/41-Stack-and-Queues/part-004.mp4', 'python-course/41-Stack-and-Queues/part-004', 600),
  (44, 'Stacks and Queues', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956409/python-course/41-Stack-and-Queues/part-005.mp4', 'python-course/41-Stack-and-Queues/part-005', 600),
  (44, 'Stacks and Queues', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956410/python-course/41-Stack-and-Queues/part-006.mp4', 'python-course/41-Stack-and-Queues/part-006', 600),
  (44, 'Stacks and Queues', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956412/python-course/41-Stack-and-Queues/part-007.mp4', 'python-course/41-Stack-and-Queues/part-007', 600),
  (44, 'Stacks and Queues', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956413/python-course/41-Stack-and-Queues/part-008.mp4', 'python-course/41-Stack-and-Queues/part-008', 600),
  (44, 'Stacks and Queues', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956415/python-course/41-Stack-and-Queues/part-009.mp4', 'python-course/41-Stack-and-Queues/part-009', 600),
  (44, 'Stacks and Queues', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956417/python-course/41-Stack-and-Queues/part-010.mp4', 'python-course/41-Stack-and-Queues/part-010', 600),
  (44, 'Stacks and Queues', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956418/python-course/41-Stack-and-Queues/part-011.mp4', 'python-course/41-Stack-and-Queues/part-011', 600),
  (44, 'Stacks and Queues', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956420/python-course/41-Stack-and-Queues/part-012.mp4', 'python-course/41-Stack-and-Queues/part-012', 600),
  (44, 'Stacks and Queues', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956422/python-course/41-Stack-and-Queues/part-013.mp4', 'python-course/41-Stack-and-Queues/part-013', 600),
  (44, 'Stacks and Queues', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956423/python-course/41-Stack-and-Queues/part-014.mp4', 'python-course/41-Stack-and-Queues/part-014', 600),
  (44, 'Stacks and Queues', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956426/python-course/41-Stack-and-Queues/part-015.mp4', 'python-course/41-Stack-and-Queues/part-015', 600),
  (44, 'Stacks and Queues', 17, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956427/python-course/41-Stack-and-Queues/part-016.mp4', 'python-course/41-Stack-and-Queues/part-016', 254),
  (45, 'Trees Basics 1', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956459/python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-000.mp4', 'python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-000', 600),
  (45, 'Trees Basics 1', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956461/python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-001.mp4', 'python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-001', 600),
  (45, 'Trees Basics 1', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956463/python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-002.mp4', 'python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-002', 600),
  (45, 'Trees Basics 1', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956465/python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-003.mp4', 'python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-003', 600),
  (45, 'Trees Basics 1', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956467/python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-004.mp4', 'python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-004', 600),
  (45, 'Trees Basics 1', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956469/python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-005.mp4', 'python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-005', 600),
  (45, 'Trees Basics 1', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956471/python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-006.mp4', 'python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-006', 600),
  (45, 'Trees Basics 1', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956472/python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-007.mp4', 'python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-007', 600),
  (45, 'Trees Basics 1', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956474/python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-008.mp4', 'python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-008', 600),
  (45, 'Trees Basics 1', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956475/python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-009.mp4', 'python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-009', 600),
  (45, 'Trees Basics 1', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956477/python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-010.mp4', 'python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-010', 600),
  (45, 'Trees Basics 1', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956479/python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-011.mp4', 'python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-011', 600),
  (45, 'Trees Basics 1', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956481/python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-012.mp4', 'python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-012', 600),
  (45, 'Trees Basics 1', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956483/python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-013.mp4', 'python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-013', 600),
  (45, 'Trees Basics 1', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956484/python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-014.mp4', 'python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-014', 600),
  (45, 'Trees Basics 1', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956486/python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-015.mp4', 'python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-015', 600),
  (45, 'Trees Basics 1', 17, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956488/python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-016.mp4', 'python-course/42-DSML-Intermediate-_-Trees-Basics---1/part-016', 576),
  (46, 'Trees Basics 2', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956429/python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-000.mp4', 'python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-000', 600),
  (46, 'Trees Basics 2', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956430/python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-001.mp4', 'python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-001', 600),
  (46, 'Trees Basics 2', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956432/python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-002.mp4', 'python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-002', 600),
  (46, 'Trees Basics 2', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956434/python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-003.mp4', 'python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-003', 600),
  (46, 'Trees Basics 2', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956437/python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-004.mp4', 'python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-004', 600),
  (46, 'Trees Basics 2', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956439/python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-005.mp4', 'python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-005', 600),
  (46, 'Trees Basics 2', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956441/python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-006.mp4', 'python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-006', 600),
  (46, 'Trees Basics 2', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956443/python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-007.mp4', 'python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-007', 600),
  (46, 'Trees Basics 2', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956445/python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-008.mp4', 'python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-008', 600),
  (46, 'Trees Basics 2', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956447/python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-009.mp4', 'python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-009', 600),
  (46, 'Trees Basics 2', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956449/python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-010.mp4', 'python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-010', 600),
  (46, 'Trees Basics 2', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956450/python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-011.mp4', 'python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-011', 600),
  (46, 'Trees Basics 2', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956452/python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-012.mp4', 'python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-012', 600),
  (46, 'Trees Basics 2', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956454/python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-013.mp4', 'python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-013', 600),
  (46, 'Trees Basics 2', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956456/python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-014.mp4', 'python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-014', 600),
  (46, 'Trees Basics 2', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956457/python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-015.mp4', 'python-course/42-1-DSML-Intermediate-_-Trees-Basics---2/part-015', 303),
  (47, 'Python Refresher 1', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956490/python-course/43-Python-Refresher-1/part-000.mp4', 'python-course/43-Python-Refresher-1/part-000', 600),
  (47, 'Python Refresher 1', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956491/python-course/43-Python-Refresher-1/part-001.mp4', 'python-course/43-Python-Refresher-1/part-001', 600),
  (47, 'Python Refresher 1', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956493/python-course/43-Python-Refresher-1/part-002.mp4', 'python-course/43-Python-Refresher-1/part-002', 600),
  (47, 'Python Refresher 1', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956495/python-course/43-Python-Refresher-1/part-003.mp4', 'python-course/43-Python-Refresher-1/part-003', 600),
  (47, 'Python Refresher 1', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956497/python-course/43-Python-Refresher-1/part-004.mp4', 'python-course/43-Python-Refresher-1/part-004', 600),
  (47, 'Python Refresher 1', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956499/python-course/43-Python-Refresher-1/part-005.mp4', 'python-course/43-Python-Refresher-1/part-005', 600),
  (47, 'Python Refresher 1', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956500/python-course/43-Python-Refresher-1/part-006.mp4', 'python-course/43-Python-Refresher-1/part-006', 600),
  (47, 'Python Refresher 1', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956502/python-course/43-Python-Refresher-1/part-007.mp4', 'python-course/43-Python-Refresher-1/part-007', 600),
  (47, 'Python Refresher 1', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956503/python-course/43-Python-Refresher-1/part-008.mp4', 'python-course/43-Python-Refresher-1/part-008', 600),
  (47, 'Python Refresher 1', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956505/python-course/43-Python-Refresher-1/part-009.mp4', 'python-course/43-Python-Refresher-1/part-009', 600),
  (47, 'Python Refresher 1', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956506/python-course/43-Python-Refresher-1/part-010.mp4', 'python-course/43-Python-Refresher-1/part-010', 600),
  (47, 'Python Refresher 1', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956508/python-course/43-Python-Refresher-1/part-011.mp4', 'python-course/43-Python-Refresher-1/part-011', 600),
  (47, 'Python Refresher 1', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956509/python-course/43-Python-Refresher-1/part-012.mp4', 'python-course/43-Python-Refresher-1/part-012', 600),
  (47, 'Python Refresher 1', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956511/python-course/43-Python-Refresher-1/part-013.mp4', 'python-course/43-Python-Refresher-1/part-013', 600),
  (47, 'Python Refresher 1', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956515/python-course/43-Python-Refresher-1/part-014.mp4', 'python-course/43-Python-Refresher-1/part-014', 600),
  (47, 'Python Refresher 1', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956516/python-course/43-Python-Refresher-1/part-015.mp4', 'python-course/43-Python-Refresher-1/part-015', 600),
  (47, 'Python Refresher 1', 17, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956518/python-course/43-Python-Refresher-1/part-016.mp4', 'python-course/43-Python-Refresher-1/part-016', 600),
  (47, 'Python Refresher 1', 18, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956519/python-course/43-Python-Refresher-1/part-017.mp4', 'python-course/43-Python-Refresher-1/part-017', 600),
  (47, 'Python Refresher 1', 19, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956520/python-course/43-Python-Refresher-1/part-018.mp4', 'python-course/43-Python-Refresher-1/part-018', 337),
  (48, 'Python Refresher 2', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956522/python-course/44-Python-refresher-2/part-000.mp4', 'python-course/44-Python-refresher-2/part-000', 600),
  (48, 'Python Refresher 2', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956524/python-course/44-Python-refresher-2/part-001.mp4', 'python-course/44-Python-refresher-2/part-001', 600),
  (48, 'Python Refresher 2', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956526/python-course/44-Python-refresher-2/part-002.mp4', 'python-course/44-Python-refresher-2/part-002', 600),
  (48, 'Python Refresher 2', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956528/python-course/44-Python-refresher-2/part-003.mp4', 'python-course/44-Python-refresher-2/part-003', 600),
  (48, 'Python Refresher 2', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956530/python-course/44-Python-refresher-2/part-004.mp4', 'python-course/44-Python-refresher-2/part-004', 600),
  (48, 'Python Refresher 2', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956532/python-course/44-Python-refresher-2/part-005.mp4', 'python-course/44-Python-refresher-2/part-005', 600),
  (48, 'Python Refresher 2', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956533/python-course/44-Python-refresher-2/part-006.mp4', 'python-course/44-Python-refresher-2/part-006', 600),
  (48, 'Python Refresher 2', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956535/python-course/44-Python-refresher-2/part-007.mp4', 'python-course/44-Python-refresher-2/part-007', 600),
  (48, 'Python Refresher 2', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956537/python-course/44-Python-refresher-2/part-008.mp4', 'python-course/44-Python-refresher-2/part-008', 600),
  (48, 'Python Refresher 2', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956539/python-course/44-Python-refresher-2/part-009.mp4', 'python-course/44-Python-refresher-2/part-009', 600),
  (48, 'Python Refresher 2', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956540/python-course/44-Python-refresher-2/part-010.mp4', 'python-course/44-Python-refresher-2/part-010', 600),
  (48, 'Python Refresher 2', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956542/python-course/44-Python-refresher-2/part-011.mp4', 'python-course/44-Python-refresher-2/part-011', 600),
  (48, 'Python Refresher 2', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956544/python-course/44-Python-refresher-2/part-012.mp4', 'python-course/44-Python-refresher-2/part-012', 600),
  (48, 'Python Refresher 2', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956546/python-course/44-Python-refresher-2/part-013.mp4', 'python-course/44-Python-refresher-2/part-013', 600),
  (48, 'Python Refresher 2', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956547/python-course/44-Python-refresher-2/part-014.mp4', 'python-course/44-Python-refresher-2/part-014', 600),
  (48, 'Python Refresher 2', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956549/python-course/44-Python-refresher-2/part-015.mp4', 'python-course/44-Python-refresher-2/part-015', 600),
  (48, 'Python Refresher 2', 17, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956551/python-course/44-Python-refresher-2/part-016.mp4', 'python-course/44-Python-refresher-2/part-016', 600),
  (48, 'Python Refresher 2', 18, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956553/python-course/44-Python-refresher-2/part-017.mp4', 'python-course/44-Python-refresher-2/part-017', 493),
  (49, 'Python Refresher 3', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956555/python-course/45-Python-refresher-3/part-000.mp4', 'python-course/45-Python-refresher-3/part-000', 600),
  (49, 'Python Refresher 3', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956557/python-course/45-Python-refresher-3/part-001.mp4', 'python-course/45-Python-refresher-3/part-001', 600),
  (49, 'Python Refresher 3', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956560/python-course/45-Python-refresher-3/part-002.mp4', 'python-course/45-Python-refresher-3/part-002', 600),
  (49, 'Python Refresher 3', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956562/python-course/45-Python-refresher-3/part-003.mp4', 'python-course/45-Python-refresher-3/part-003', 600),
  (49, 'Python Refresher 3', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956564/python-course/45-Python-refresher-3/part-004.mp4', 'python-course/45-Python-refresher-3/part-004', 600),
  (49, 'Python Refresher 3', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956566/python-course/45-Python-refresher-3/part-005.mp4', 'python-course/45-Python-refresher-3/part-005', 600),
  (49, 'Python Refresher 3', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956568/python-course/45-Python-refresher-3/part-006.mp4', 'python-course/45-Python-refresher-3/part-006', 600),
  (49, 'Python Refresher 3', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956570/python-course/45-Python-refresher-3/part-007.mp4', 'python-course/45-Python-refresher-3/part-007', 600),
  (49, 'Python Refresher 3', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956572/python-course/45-Python-refresher-3/part-008.mp4', 'python-course/45-Python-refresher-3/part-008', 600),
  (49, 'Python Refresher 3', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956573/python-course/45-Python-refresher-3/part-009.mp4', 'python-course/45-Python-refresher-3/part-009', 600),
  (49, 'Python Refresher 3', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956575/python-course/45-Python-refresher-3/part-010.mp4', 'python-course/45-Python-refresher-3/part-010', 600),
  (49, 'Python Refresher 3', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956577/python-course/45-Python-refresher-3/part-011.mp4', 'python-course/45-Python-refresher-3/part-011', 600),
  (49, 'Python Refresher 3', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956578/python-course/45-Python-refresher-3/part-012.mp4', 'python-course/45-Python-refresher-3/part-012', 600),
  (49, 'Python Refresher 3', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956580/python-course/45-Python-refresher-3/part-013.mp4', 'python-course/45-Python-refresher-3/part-013', 600),
  (49, 'Python Refresher 3', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956581/python-course/45-Python-refresher-3/part-014.mp4', 'python-course/45-Python-refresher-3/part-014', 600),
  (49, 'Python Refresher 3', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956584/python-course/45-Python-refresher-3/part-015.mp4', 'python-course/45-Python-refresher-3/part-015', 600),
  (49, 'Python Refresher 3', 17, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956585/python-course/45-Python-refresher-3/part-016.mp4', 'python-course/45-Python-refresher-3/part-016', 600),
  (49, 'Python Refresher 3', 18, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956587/python-course/45-Python-refresher-3/part-017.mp4', 'python-course/45-Python-refresher-3/part-017', 600),
  (49, 'Python Refresher 3', 19, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956590/python-course/45-Python-refresher-3/part-018.mp4', 'python-course/45-Python-refresher-3/part-018', 600),
  (49, 'Python Refresher 3', 20, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956591/python-course/45-Python-refresher-3/part-019.mp4', 'python-course/45-Python-refresher-3/part-019', 88),
  (50, 'Python OOPs 1', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956594/python-course/46-Python-OOPS/part-000.mp4', 'python-course/46-Python-OOPS/part-000', 600),
  (50, 'Python OOPs 1', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956596/python-course/46-Python-OOPS/part-001.mp4', 'python-course/46-Python-OOPS/part-001', 600),
  (50, 'Python OOPs 1', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956597/python-course/46-Python-OOPS/part-002.mp4', 'python-course/46-Python-OOPS/part-002', 600),
  (50, 'Python OOPs 1', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956599/python-course/46-Python-OOPS/part-003.mp4', 'python-course/46-Python-OOPS/part-003', 600),
  (50, 'Python OOPs 1', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956601/python-course/46-Python-OOPS/part-004.mp4', 'python-course/46-Python-OOPS/part-004', 600),
  (50, 'Python OOPs 1', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956602/python-course/46-Python-OOPS/part-005.mp4', 'python-course/46-Python-OOPS/part-005', 600),
  (50, 'Python OOPs 1', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956604/python-course/46-Python-OOPS/part-006.mp4', 'python-course/46-Python-OOPS/part-006', 600),
  (50, 'Python OOPs 1', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956606/python-course/46-Python-OOPS/part-007.mp4', 'python-course/46-Python-OOPS/part-007', 600),
  (50, 'Python OOPs 1', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956608/python-course/46-Python-OOPS/part-008.mp4', 'python-course/46-Python-OOPS/part-008', 600),
  (50, 'Python OOPs 1', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956610/python-course/46-Python-OOPS/part-009.mp4', 'python-course/46-Python-OOPS/part-009', 600),
  (50, 'Python OOPs 1', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956611/python-course/46-Python-OOPS/part-010.mp4', 'python-course/46-Python-OOPS/part-010', 600),
  (50, 'Python OOPs 1', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956613/python-course/46-Python-OOPS/part-011.mp4', 'python-course/46-Python-OOPS/part-011', 600),
  (50, 'Python OOPs 1', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956614/python-course/46-Python-OOPS/part-012.mp4', 'python-course/46-Python-OOPS/part-012', 600),
  (50, 'Python OOPs 1', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956617/python-course/46-Python-OOPS/part-013.mp4', 'python-course/46-Python-OOPS/part-013', 600),
  (50, 'Python OOPs 1', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956619/python-course/46-Python-OOPS/part-014.mp4', 'python-course/46-Python-OOPS/part-014', 600),
  (50, 'Python OOPs 1', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956621/python-course/46-Python-OOPS/part-015.mp4', 'python-course/46-Python-OOPS/part-015', 600),
  (50, 'Python OOPs 1', 17, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956622/python-course/46-Python-OOPS/part-016.mp4', 'python-course/46-Python-OOPS/part-016', 600),
  (50, 'Python OOPs 1', 18, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956624/python-course/46-Python-OOPS/part-017.mp4', 'python-course/46-Python-OOPS/part-017', 600),
  (50, 'Python OOPs 1', 19, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956625/python-course/46-Python-OOPS/part-018.mp4', 'python-course/46-Python-OOPS/part-018', 140),
  (51, 'Python OOPs 2', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956627/python-course/47-Python-OOPS/part-000.mp4', 'python-course/47-Python-OOPS/part-000', 600),
  (51, 'Python OOPs 2', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956629/python-course/47-Python-OOPS/part-001.mp4', 'python-course/47-Python-OOPS/part-001', 600),
  (51, 'Python OOPs 2', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956631/python-course/47-Python-OOPS/part-002.mp4', 'python-course/47-Python-OOPS/part-002', 600),
  (51, 'Python OOPs 2', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956633/python-course/47-Python-OOPS/part-003.mp4', 'python-course/47-Python-OOPS/part-003', 600),
  (51, 'Python OOPs 2', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956634/python-course/47-Python-OOPS/part-004.mp4', 'python-course/47-Python-OOPS/part-004', 600),
  (51, 'Python OOPs 2', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956636/python-course/47-Python-OOPS/part-005.mp4', 'python-course/47-Python-OOPS/part-005', 600),
  (51, 'Python OOPs 2', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956637/python-course/47-Python-OOPS/part-006.mp4', 'python-course/47-Python-OOPS/part-006', 600),
  (51, 'Python OOPs 2', 8, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956639/python-course/47-Python-OOPS/part-007.mp4', 'python-course/47-Python-OOPS/part-007', 600),
  (51, 'Python OOPs 2', 9, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956640/python-course/47-Python-OOPS/part-008.mp4', 'python-course/47-Python-OOPS/part-008', 600),
  (51, 'Python OOPs 2', 10, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956642/python-course/47-Python-OOPS/part-009.mp4', 'python-course/47-Python-OOPS/part-009', 600),
  (51, 'Python OOPs 2', 11, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956643/python-course/47-Python-OOPS/part-010.mp4', 'python-course/47-Python-OOPS/part-010', 600),
  (51, 'Python OOPs 2', 12, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956645/python-course/47-Python-OOPS/part-011.mp4', 'python-course/47-Python-OOPS/part-011', 600),
  (51, 'Python OOPs 2', 13, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956646/python-course/47-Python-OOPS/part-012.mp4', 'python-course/47-Python-OOPS/part-012', 600),
  (51, 'Python OOPs 2', 14, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956648/python-course/47-Python-OOPS/part-013.mp4', 'python-course/47-Python-OOPS/part-013', 600),
  (51, 'Python OOPs 2', 15, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956649/python-course/47-Python-OOPS/part-014.mp4', 'python-course/47-Python-OOPS/part-014', 600),
  (51, 'Python OOPs 2', 16, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956651/python-course/47-Python-OOPS/part-015.mp4', 'python-course/47-Python-OOPS/part-015', 600),
  (51, 'Python OOPs 2', 17, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956653/python-course/47-Python-OOPS/part-016.mp4', 'python-course/47-Python-OOPS/part-016', 600),
  (51, 'Python OOPs 2', 18, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956654/python-course/47-Python-OOPS/part-017.mp4', 'python-course/47-Python-OOPS/part-017', 288),
  (52, 'Exception Handling', 1, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956656/python-course/48-Exception-Handling/part-000.mp4', 'python-course/48-Exception-Handling/part-000', 600),
  (52, 'Exception Handling', 2, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956658/python-course/48-Exception-Handling/part-001.mp4', 'python-course/48-Exception-Handling/part-001', 600),
  (52, 'Exception Handling', 3, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956661/python-course/48-Exception-Handling/part-002.mp4', 'python-course/48-Exception-Handling/part-002', 600),
  (52, 'Exception Handling', 4, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956663/python-course/48-Exception-Handling/part-003.mp4', 'python-course/48-Exception-Handling/part-003', 600),
  (52, 'Exception Handling', 5, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956664/python-course/48-Exception-Handling/part-004.mp4', 'python-course/48-Exception-Handling/part-004', 600),
  (52, 'Exception Handling', 6, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956665/python-course/48-Exception-Handling/part-005.mp4', 'python-course/48-Exception-Handling/part-005', 600),
  (52, 'Exception Handling', 7, 'https://res.cloudinary.com/vfsb7bzs/video/upload/v1791956667/python-course/48-Exception-Handling/part-006.mp4', 'python-course/48-Exception-Handling/part-006', 349)
       ) AS v(mseq, mtitle, part, video_url, cloudinary_id, duration_sec)
  JOIN content_modules m ON m.sequence_no = v.mseq
   AND m.course_id = (SELECT course_id FROM courses WHERE title = 'Python Programming Course')
 ORDER BY v.mseq, v.part;
