export const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false,
        message: 'Forbidden: Insufficient permissions for this resource' 
      });
    }
    next();
  };
};

// Instructors must be approved by an admin before they can create or publish courses (IMPROVEMENTS.md 3.2).
// Admins always pass. Imported lazily-free: only needs the repository.
import { getInstructorStatus } from '../repositories/user.repository.js';

export const INSTRUCTOR_NOT_APPROVED = 'INSTRUCTOR_NOT_APPROVED';

export const requireApprovedInstructor = async (req, res, next) => {
  try {
    if (req.user?.role === 'admin') return next();
    const status = await getInstructorStatus(req.user.id);
    if (status === 'approved') return next();
    return res.status(403).json({
      success: false,
      code: INSTRUCTOR_NOT_APPROVED,
      message:
        status === 'rejected'
          ? 'Your instructor application was rejected. Please contact support.'
          : 'Your instructor account is waiting for admin approval. You can create and publish courses once it is approved.',
    });
  } catch (err) {
    return next(err);
  }
};

/** Same gate, but only when the request publishes a course (status = 'published'). */
export const requireApprovedToPublish = (req, res, next) =>
  req.body?.status === 'published' ? requireApprovedInstructor(req, res, next) : next();
