// Every query key in one place, so a mutation can invalidate exactly the lists it changes.
// Lists that take filters / a page put them in the last key slot: invalidating the short key (e.g. qk.admin.users)
// refreshes every page and filter combination of that list.
export const qk = {
  certificates: ['certificates', 'mine'],
  enrollments: ['enrollments', 'mine'],
  instructorCourses: ['courses', 'instructor'],
  analytics: {
    overview: ['analytics', 'overview'],
    timeline: (months) => ['analytics', 'timeline', months],
  },
  admin: {
    overview: ['admin', 'overview'],
    users: ['admin', 'users'],
    courses: ['admin', 'courses'],
    payments: ['admin', 'payments'],
    auditLogs: ['admin', 'audit-logs'],
  },
};
