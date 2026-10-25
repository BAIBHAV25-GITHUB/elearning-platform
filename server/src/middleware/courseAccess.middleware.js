import { canManageCourse, findCourseAccessInfo } from '../repositories/course.repository.js';
import { toId, handleError } from '../utils/errors.js';

/**
 * Ownership guard for instructor endpoints (X8): the logged-in user must be the
 * course's instructor, or an admin. Run it after authenticateJWT.
 *   requireCourseOwner()        -> course id in req.params.courseId
 *   requireCourseOwner('id')    -> course id in req.params.id
 */
export const requireCourseOwner = (paramName = 'courseId') => async (req, res, next) => {
  try {
    const courseId = toId(req.params[paramName]);
    if (!courseId) return res.status(400).json({ success: false, message: 'Invalid course id' });

    const info = await findCourseAccessInfo(courseId);
    if (!info) return res.status(404).json({ success: false, message: 'Course not found' });

    if (!(await canManageCourse(courseId, req.user.id))) {
      return res.status(403).json({ success: false, message: 'Forbidden: you do not manage this course' });
    }
    req.courseId = courseId;
    next();
  } catch (err) {
    return handleError(res, err);
  }
};
