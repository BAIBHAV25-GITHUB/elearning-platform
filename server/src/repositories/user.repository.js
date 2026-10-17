import { query } from '../config/db.js';

// Schema has users + roles + user_roles (no users.role column), so every lookup
// goes through the DB helper functions, which resolve the role as a lower-case
// string ('admin' | 'instructor' | 'student').

/**
 * Login row: { user_id, user_name, email, password (bcrypt hash), status, role }.
 * Email match is case-insensitive. Returns null when not found.
 */
export const findUserByEmail = async (email) => {
  const { rows } = await query('SELECT * FROM fn_get_user_for_login($1)', [email]);
  return rows[0] || null;
};

/** Safe lookup (no password): { user_id, user_name, email, status, role } or null. */
export const findUserById = async (id) => {
  const { rows } = await query('SELECT * FROM fn_get_user_by_id($1)', [id]);
  return rows[0] || null;
};

/**
 * Inserts the user and its user_roles row in one transaction (inside the SQL
 * function). Only 'student' / 'instructor' are accepted (P0001 otherwise);
 * a duplicate email raises 23505.
 * Returns { user_id, user_name, email, role }.
 */
export const createUser = async ({ name, email, passwordHash, role = 'student' }) => {
  const { rows } = await query('SELECT * FROM fn_register_user($1, $2, $3, $4)', [
    name,
    email,
    passwordHash,
    role,
  ]);
  return rows[0];
};

/**
 * Admin user list (fn_list_users). Every filter is optional (null = no filter).
 * Returns { users: [{ user_id, user_name, email, status, role, created_at }], total }.
 */
export const listUsers = async ({ search = null, role = null, status = null, instructorStatus = null, limit = 20, offset = 0 }) => {
  const { rows } = await query('SELECT * FROM fn_list_users($1, $2, $3::user_status_enum, $4, $5, $6)', [
    search,
    role,
    status,
    limit,
    offset,
    instructorStatus,
  ]);
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return { users: rows.map(({ total_count, ...u }) => u), total };
};

/**
 * Sets a user's status (fn_set_user_status). The function enforces: caller is an admin (42501),
 * target exists (P0002), not your own account and not another admin (P0001).
 * Returns { user_id, user_name, email, old_status, status, role }.
 */
export const setUserStatus = async (adminId, userId, status) => {
  const { rows } = await query('SELECT * FROM fn_set_user_status($1, $2, $3::user_status_enum)', [
    adminId,
    userId,
    status,
  ]);
  return rows[0];
};

/**
 * Erases the person behind an account (name, e-mail, password, notifications, logged IPs) while keeping the rows that
 * payments, enrollments and certificates point at. Admin only (checked in SQL). Returns { user_id, role }.
 */
export const anonymiseUser = async (adminId, userId) => {
  const { rows } = await query('SELECT * FROM fn_anonymise_user($1, $2)', [adminId, userId]);
  return rows[0];
};

/** 'pending' | 'approved' | 'rejected' for instructors, null for everybody else. */
export const getInstructorStatus = async (userId) => {
  const { rows } = await query('SELECT instructor_status FROM users WHERE user_id = $1', [userId]);
  return rows[0]?.instructor_status ?? null;
};

/**
 * Switch an account between student and instructor (fn_set_user_role). Admin only, not yourself,
 * not an admin account; an instructor who owns courses cannot become a student.
 * Returns { user_id, user_name, email, old_role, role, instructor_status }.
 */
export const setUserRole = async (adminId, userId, role) => {
  const { rows } = await query('SELECT * FROM fn_set_user_role($1, $2, $3)', [adminId, userId, role]);
  return rows[0];
};

/**
 * Approve / reject an instructor (fn_review_instructor).
 * Returns { user_id, user_name, email, old_instructor_status, instructor_status }.
 */
export const reviewInstructor = async (adminId, userId, decision) => {
  const { rows } = await query('SELECT * FROM fn_review_instructor($1, $2, $3)', [adminId, userId, decision]);
  return rows[0];
};
