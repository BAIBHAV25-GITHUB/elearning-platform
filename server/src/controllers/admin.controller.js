import * as userRepo from '../repositories/user.repository.js';
import * as adminRepo from '../repositories/admin.repository.js';
import * as paymentRepo from '../repositories/payment.repository.js';
import { isPaymentConfigured, refundGatewayPayment } from '../integrations/razorpay.js';
import { updateCourseStatusInDb } from '../repositories/course.repository.js';
import { insertAuditLog } from '../repositories/audit.repository.js';
import { handleError, toId } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const STATUSES = new Set(['active', 'inactive', 'banned']);
const ROLES = new Set(['admin', 'instructor', 'student']);
const INSTRUCTOR_STATUSES = new Set(['pending', 'approved', 'rejected']);

const toPublicUser = (row) => ({
  id: row.user_id,
  name: row.user_name,
  email: row.email,
  role: row.role,
  status: row.status,
  instructorStatus: row.instructor_status ?? null,
  ...(row.created_at ? { createdAt: row.created_at } : {}),
});

/** GET /admin/users?search=&role=&status=&page=&limit= */
export const listUsers = async (req, res) => {
  try {
    const { search, role, status, instructorStatus } = req.query;

    if (search !== undefined && (typeof search !== 'string' || search.length > 100)) {
      return res.status(400).json({ success: false, message: 'search must be text of at most 100 characters' });
    }
    if (instructorStatus !== undefined && !INSTRUCTOR_STATUSES.has(instructorStatus)) {
      return res.status(400).json({ success: false, message: 'instructorStatus must be one of: pending, approved, rejected' });
    }
    if (role !== undefined && !ROLES.has(role)) {
      return res.status(400).json({ success: false, message: 'role must be one of: admin, instructor, student' });
    }
    if (status !== undefined && !STATUSES.has(status)) {
      return res.status(400).json({ success: false, message: 'status must be one of: active, inactive, banned' });
    }

    const page = req.query.page === undefined ? 1 : toId(req.query.page);
    const limit = req.query.limit === undefined ? 20 : toId(req.query.limit);
    if (!page || !limit || limit > 100) {
      return res.status(400).json({ success: false, message: 'page must be 1 or more and limit between 1 and 100' });
    }

    const { users, total } = await userRepo.listUsers({
      search: search?.trim() || null,
      role: role ?? null,
      status: status ?? null,
      instructorStatus: instructorStatus ?? null,
      limit,
      offset: (page - 1) * limit,
    });

    return res.status(200).json({ success: true, users: users.map(toPublicUser), page, limit, total });
  } catch (err) {
    return handleError(res, err);
  }
};

/** PATCH /admin/users/:userId/status  { status: 'active' | 'inactive' | 'banned' } */
export const updateUserStatus = async (req, res) => {
  try {
    const userId = toId(req.params.userId);
    const status = req.body?.status;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'Invalid user id' });
    }
    if (!STATUSES.has(status)) {
      return res.status(400).json({ success: false, message: 'status must be one of: active, inactive, banned' });
    }

    const row = await userRepo.setUserStatus(req.user.id, userId, status);

    // Audit trail with the real before / after (the generic audit middleware only logs the new body)
    if (row.old_status !== row.status) {
      await insertAuditLog({
        userId: req.user.id,
        action: 'PATCH_USERS',
        tableName: 'users',
        entityId: userId,
        oldValues: { status: row.old_status },
        newValues: { status: row.status },
        ipAddress: req.ip,
      }).catch((err) => logger.error('Audit logging failed:', err));
    }

    return res.status(200).json({
      success: true,
      message:
        row.old_status === row.status
          ? `Account is already ${row.status}.`
          : `Account status changed from ${row.old_status} to ${row.status}.`,
      user: toPublicUser(row),
    });
  } catch (err) {
    return handleError(res, err);
  }
};

