-- PostgreSQL Database Schema for E-Learning Platform
-- Version: 1.0.0

DROP TABLE IF EXISTS audit_log_details CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS announcements CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS comments CASCADE;
DROP TABLE IF EXISTS certificates CASCADE;
DROP TABLE IF EXISTS progress CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS enrollments CASCADE;
DROP TABLE IF EXISTS batches CASCADE;
DROP TABLE IF EXISTS content CASCADE;
DROP TABLE IF EXISTS content_modules CASCADE;
DROP TABLE IF EXISTS courses CASCADE;
DROP TABLE IF EXISTS course_categories CASCADE;
DROP TABLE IF EXISTS instructors CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS system_settings CASCADE;

DROP TYPE IF EXISTS notification_type_enum CASCADE;
DROP TYPE IF EXISTS certificate_status_enum CASCADE;
DROP TYPE IF EXISTS content_status_enum CASCADE;
DROP TYPE IF EXISTS content_type_enum CASCADE;
DROP TYPE IF EXISTS payment_method_enum CASCADE;
DROP TYPE IF EXISTS payment_status_enum CASCADE;
DROP TYPE IF EXISTS enrollment_status_enum CASCADE;
DROP TYPE IF EXISTS batch_status_enum CASCADE;
DROP TYPE IF EXISTS course_status_enum CASCADE;
DROP TYPE IF EXISTS user_status_enum CASCADE;
DROP TYPE IF EXISTS user_role_enum CASCADE;

-- 1. ENUM DEFINITIONS (11 ENUMs)
CREATE TYPE user_role_enum AS ENUM ('Student', 'Instructor', 'Admin');
CREATE TYPE user_status_enum AS ENUM ('active', 'suspended', 'deactivated');
CREATE TYPE course_status_enum AS ENUM ('draft', 'published', 'archived');
CREATE TYPE batch_status_enum AS ENUM ('upcoming', 'open', 'full', 'completed', 'cancelled');
CREATE TYPE enrollment_status_enum AS ENUM ('pending', 'active', 'completed', 'dropped');
CREATE TYPE payment_status_enum AS ENUM ('pending', 'completed', 'failed', 'refunded');
CREATE TYPE payment_method_enum AS ENUM ('card', 'upi', 'netbanking', 'wallet');
CREATE TYPE content_type_enum AS ENUM ('video', 'pdf', 'quiz');
CREATE TYPE content_status_enum AS ENUM ('processing', 'ready', 'failed');
CREATE TYPE certificate_status_enum AS ENUM ('issued', 'revoked');
CREATE TYPE notification_type_enum AS ENUM ('enrollment', 'payment', 'announcement', 'system');

-- 2. TABLE DEFINITIONS (17 Tables)
CREATE TABLE users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role_enum NOT NULL DEFAULT 'Student',
    status user_status_enum NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE instructors (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bio TEXT,
    expertise VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE course_categories (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE courses (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    instructor_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    category_id BIGINT REFERENCES course_categories(id) ON DELETE SET NULL,
    course_name VARCHAR(255) NOT NULL,
    description TEXT,
    price NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (price >= 0),
    status course_status_enum NOT NULL DEFAULT 'draft',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE content_modules (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    sequence_no INT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (course_id, sequence_no)
);

CREATE TABLE content (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    module_id BIGINT NOT NULL REFERENCES content_modules(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    type content_type_enum NOT NULL DEFAULT 'video',
    video_url VARCHAR(500),
    cloudinary_id VARCHAR(255),
    duration_sec INT DEFAULT 0 CHECK (duration_sec >= 0),
    status content_status_enum NOT NULL DEFAULT 'processing',
    sequence_no INT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (module_id, sequence_no)
);

CREATE TABLE batches (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    batch_name VARCHAR(100) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    max_capacity INT NOT NULL CHECK (max_capacity BETWEEN 1 AND 30),
    current_capacity INT NOT NULL DEFAULT 0 CHECK (current_capacity >= 0),
    status batch_status_enum NOT NULL DEFAULT 'upcoming',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CHECK (end_date >= start_date),
    CHECK (current_capacity <= max_capacity)
);

CREATE TABLE enrollments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    student_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
    batch_id BIGINT NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
    status enrollment_status_enum NOT NULL DEFAULT 'pending',
    enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (student_id, course_id)
);

CREATE TABLE payments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    enrollment_id BIGINT NOT NULL REFERENCES enrollments(id) ON DELETE RESTRICT,
    amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
    payment_method payment_method_enum NOT NULL,
    transaction_id VARCHAR(255) UNIQUE NOT NULL,
    status payment_status_enum NOT NULL DEFAULT 'pending',
    paid_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE progress (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    enrollment_id BIGINT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    content_id BIGINT NOT NULL REFERENCES content(id) ON DELETE CASCADE,
    watch_duration INT NOT NULL DEFAULT 0 CHECK (watch_duration >= 0),
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    last_watched_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (enrollment_id, content_id)
);

CREATE TABLE certificates (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    enrollment_id BIGINT UNIQUE NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    certificate_code VARCHAR(100) UNIQUE NOT NULL,
    pdf_url VARCHAR(500),
    status certificate_status_enum NOT NULL DEFAULT 'issued',
    issued_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE comments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    module_id BIGINT NOT NULL REFERENCES content_modules(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_comment_id BIGINT REFERENCES comments(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notifications (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type notification_type_enum NOT NULL DEFAULT 'system',
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE announcements (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_log_details (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    audit_log_id BIGINT NOT NULL REFERENCES audit_logs(id) ON DELETE CASCADE,
    field_name VARCHAR(100) NOT NULL,
    old_value TEXT,
    new_value TEXT
);

CREATE TABLE system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);