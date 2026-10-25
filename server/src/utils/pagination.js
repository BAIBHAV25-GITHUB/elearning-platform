import { query } from '../config/db.js';

// Optional pagination for list endpoints. It is backward compatible: a request WITHOUT ?page / ?limit gets exactly
// the response it always got (the whole list under the same key). Only when the caller asks for a page does the
// response also carry  pagination: { page, limit, total, totalPages }.
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/** Reads the validated query (see validation/paging.schemas.js). paged is false when neither key was sent. */
export const pagingFrom = (validQuery = {}) => {
  const paged = validQuery.page !== undefined || validQuery.limit !== undefined;
  if (!paged) return { paged: false };
  const page = validQuery.page ?? 1;
  const limit = validQuery.limit ?? DEFAULT_LIMIT;
  return { paged: true, page, limit, offset: (page - 1) * limit };
};

export const pagingMeta = ({ page, limit }, total) => ({
  page,
  limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / limit)),
});

/**
 * Runs a list query. Without paging it returns the plain array (old behaviour). With paging it returns
 * { rows, total } where total counts ALL matching rows (the same SQL, without LIMIT).
 * `sql` must end with its ORDER BY and must not contain a trailing semicolon.
 */
export const listRows = async (sql, params, paging) => {
  if (!paging?.paged) {
    const { rows } = await query(sql, params);
    return rows;
  }
  const [{ rows: countRows }, { rows }] = await Promise.all([
    query(`SELECT COUNT(*)::int AS n FROM (${sql}) counted`, params),
    query(`${sql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, paging.limit, paging.offset]),
  ]);
  return { rows, total: countRows[0].n };
};

/** Builds the JSON for a list endpoint:  { success, [key]: rows, pagination? } */
export const listResponse = (key, result, paging) =>
  paging?.paged
    ? { success: true, [key]: result.rows, pagination: pagingMeta(paging, result.total) }
    : { success: true, [key]: result };
