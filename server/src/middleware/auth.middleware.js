import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const verify = (req, res, next, { required }) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    if (required) return res.status(401).json({ message: 'Unauthorized: Token missing' });
    return next(); // guest
  }

  jwt.verify(authHeader.split(' ')[1], env.jwtSecret, (err, decoded) => {
    if (err) {
      // 401 (not 403) so the client knows to log out / re-authenticate (X13)
      return res.status(401).json({ message: 'Unauthorized: Invalid or expired token' });
    }
    req.user = decoded; // { id, role }
    next();
  });
};

export const authenticateJWT = (req, res, next) => verify(req, res, next, { required: true });

/** Guests pass through; a present-but-invalid token is still rejected. */
export const optionalAuth = (req, res, next) => verify(req, res, next, { required: false });
