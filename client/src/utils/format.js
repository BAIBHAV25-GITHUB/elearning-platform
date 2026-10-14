const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });

/** One currency formatter for the whole UI (F17). */
export const formatPrice = (value) => {
  const n = Number(value);
  return n === 0 ? 'Free' : inr.format(Number.isFinite(n) ? n : 0);
};

/** Always show money amounts, even 0 (revenue tables). */
export const formatMoney = (value) => inr.format(Number(value) || 0);

/**
 * Dates from the API are 'YYYY-MM-DD' strings (DATE) or ISO timestamps.
 * Date-only strings are formatted without going through the local timezone (F23).
 */
export const formatDate = (value) => {
  if (!value) return '';
  const s = String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', ...(m ? { timeZone: 'UTC' } : {}) });
};
