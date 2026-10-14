-- PostgreSQL Schema for E-Learning Platform
-- 11 ENUM types, 18 tables, constraints and indexes.
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
    error_message TEXT,                      -- why processing failed (status = 'error')
    CONSTRAINT uq_content_seq UNIQUE (module_id, sequence_no),
    CONSTRAINT chk_content_seq CHECK (sequence_no > 0),
    CONSTRAINT chk_content_dur CHECK (duration_sec IS NULL OR duration_sec >= 0)
);

-- A video is ONE content row. Because the free Cloudinary plan caps a video file at
-- 100 MB, the server compresses long uploads and cuts them into ~10-minute pieces;
-- the pieces live here, in order. content.duration_sec is the TOTAL of all pieces, so
-- progress / the 80 % rule / certificates work on the whole video.
-- A video that fits in one file has no rows here (its URL is content.video_url).
CREATE TABLE content_parts (
    part_id       INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    content_id    INTEGER NOT NULL REFERENCES content(content_id) ON DELETE CASCADE ON UPDATE CASCADE,
    part_no       SMALLINT NOT NULL,
    video_url     VARCHAR(512) NOT NULL,
    cloudinary_id VARCHAR(255) NOT NULL,
    duration_sec  INTEGER NOT NULL,
    CONSTRAINT uq_content_part UNIQUE (content_id, part_no),
    CONSTRAINT chk_part_no CHECK (part_no > 0),
    CONSTRAINT chk_part_dur CHECK (duration_sec >= 0)
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
CREATE INDEX idx_content_parts_content ON content_parts(content_id);
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
