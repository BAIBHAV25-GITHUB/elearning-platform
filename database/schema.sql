-- PostgreSQL Schema Reference for E-Learning Platform
-- Creates 11 ENUM Types, 17 Tables, Constraints, and Indexes

DROP DATABASE IF EXISTS elearning_db;
CREATE DATABASE elearning_db;
\c elearning_db;

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
    email       VARCHAR(255) NOT NULL UNIQUE,
    password    VARCHAR(255) NOT NULL,
    phone       VARCHAR(20),
    status      user_status_enum NOT NULL DEFAULT 'active',
    created_at  TIMESTAMP NOT NULL DEFAULT now(),
    updated_at  TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT chk_users_email CHECK (email LIKE '%_@__%.__%')
);

CREATE TABLE user_roles (
    user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
    role_id       SMALLINT NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE ON UPDATE CASCADE,
    assigned_date TIMESTAMP NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_id)
);

-- 3. Course Structure
CREATE TABLE courses (
    course_id     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    instructor_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    course_name   VARCHAR(200) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description   TEXT,
    price         DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    thumbnail_url TEXT,
    status        course_status_enum NOT NULL DEFAULT 'draft',
    created_at    TIMESTAMP NOT NULL DEFAULT now(),
    updated_at    TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT chk_courses_price CHECK (price >= 0)
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
    CONSTRAINT chk_batch_capacity CHECK (max_capacity BETWEEN 1 AND 30),
    CONSTRAINT chk_batch_dates CHECK (end_date > start_date),
    CONSTRAINT chk_batch_cur_cap CHECK (current_capacity BETWEEN 0 AND max_capacity)
);

CREATE TABLE content_modules (
    module_id   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    course_id   INTEGER NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE ON UPDATE CASCADE,
    title       VARCHAR(200) NOT NULL,
    description TEXT,
    sequence_no SMALLINT NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT now(),
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
    batch_id      INTEGER NOT NULL REFERENCES batches(batch_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    enroll_date   TIMESTAMP NOT NULL DEFAULT now(),
    status        enrollment_status_enum NOT NULL DEFAULT 'pending',
    CONSTRAINT uq_enrollments_student_batch UNIQUE (student_id, batch_id)
);

CREATE TABLE payments (
    payment_id     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    enrollment_id  INTEGER NOT NULL UNIQUE REFERENCES enrollments(enrollment_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    amount         DECIMAL(10,2) NOT NULL,
    payment_method payment_method_enum NOT NULL,
    status         payment_status_enum NOT NULL DEFAULT 'pending',
    transaction_id VARCHAR(255) UNIQUE,
    gateway        VARCHAR(50),
    CONSTRAINT chk_payments_amount CHECK (amount >= 0)
);

-- 5. Learning Progress & Certificates
CREATE TABLE progress (
    progress_id    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    enrollment_id  INTEGER NOT NULL REFERENCES enrollments(enrollment_id) ON DELETE CASCADE ON UPDATE CASCADE,
    content_id     INTEGER NOT NULL REFERENCES content(content_id) ON DELETE CASCADE ON UPDATE CASCADE,
    watch_duration INTEGER NOT NULL DEFAULT 0,
    completed      BOOLEAN NOT NULL DEFAULT FALSE,
    completed_at   TIMESTAMP,
    CONSTRAINT uq_progress_enrl_content UNIQUE (enrollment_id, content_id),
    CONSTRAINT chk_progress_duration CHECK (watch_duration >= 0)
);

CREATE TABLE certificates (
    certificate_id  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    enrollment_id   INTEGER NOT NULL UNIQUE REFERENCES enrollments(enrollment_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    certificate_url VARCHAR(512) NOT NULL,
    issue_date      TIMESTAMP NOT NULL DEFAULT now(),
    email_sent      BOOLEAN NOT NULL DEFAULT FALSE
);

-- 6. Communication
CREATE TABLE notifications (
    notification_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
    title           VARCHAR(200) NOT NULL,
    message         TEXT NOT NULL,
    type            notification_type_enum NOT NULL DEFAULT 'system',
    is_read         BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE comments (
    comment_id        INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    module_id         INTEGER NOT NULL REFERENCES content_modules(module_id) ON DELETE CASCADE ON UPDATE CASCADE,
    user_id           INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
    parent_comment_id INTEGER REFERENCES comments(comment_id) ON DELETE CASCADE ON UPDATE CASCADE,
    content           TEXT NOT NULL,
    created_at        TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE announcements (
    announcement_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    course_id       INTEGER NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE ON UPDATE CASCADE,
    author_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    title           VARCHAR(200) NOT NULL,
    content         TEXT NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT now()
);

-- 7. Reporting & Audit
CREATE TABLE reports (
    report_id    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    report_type  VARCHAR(100) NOT NULL,
    format       report_format_enum NOT NULL DEFAULT 'pdf',
    generated_by INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    file_url     VARCHAR(512),
    created_at   TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
    log_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     INTEGER REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE,
    table_name  VARCHAR(100) NOT NULL,
    record_id   BIGINT NOT NULL,
    action_type audit_action_enum NOT NULL,
    timestamp   TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE audit_log_details (
    detail_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    log_id      BIGINT NOT NULL REFERENCES audit_logs(log_id) ON DELETE CASCADE ON UPDATE CASCADE,
    column_name VARCHAR(100) NOT NULL,
    old_val     TEXT,
    new_val     TEXT
);

-- 8. Indexes
CREATE INDEX idx_enrollments_student ON enrollments(student_id);
CREATE INDEX idx_enrollments_course  ON enrollments(course_id);
CREATE INDEX idx_enrollments_batch   ON enrollments(batch_id);
CREATE INDEX idx_progress_enrollment ON progress(enrollment_id);
CREATE INDEX idx_progress_content    ON progress(content_id);
CREATE INDEX idx_notif_user_read     ON notifications(user_id, is_read);
CREATE INDEX idx_comments_module     ON comments(module_id);
CREATE INDEX idx_audit_ts            ON audit_logs("timestamp");