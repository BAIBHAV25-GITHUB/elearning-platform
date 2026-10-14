import * as authService from '../services/auth.service.js';
import { handleError } from '../utils/errors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const register = async (req, res) => {
  try {
    const { userName, name, email, password, role } = req.body ?? {};
    const finalName = typeof (userName ?? name) === 'string' ? (userName ?? name).trim() : '';

    if (!finalName || finalName.length > 100) {
      return res.status(400).json({ message: 'Name is required (max 100 characters)' });
    }
    if (typeof email !== 'string' || email.length > 255 || !EMAIL_RE.test(email.trim())) {
      return res.status(400).json({ message: 'A valid email is required' });
    }
    // bcrypt only uses the first 72 bytes of a password
    if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 72) {
      return res.status(400).json({ message: 'Password must be 8-72 characters' });
    }
    if (role !== undefined && typeof role !== 'string') {
      return res.status(400).json({ message: 'Invalid role' });
    }

    // Only 'student' / 'instructor' are accepted - 'admin' is rejected by fn_register_user (X1)
    const result = await authService.registerUser({ name: finalName, email: email.trim(), password, role });
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    return handleError(res, err);
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    const result = await authService.loginUser({ email, password });
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    return handleError(res, err);
  }
};

/** GET /auth/me - lets the client restore the session after a page refresh (S0g). */
export const me = async (req, res) => {
  try {
    const user = await authService.getCurrentUser(req.user.id);
    res.status(200).json({ success: true, user });
  } catch (err) {
    return handleError(res, err);
  }
};
