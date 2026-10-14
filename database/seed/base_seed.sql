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
--    or load real lessons with server/scripts/seed-content.mjs)
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
