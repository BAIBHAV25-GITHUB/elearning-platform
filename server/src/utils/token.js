import jwt from 'jsonwebtoken';

/**
 * Generates a signed JWT access token for an authenticated user.
 * @param {Object} payload - User context to embed in token payload (userId, email, roles).
 * @returns {string} Signed JWT token string.
 */
export const generateToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET || 'fallback_jwt_secret_key_2026', {
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  });
};

/**
 * Synchronously verifies a JWT token string using the configured secret key.
 * @param {string} token - The JWT string to verify.
 * @returns {Object} Decoded token payload if valid.
 */
export const verifyToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET || 'fallback_jwt_secret_key_2026');
};