/** DELETE /admin/users/:userId - anonymise ("delete") an account. Payments and certificates stay, the person does not. */
export const deleteUser = async (req, res) => {
  try {
    const userId = toId(req.params.userId);
    if (!userId) return res.status(400).json({ success: false, message: 'Invalid user id' });

    const row = await userRepo.anonymiseUser(req.user.id, userId);

    // the audit row records the action, not the erased personal data
    await insertAuditLog({
      userId: req.user.id,
      action: 'DELETE_USERS',
      tableName: 'users',
      entityId: userId,
      oldValues: { role: row.role },
      newValues: { anonymised: true },
      ipAddress: req.ip,
    }).catch((err) => logger.error('Audit logging failed', { err: err.message }));

    return res.status(200).json({ success: true, message: 'Account deleted. Personal data was erased.' });
  } catch (err) {
    return handleError(res, err);
  }
};

const audit = (req, tableName, entityId, oldValues, newValues) =>
  insertAuditLog({
    userId: req.user.id,
    action: 'PATCH_' + tableName.toUpperCase(),
    tableName,
    entityId,
    oldValues,
    newValues,
    ipAddress: req.ip,
  }).catch((err) => logger.error('Audit logging failed:', err));

/** PATCH /admin/users/:userId/role  { role: 'student' | 'instructor' } */
export const updateUserRole = async (req, res) => {
  try {
    const userId = toId(req.params.userId);
    const role = req.body?.role;
    if (!userId) return res.status(400).json({ success: false, message: 'Invalid user id' });
    if (role !== 'student' && role !== 'instructor') {
      return res.status(400).json({ success: false, message: 'role must be student or instructor' });
    }

    const row = await userRepo.setUserRole(req.user.id, userId, role);
    const changed = row.old_role !== row.role;
    if (changed) {
      await audit(req, 'users', userId, { role: row.old_role }, { role: row.role, instructor_status: row.instructor_status });
    }

    return res.status(200).json({
      success: true,
      message: changed ? `Role changed from ${row.old_role} to ${row.role}.` : `Account is already a ${row.role}.`,
      user: { id: row.user_id, name: row.user_name, email: row.email, role: row.role, instructorStatus: row.instructor_status ?? null },
    });
  } catch (err) {
    return handleError(res, err);
  }
};

/** PATCH /admin/users/:userId/instructor-status  { status: 'approved' | 'rejected' } */
export const reviewInstructor = async (req, res) => {
  try {
    const userId = toId(req.params.userId);
    const decision = req.body?.status;
    if (!userId) return res.status(400).json({ success: false, message: 'Invalid user id' });
    if (decision !== 'approved' && decision !== 'rejected') {
      return res.status(400).json({ success: false, message: 'status must be approved or rejected' });
    }

    const row = await userRepo.reviewInstructor(req.user.id, userId, decision);
    const changed = row.old_instructor_status !== row.instructor_status;
    if (changed) {
      await audit(req, 'users', userId, { instructor_status: row.old_instructor_status }, { instructor_status: row.instructor_status });
    }

    return res.status(200).json({
      success: true,
      message: changed ? `Instructor ${row.instructor_status}.` : `Instructor is already ${row.instructor_status}.`,
      user: { id: row.user_id, name: row.user_name, email: row.email, role: 'instructor', instructorStatus: row.instructor_status },
    });
  } catch (err) {
    return handleError(res, err);
  }
};

/** PATCH /admin/courses/:courseId/instructor  { instructorId } */
export const reassignCourse = async (req, res) => {
  try {
    const courseId = toId(req.params.courseId);
    const instructorId = toId(req.body?.instructorId);
    if (!courseId) return res.status(400).json({ success: false, message: 'Invalid course id' });
    if (!instructorId) return res.status(400).json({ success: false, message: 'Choose an instructor' });

    const row = await adminRepo.reassignCourse(req.user.id, courseId, instructorId);
    await audit(req, 'courses', courseId, { instructor_id: row.old_instructor_id }, { instructor_id: row.instructor_id, reassigned: true });

    return res.status(200).json({
      success: true,
      message: `Course now belongs to ${row.instructor_name}.`,
      course: { course_id: row.course_id, title: row.title, instructor_id: row.instructor_id, instructor_name: row.instructor_name },
    });
  } catch (err) {
    return handleError(res, err);
  }
};

const PAYMENT_STATUSES = new Set(['pending', 'success', 'failed', 'refunded']);

