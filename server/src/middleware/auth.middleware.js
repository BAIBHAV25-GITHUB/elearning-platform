import { verifyToken } from '../utils/token.js';

/**
 * Middleware to verify Bearer JWT token in Authorization header.
 * Attaches decoded user payload (userId, email, roles) to req.user.
 */
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. No authentication token provided.',
    });
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: 'Invalid or expired token.',
    });
  }
};

/**
 * Role-Based Access Control (RBAC) Middleware.
 * Checks if the authenticated user possesses at least one of the permitted roles.
 * @param {...string} allowedRoles - Role names allowed to access the route (e.g., 'Admin', 'Instructor').
 */
export const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.roles) {
      return res.status(401).json({
        success: false,
        message: 'Authentication context missing.',
      });
    }

    const hasPermission = req.user.roles.some((role) => allowedRoles.includes(role));

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Access restricted to roles [${allowedRoles.join(', ')}].`,
      });
    }

    next();
  };
};