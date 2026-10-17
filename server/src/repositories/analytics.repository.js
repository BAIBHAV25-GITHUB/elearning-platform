import { query } from '../config/db.js';

// The views expose instructor_id. Pass it to scope the rows to one instructor's
// courses; call without arguments (admins) for everything.

export const getBatchCapacityView = async (instructorId = null) => {
  const sql = `
    SELECT * FROM vw_batch_capacity
    WHERE ($1::int IS NULL OR instructor_id = $1)
    ORDER BY batch_id DESC`;
  const { rows } = await query(sql, [instructorId]);
  return rows;
};

export const getStudentProgressView = async (instructorId = null) => {
  const sql = `
    SELECT * FROM vw_student_progress
    WHERE ($1::int IS NULL OR instructor_id = $1)
    ORDER BY completion_percentage DESC`;
  const { rows } = await query(sql, [instructorId]);
  return rows;
};

export const getCourseRevenueView = async (instructorId = null) => {
  const sql = `
    SELECT * FROM vw_course_revenue
    WHERE ($1::int IS NULL OR instructor_id = $1)
    ORDER BY total_revenue DESC`;
  const { rows } = await query(sql, [instructorId]);
  return rows;
};

// Revenue and enrollments per calendar month for the last `months` months (empty months are returned as zeros so
// the chart has no gaps). Scoped like the views: pass an instructor id for their courses, nothing for admins.
//   gross_revenue = successful + refunded payments, refunded = the refunded part, net_revenue = gross - refunded.
//   A refund flips payments.status to 'refunded', so the net of all months equals vw_course_revenue.total_revenue.
// Payments are bucketed by paid_at (falls back to created_at), enrollments by enroll_date (dropped ones are left
// out, same as the view). Month boundaries follow the database session time zone.
export const getMonthlyTimeline = async (instructorId = null, months = 12) => {
  const sql = `
    WITH months AS (
      SELECT generate_series(
        date_trunc('month', now()) - (($2::int - 1) * interval '1 month'),
        date_trunc('month', now()),
        interval '1 month'
      ) AS month
    ),
    paid AS (
      SELECT date_trunc('month', COALESCE(p.paid_at, p.created_at)) AS month,
             SUM(p.amount) AS gross,
             COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'refunded'), 0) AS refunded
        FROM payments p
        JOIN enrollments e ON e.enrollment_id = p.enrollment_id
        JOIN courses c ON c.course_id = e.course_id
       WHERE p.status IN ('success', 'refunded')
         AND ($1::int IS NULL OR c.instructor_id = $1)
       GROUP BY 1
    ),
    enrolled AS (
      SELECT date_trunc('month', e.enroll_date) AS month, COUNT(*) AS enrollments
        FROM enrollments e
        JOIN courses c ON c.course_id = e.course_id
       WHERE e.status <> 'dropped'
         AND ($1::int IS NULL OR c.instructor_id = $1)
       GROUP BY 1
    )
    SELECT to_char(m.month, 'YYYY-MM') AS month,
           COALESCE(paid.gross, 0) AS gross_revenue,
           COALESCE(paid.refunded, 0) AS refunded,
           COALESCE(paid.gross, 0) - COALESCE(paid.refunded, 0) AS net_revenue,
           COALESCE(enrolled.enrollments, 0)::int AS enrollments
      FROM months m
      LEFT JOIN paid USING (month)
      LEFT JOIN enrolled USING (month)
     ORDER BY m.month`;
  const { rows } = await query(sql, [instructorId, months]);
  return rows;
};
