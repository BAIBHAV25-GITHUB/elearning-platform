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
