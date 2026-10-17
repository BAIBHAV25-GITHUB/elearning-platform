import * as authService from '../services/auth.service.js';
import { handleError } from '../utils/errors.js';

// Input is validated by validate(registerSchema / loginSchema) in auth.routes.js, so req.body is already
// trimmed and checked here (rules live in src/validation/auth.schemas.js).

export const register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    // Only 'student' / 'instructor' are accepted - 'admin' is rejected by fn_register_user (X1)
    const result = await authService.registerUser({ name, email, password, role });
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    return handleError(res, err);
  }
};

export const login = async (req, res) => {
  try {
    const result = await authService.loginUser(req.body);
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
