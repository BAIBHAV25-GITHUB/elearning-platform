import { query } from '../config/db.js';

export const findUserByEmail = async (email) => {
  const res = await query('SELECT * FROM users WHERE email = $1', [email]);
  return res.rows[0];
};

export const findUserById = async (id) => {
  const res = await query('SELECT id, name, email, role, created_at FROM users WHERE id = $1', [id]);
  return res.rows[0];
};

export const createUser = async ({ name, email, passwordHash, role = 'student' }) => {
  const res = await query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, email, role, created_at`,
    [name, email, passwordHash, role]
  );
  return res.rows[0];
};