/** GET /admin/payments?search=&status=&needsRefund=true&page=&limit= */
export const listPayments = async (req, res) => {
  try {
    const { search, status, needsRefund } = req.query;
    if (search !== undefined && (typeof search !== 'string' || search.length > 100)) {
      return res.status(400).json({ success: false, message: 'search must be text of at most 100 characters' });
    }
    if (status !== undefined && !PAYMENT_STATUSES.has(status)) {
      return res.status(400).json({ success: false, message: 'status must be one of: pending, success, failed, refunded' });
    }
    if (needsRefund !== undefined && needsRefund !== 'true') {
      return res.status(400).json({ success: false, message: 'needsRefund can only be true' });
    }
    const paging = readPaging(req);
    if (!paging) {
      return res.status(400).json({ success: false, message: 'page must be 1 or more and limit between 1 and 100' });
    }
    const { payments, total } = await paymentRepo.listPayments({
      search: search?.trim() || null,
      status: status ?? null,
      needsRefund: needsRefund === 'true' ? true : null,
      limit: paging.limit,
      offset: paging.offset,
    });
    return res.status(200).json({ success: true, payments, page: paging.page, limit: paging.limit, total });
  } catch (err) {
    return handleError(res, err);
  }
};

/**
 * POST /admin/payments/:paymentId/refund  { reason }
 * 1. SQL checks the rules, 2. Razorpay refunds the full amount, 3. SQL marks the payment refunded, drops the
 * enrollment (access ends, seat is freed) and notifies the student.
 */
export const refundPayment = async (req, res) => {
  try {
    const paymentId = toId(req.params.paymentId);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!paymentId) return res.status(400).json({ success: false, message: 'Invalid payment id' });
    if (!reason || reason.length > 300) {
      return res.status(400).json({ success: false, message: 'A reason is required (max 300 characters)' });
    }
    if (!isPaymentConfigured()) {
      return res.status(503).json({ success: false, message: 'Payments are not configured on this server' });
    }

    const target = await paymentRepo.getRefundTarget(req.user.id, paymentId);

    let refundId = null;
    try {
      const refund = await refundGatewayPayment(target.transaction_id, target.amount, { paymentId: String(paymentId), reason });
      refundId = refund?.id ?? null;
    } catch (gwErr) {
      const text = String(gwErr?.error?.description || gwErr?.message || '');
      // Already refunded at Razorpay (e.g. from their dashboard): just bring our database in line.
      if (!/fully refunded|already.*refund/i.test(text)) {
        logger.error('Razorpay refund failed:', gwErr?.error || gwErr);
        return res.status(502).json({ success: false, message: `The payment gateway refused the refund${text ? `: ${text}` : '.'}` });
      }
    }

    let row;
    try {
      row = await paymentRepo.markPaymentRefunded(req.user.id, paymentId, refundId, reason);
    } catch (dbErr) {
      logger.error(`REFUND ISSUED BUT NOT SAVED: payment ${paymentId} (gateway ${target.transaction_id}, refund ${refundId})`, dbErr);
      return res.status(500).json({
        success: false,
        message: 'The refund was sent to the gateway but could not be saved. Check the server log before trying again.',
      });
    }

    await audit(req, 'payments', paymentId, { amount: target.amount }, { status: 'refunded', refund_id: refundId, reason });

    return res.status(200).json({
      success: true,
      message: `Refunded INR ${row.amount}. The student was notified and the enrollment was closed.`,
      payment: { payment_id: row.payment_id, status: row.status },
    });
  } catch (err) {
    return handleError(res, err);
  }
};

const COURSE_STATUSES = new Set(['draft', 'published', 'archived']);
const AUDIT_ACTIONS = new Set(['INSERT', 'UPDATE', 'DELETE']);
const AUDIT_TABLES = new Set(['courses', 'enrollments', 'users', 'payments']);

/** Reads ?page & ?limit with defaults; returns null when invalid. */
const readPaging = (req, defLimit = 20, maxLimit = 100) => {
  const page = req.query.page === undefined ? 1 : toId(req.query.page);
  const limit = req.query.limit === undefined ? defLimit : toId(req.query.limit);
  if (!page || !limit || limit > maxLimit) return null;
  return { page, limit, offset: (page - 1) * limit };
};

