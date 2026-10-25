import api from '../api/axios';

export const getOverviewApi = async () => (await api.get('/admin/overview')).data;

/** @param {Object} params page, limit, search, role, status, instructorStatus
 * @returns {Promise<import('../types/api').Paged<import('../types/api').User>>} */
export const listUsersApi = async (params) => (await api.get('/admin/users', { params })).data;
export const setUserStatusApi = async (userId, status) =>
  (await api.patch(`/admin/users/${userId}/status`, { status })).data;

export const setUserRoleApi = async (userId, role) =>
  (await api.patch(`/admin/users/${userId}/role`, { role })).data;
export const reviewInstructorApi = async (userId, status) =>
  (await api.patch(`/admin/users/${userId}/instructor-status`, { status })).data;
export const reassignCourseApi = async (courseId, instructorId) =>
  (await api.patch(`/admin/courses/${courseId}/instructor`, { instructorId })).data;

export const listAdminCoursesApi = async (params) => (await api.get('/admin/courses', { params })).data;
export const setAdminCourseStatusApi = async (courseId, status) =>
  (await api.patch(`/admin/courses/${courseId}/status`, { status })).data;

export const listAuditLogsApi = async (params) => (await api.get('/admin/audit-logs', { params })).data;

/** @param {Object} params page, limit, search, status, needsRefund
 * @returns {Promise<import('../types/api').Paged<import('../types/api').Payment>>} */
export const listPaymentsApi = async (params) => (await api.get('/admin/payments', { params })).data;
export const refundPaymentApi = async (paymentId, reason) =>
  (await api.post(`/admin/payments/${paymentId}/refund`, { reason })).data;
