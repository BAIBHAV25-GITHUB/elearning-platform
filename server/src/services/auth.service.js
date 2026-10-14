import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import * as userRepository from '../repositories/user.repository.js';
import { env } from '../config/env.js';

const httpError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

// DB row (user_id, user_name, ...) -> shape the client reads (id, name, ...)
const toPublicUser = (row) => ({
  id: row.user_id,
  name: row.user_name,
  email: row.email,
  role: row.role,
});

const signToken = (user) =>
  jwt.sign({ id: user.id, role: user.role }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });

export const registerUser = async ({ name, email, password, role }) => {
  if (!name || !email || !password) {
    throw httpError('Name, email and password are required', 400);
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  let row;
  try {
    row = await userRepository.createUser({ name, email, passwordHash, role });
  } catch (err) {
    if (err.code === '23505') throw httpError('Email already registered', 400);
    if (err.code === '23514') throw httpError('Invalid email address', 400); // chk_users_email
    if (err.code === 'P0001') throw httpError(err.message, 400); // e.g. role not self-registerable
    throw err;
  }

  const user = toPublicUser(row);
  return { user, token: signToken(user) };
};

export const loginUser = async ({ email, password }) => {
  if (!email || !password) {
    throw httpError('Email and password are required', 400);
  }

  const row = await userRepository.findUserByEmail(email);
  if (!row) throw httpError('Invalid email or password', 401);

  const isMatch = await bcrypt.compare(password, row.password);
  if (!isMatch) throw httpError('Invalid email or password', 401);

  if (row.status !== 'active') throw httpError('Account is not active', 403);
  if (!row.role) throw httpError('Account has no role assigned', 403);

  const user = toPublicUser(row);
  return { user, token: signToken(user) };
};

/** For GET /auth/me (S0g). */
export const getCurrentUser = async (userId) => {
  const row = await userRepository.findUserById(userId);
  if (!row || row.status !== 'active') throw httpError('User not found', 404);
  return toPublicUser(row);
};
