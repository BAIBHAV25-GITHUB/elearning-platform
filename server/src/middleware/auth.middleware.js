import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { findUserById } from '../repositories/user.repository.js';
import { handleError, toId } from '../utils/errors.js';

// Sent with the 403 for a disabled account so the client can log the user out cleanly.
export const ACCOUNT_DISABLED = 'ACCOUNT_DISABLED';

const verify = async (req, res, next, { required }) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    if (required) return res.status(401).json({ success: false, message: 'Unauthorized: Token missing' });
    return next(); // guest
  }

  let decoded;
  try {
    decoded = jwt.verify(authHeader.split(' ')[1], env.jwtSecret);
  } catch {
    // 401 (not 403) so the client knows to log out / re-authenticate (X13)
    return res.status(401).json({ success: false, message: 'Unauthorized: Invalid or expired token' });
  }

  try {
    // The token only proves who logged in. The account's status and role are read from the database
    // on every request (one primary-key lookup), so a deactivated / banned user is locked out at once
    // and a role change applies immediately, instead of staying valid until the token expires.
    const row = toId(decoded.id) ? await findUserById(decoded.id) : null;
    if (!row) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Account no longer exists' });
    }
    if (row.status !== 'active' || !row.role) {
      return res.status(403).json({
        success: false,
        code: ACCOUNT_DISABLED,
        message: 'Your account is not active. Please contact support.',
      });
    }
    req.user = { id: row.user_id, role: row.role };
    return next();
  } catch (err) {
    return handleError(res, err);
  }
};

export const authenticateJWT = (req, res, next) => verify(req, res, next, { required: true });

/** Guests pass through; a present-but-invalid token is still rejected. */
export const optionalAuth = (req, res, next) => verify(req, res, next, { required: false });
