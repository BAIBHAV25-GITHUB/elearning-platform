-- Base Seed Data for E-Learning Platform

\c elearning_db;

-- 1. Insert Master Roles
INSERT INTO roles (role_name, description) VALUES
('Admin', 'System administrator with full system management permissions'),
('Instructor', 'Course creator and manager'),
('Student', 'Platform learner enrolled in courses');

-- 2. Insert Users (Password is 'Password123!' hashed with bcrypt)
-- Hash: $2a$10$wT1B5VpY8rG/aC/8lqP2..E0K3Gj4Rk8uX2z/0B2h8pW7.h3G1d9y (or mock hash)
INSERT INTO users (user_name, email, password, phone, status) VALUES
('System Admin', 'admin@elearning.com', '$2a$10$e84.A9c2e/5yLhG.1f1D0.xQ2mZ3g9K8hJ7k6L5m4N3o2P1q0R', '+1111111111', 'active'),
('Professor John Doe', 'john.doe@elearning.com', '$2a$10$e84.A9c2e/5yLhG.1f1D0.xQ2mZ3g9K8hJ7k6L5m4N3o2P1q0R', '+1222222222', 'active'),
('Dr. Sarah Smith', 'sarah.smith@elearning.com', '$2a$10$e84.A9c2e/5yLhG.1f1D0.xQ2mZ3g9K8hJ7k6L5m4N3o2P1q0R', '+1333333333', 'active'),
('Alice Johnson', 'alice@student.com', '$2a$10$e84.A9c2e/5yLhG.1f1D0.xQ2mZ3g9K8hJ7k6L5m4N3o2P1q0R', '+1444444444', 'active'),
('Bob Williams', 'bob@student.com', '$2a$10$e84.A9c2e/5yLhG.1f1D0.xQ2mZ3g9K8hJ7k6L5m4N3o2P1q0R', '+1555555555', 'active');

-- Assign Roles
INSERT INTO user_roles (user_id, role_id) VALUES
(1, 1), -- Admin
(2, 2), -- Instructor John
(3, 2), -- Instructor Sarah
(4, 3), -- Student Alice
(5, 3); -- Student Bob

-- 3. Sample Published Course owned by Instructor John Doe (ID: 2)
INSERT INTO courses (instructor_id, course_name, description, price, status) VALUES
(2, 'Full-Stack Web Development Bootcamp', 'Master modern web development with Node.js, Express, React, and PostgreSQL.', 99.99, 'published'),
(3, 'Data Structures & Algorithms Masterclass', 'Comprehensive guide to mastering DSA for technical interviews.', 49.99, 'published');

-- 4. Sample Batches
INSERT INTO batches (course_id, batch_name, start_date, end_date, max_capacity) VALUES
(1, 'Fall 2026 Cohort 1', '2026-10-10', '2026-12-10', 30),
(2, 'Winter 2026 Cohort 1', '2026-11-01', '2026-12-30', 25);

-- 5. Content Modules
INSERT INTO content_modules (course_id, title, description, sequence_no) VALUES
(1, 'Module 1: Backend Fundamentals', 'Learn Express, REST APIs, and ES Modules', 1),
(1, 'Module 2: PostgreSQL Database Architecture', 'Master SQL schemas, triggers, and functions', 2);

-- 6. Content Items
INSERT INTO content (module_id, title, type, video_url, cloudinary_id, duration_sec, sequence_no, status) VALUES
(1, 'Introduction to Node & Express', 'video', 'https://res.cloudinary.com/demo/video/upload/v1/sample.mp4', 'cloudinary_sample_1', 600, 1, 'ready'),
(1, 'REST API Principles PDF', 'pdf', 'https://res.cloudinary.com/demo/image/upload/v1/sample.pdf', 'cloudinary_sample_pdf', NULL, 2, 'ready'),
(2, 'Database Schemas & Triggers Deep Dive', 'video', 'https://res.cloudinary.com/demo/video/upload/v1/sample2.mp4', 'cloudinary_sample_2', 1200, 1, 'ready');