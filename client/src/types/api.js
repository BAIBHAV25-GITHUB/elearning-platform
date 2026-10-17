// JSDoc typedefs for the main API shapes (editor hints only, nothing is checked at runtime).
// Use them from any file:   /** @param {import('../types/api').Course} course */
// Numbers that come from PostgreSQL DECIMAL columns (price, amount, revenue) arrive as strings: wrap them in
// Number() or formatMoney() before doing arithmetic.

/** @typedef {'student' | 'instructor' | 'admin'} Role */
/** @typedef {'active' | 'inactive' | 'banned'} UserStatus */
/** @typedef {'pending' | 'approved' | 'rejected'} InstructorStatus */
/** @typedef {'draft' | 'published' | 'archived'} CourseStatus */
/** @typedef {'uploading' | 'processing' | 'ready' | 'error'} ContentStatus */
/** @typedef {'pending' | 'active' | 'completed' | 'dropped'} EnrollmentStatus */
/** @typedef {'pending' | 'success' | 'failed' | 'refunded'} PaymentStatus */

/**
 * @typedef {Object} User
 * @property {number} id
 * @property {string} name
 * @property {string} email
 * @property {Role} role
 * @property {UserStatus} status
 * @property {InstructorStatus} [instructorStatus] only for instructors
 * @property {string} [createdAt]
 */

/**
 * @typedef {Object} Course
 * @property {number} course_id
 * @property {string} title
 * @property {string} [description]
 * @property {string} price DECIMAL, as a string
 * @property {CourseStatus} status
 * @property {string} [thumbnail_url]
 * @property {number} [instructor_id]
 * @property {string} [instructor_name]
 * @property {number} [enrollment_count]
 * @property {string} created_at
 */

/**
 * @typedef {Object} Content one lesson: a video, a PDF or a text lesson
 * @property {number} content_id
 * @property {number} sequence_no
 * @property {string} title
 * @property {'video' | 'pdf' | 'text'} type
 * @property {ContentStatus} status only a video is ever not 'ready'; 'error' carries error_message
 * @property {string} [error_message]
 * @property {number} [duration_sec]
 * @property {string} [video_url]
 * @property {{ video_url: string, duration_sec: number, captions_url?: string }[]} [parts] a long video stored as pieces
 * @property {string} [captions_url] optional WebVTT file (the player shows it when present)
 * @property {string} [transcript] optional plain-text transcript (the player shows it when present)
 */

/**
 * @typedef {Object} Module
 * @property {number} module_id
 * @property {number} sequence_no
 * @property {string} title
 * @property {string} [description]
 * @property {Content[]} [contents]
 */

/**
 * @typedef {Object} Batch
 * @property {number} batch_id
 * @property {string} batch_name
 * @property {string} start_date 'YYYY-MM-DD'
 * @property {string} end_date 'YYYY-MM-DD'
 * @property {number} max_capacity
 * @property {number} current_capacity
 * @property {'open' | 'full' | 'closed'} status
 */

/**
 * @typedef {Object} Enrollment a row of GET /enrollments/me
 * @property {number} enrollment_id
 * @property {number} course_id
 * @property {string} course_title
 * @property {string} batch_name
 * @property {string} start_date
 * @property {string} end_date
 * @property {EnrollmentStatus} enrollment_status
 * @property {number} total_lessons
 * @property {number} completed_lessons
 */

/**
 * @typedef {Object} Payment a row of GET /admin/payments
 * @property {number} payment_id
 * @property {string} student_name
 * @property {string} student_email
 * @property {string} course_title
 * @property {EnrollmentStatus} enrollment_status
 * @property {string} amount DECIMAL, as a string
 * @property {PaymentStatus} status
 * @property {string} [transaction_id]
 * @property {boolean} [needs_refund] a paid enrollment that was dropped or cancelled
 * @property {string} [refund_reason]
 * @property {string} [refunded_at]
 * @property {string} [paid_at]
 * @property {string} created_at
 */

/**
 * @typedef {Object} Certificate
 * @property {number} certificate_id
 * @property {string} course_title
 * @property {string} student_name
 * @property {string} issued_at
 */

/**
 * @typedef {Object} AnalyticsOverview data of GET /analytics/overview
 * @property {{ course_id: number, course_title: string, total_enrollments: number, total_revenue: string }[]} courseRevenue
 * @property {{ batch_id: number, batch_name?: string, course_title: string, current_capacity: number, max_capacity: number, is_full: boolean, batch_status?: string }[]} batchCapacity
 * @property {{ student_name: string, course_title: string, completed_contents: number, total_contents: number, completion_percentage: number }[]} studentProgress
 */

/**
 * @typedef {Object} TimelineRow one month of GET /analytics/timeline (DECIMALs are strings)
 * @property {string} month 'YYYY-MM'
 * @property {string} gross_revenue successful + refunded payments
 * @property {string} refunded the refunded part of gross_revenue
 * @property {string} net_revenue gross_revenue - refunded
 * @property {number} enrollments
 */

/**
 * @typedef {Object} TimelinePoint a TimelineRow ready for a chart (see monthlyTimeline in utils/analytics.js)
 * @property {string} month
 * @property {string} label 'Mar 26'
 * @property {number} gross
 * @property {number} refunded
 * @property {number} net
 * @property {number} enrollments
 */

/**
 * @template T
 * @typedef {Object} Paged a paged admin list; the array key differs per list (users, courses, payments, logs)
 * @property {number} total
 * @property {T[]} [users]
 * @property {T[]} [courses]
 * @property {T[]} [payments]
 * @property {T[]} [logs]
 */

export {};