/** GET /admin/overview: platform numbers + top courses by revenue */
export const getOverview = async (req, res) => {
  try {
    const [overview, topCourses] = await Promise.all([
      adminRepo.getPlatformOverview(),
      adminRepo.getTopCourses(5),
    ]);
    return res.status(200).json({ success: true, overview, topCourses });
  } catch (err) {
    return handleError(res, err);
  }
};

/** GET /admin/courses?search=&status=&page=&limit= (every course, drafts included) */
export const listCourses = async (req, res) => {
  try {
    const { search, status } = req.query;
    if (search !== undefined && (typeof search !== 'string' || search.length > 100)) {
      return res.status(400).json({ success: false, message: 'search must be text of at most 100 characters' });
    }
    if (status !== undefined && !COURSE_STATUSES.has(status)) {
      return res.status(400).json({ success: false, message: 'status must be one of: draft, published, archived' });
    }
    const paging = readPaging(req);
    if (!paging) {
      return res.status(400).json({ success: false, message: 'page must be 1 or more and limit between 1 and 100' });
    }
    const { courses, total } = await adminRepo.listAllCourses({
      search: search?.trim() || null,
      status: status ?? null,
      limit: paging.limit,
      offset: paging.offset,
    });
    return res.status(200).json({ success: true, courses, page: paging.page, limit: paging.limit, total });
  } catch (err) {
    return handleError(res, err);
  }
};

/**
 * PATCH /admin/courses/:courseId/status  { status }
 * Moderation: unpublish / archive / restore any course. The same SQL rules as for instructors apply
 * (publish checklist, no draft while students are enrolled), so archive is the way to take down a live course.
 */
export const updateCourseStatus = async (req, res) => {
  try {
    const courseId = toId(req.params.courseId);
    const status = req.body?.status;
    if (!courseId) return res.status(400).json({ success: false, message: 'Invalid course id' });
    if (!COURSE_STATUSES.has(status)) {
      return res.status(400).json({ success: false, message: 'status must be one of: draft, published, archived' });
    }

    const oldStatus = await adminRepo.getCourseStatus(courseId);
    const course = await updateCourseStatusInDb(courseId, req.user.id, status);
    if (!course) return res.status(404).json({ success: false, message: 'Course not found' });

    if (oldStatus !== course.status) {
      await insertAuditLog({
        userId: req.user.id,
        action: 'PATCH_COURSES',
        tableName: 'courses',
        entityId: courseId,
        oldValues: { status: oldStatus },
        newValues: { status: course.status, moderation: true },
        ipAddress: req.ip,
      }).catch((err) => logger.error('Audit logging failed:', err));
    }

    return res.status(200).json({
      success: true,
      message: oldStatus === course.status ? `Course is already ${course.status}.` : `Course is now ${course.status}.`,
      course: { course_id: course.course_id, title: course.title, status: course.status },
    });
  } catch (err) {
    return handleError(res, err);
  }
};

/** GET /admin/audit-logs?table=&action=&userId=&page=&limit= */
export const listAuditLogs = async (req, res) => {
  try {
    const { table, action, userId } = req.query;
    if (table !== undefined && !AUDIT_TABLES.has(table)) {
      return res.status(400).json({ success: false, message: 'table must be one of: courses, enrollments, users, payments' });
    }
    if (action !== undefined && !AUDIT_ACTIONS.has(action)) {
      return res.status(400).json({ success: false, message: 'action must be one of: INSERT, UPDATE, DELETE' });
    }
    const uid = userId === undefined ? null : toId(userId);
    if (userId !== undefined && !uid) return res.status(400).json({ success: false, message: 'Invalid userId' });
    const paging = readPaging(req, 25, 100);
    if (!paging) {
      return res.status(400).json({ success: false, message: 'page must be 1 or more and limit between 1 and 100' });
    }
    const { logs, total } = await adminRepo.listAuditLogs({
      tableName: table ?? null,
      actionType: action ?? null,
      userId: uid,
      limit: paging.limit,
      offset: paging.offset,
    });
    return res.status(200).json({ success: true, logs, page: paging.page, limit: paging.limit, total });
  } catch (err) {
    return handleError(res, err);
  }
};
