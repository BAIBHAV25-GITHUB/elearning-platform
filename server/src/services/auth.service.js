import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import * as userRepository from '../repositories/user.repository.js';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

export const registerUser = async ({ name, email, password, role }) => {
  const existingUser = await userRepository.findUserByEmail(email);
  if (existingUser) {
    const error = new Error('Email already registered');
    error.statusCode = 400;
    throw error;
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  const newUser = await userRepository.createUser({
    name,
    email,
    passwordHash,
    role,
  });

  const token = jwt.sign(
    { id: newUser.user_id, role: newUser.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  return { user: newUser, token };
};

export const loginUser = async ({ email, password }) => {
  const user = await userRepository.findUserByEmail(email);
  if (!user) {
    const error = new Error('Invalid email or password');
    error.statusCode = 401;
    throw error;
  }

  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    const error = new Error('Invalid email or password');
    error.statusCode = 401;
    throw error;
  }

  const token = jwt.sign(
    { id: user.user_id, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  const { password_hash, ...userData } = user;
  return { user: userData, token };
};