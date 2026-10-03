import * as authService from '../services/auth.service.js';

export const register = async (req, res, next) => {
  try {
    const { userName, email, password, role } = req.body;
    const result = await authService.registerUser({
      name: userName,
      email,
      password,
      role,
    });
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const result = await authService.loginUser({ email, password });
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};