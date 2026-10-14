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
