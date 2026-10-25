// Pure helpers that turn the analytics API rows into chart / KPI data (kept apart so they are easy to test).

const num = (v) => Number(v) || 0;

export function truncate(text, max = 22) {
  const t = String(text ?? '');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Top courses by revenue, biggest first. */
export function revenueByCourse(rows = [], limit = 8) {
  return [...rows]
    .map((r) => ({ name: r.course_title, revenue: num(r.total_revenue), enrollments: num(r.total_enrollments) }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

/** Taken vs free seats for each batch. */
export function seatsByBatch(rows = [], limit = 10) {
  return rows.slice(0, limit).map((b) => {
    const max = num(b.max_capacity);
    const taken = Math.min(num(b.current_capacity), max);
    return {
      name: `${b.batch_name || `Batch #${b.batch_id}`}${b.course_title ? ` · ${b.course_title}` : ''}`,
      taken,
      free: Math.max(0, max - taken),
    };
  });
}

const BUCKETS = [
  { label: 'Not started', test: (p) => p <= 0 },
  { label: '1–49%', test: (p) => p > 0 && p < 50 },
  { label: '50–99%', test: (p) => p >= 50 && p < 100 },
  { label: 'Completed', test: (p) => p >= 100 },
];

/** How many enrolments sit in each completion band (the "funnel"). */
export function completionBuckets(rows = []) {
  return BUCKETS.map((b) => ({ name: b.label, students: rows.filter((r) => b.test(num(r.completion_percentage))).length }));
}

export function summary({ courseRevenue = [], studentProgress = [] } = {}) {
  const revenue = courseRevenue.reduce((s, r) => s + num(r.total_revenue), 0);
  const enrollments = courseRevenue.reduce((s, r) => s + num(r.total_enrollments), 0);
  const learners = studentProgress.length;
  const avg = learners ? Math.round(studentProgress.reduce((s, r) => s + num(r.completion_percentage), 0) / learners) : 0;
  const completed = studentProgress.filter((r) => num(r.completion_percentage) >= 100).length;
  return { revenue, enrollments, learners, avg, completed };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-03" -> "Mar 26" (parsed by hand so the time zone can never shift the month). */
export function monthLabel(key) {
  const [y, m] = String(key ?? '').split('-');
  const name = MONTHS[Number(m) - 1];
  return name ? `${name} ${String(y).slice(-2)}` : String(key ?? '');
}

/**
 * Rows of /analytics/timeline -> chart rows. Net = gross minus refunds (the server already works it out).
 * @param {import('../types/api').TimelineRow[]} [rows]
 * @returns {import('../types/api').TimelinePoint[]}
 */
export function monthlyTimeline(rows = []) {
  return rows.map((r) => {
    const gross = num(r.gross_revenue);
    const refunded = num(r.refunded);
    return {
      month: r.month,
      label: monthLabel(r.month),
      gross,
      refunded,
      net: r.net_revenue == null ? gross - refunded : num(r.net_revenue),
      enrollments: num(r.enrollments),
    };
  });
}

/** True when no month has any money or enrolments in it (so the charts can say "nothing yet"). */
export const timelineIsEmpty = (points = []) => !points.some((p) => p.gross || p.refunded || p.enrollments);
