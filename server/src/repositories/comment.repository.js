import { query } from '../config/db.js';
import { listRows } from '../utils/pagination.js';

// Table is `comments`; the author's role comes from user_roles via fn_user_role().

export const findCommentById = async (commentId) => {
  const sql = `
    SELECT comment_id, module_id, user_id, parent_comment_id, content, created_at
    FROM comments
    WHERE comment_id = $1
  `;
  const { rows } = await query(sql, [commentId]);
  return rows[0] || null;
};

/**
 * Trigger T-06 rejects replies whose parent is in another module or is itself
 * a reply (P0001).
 */
export const createCommentInDb = async ({ moduleId, userId, content, parentCommentId = null }) => {
  const sql = `
    INSERT INTO comments (module_id, user_id, content, parent_comment_id)
    VALUES ($1, $2, $3, $4)
    RETURNING comment_id, module_id, user_id, content, parent_comment_id, created_at
  `;
  const { rows } = await query(sql, [moduleId, userId, content, parentCommentId]);
  return rows[0];
};

const COMMENT_SELECT = `
  SELECT c.comment_id, c.module_id, c.user_id, c.parent_comment_id, c.content, c.created_at,
         u.user_name, fn_user_role(u.user_id) AS role
  FROM comments c
  JOIN users u ON c.user_id = u.user_id`;

/**
 * Without paging: every comment of the module (old behaviour).
 * With paging: a page of TOP-LEVEL comments plus all replies to those comments, as { rows, total }
 * (total counts top-level comments; a reply always stays on the page of its parent).
 */
export const getModuleCommentsFromDb = async (moduleId, paging) => {
  if (!paging?.paged) {
    const { rows } = await query(`${COMMENT_SELECT} WHERE c.module_id = $1 ORDER BY c.created_at ASC`, [moduleId]);
    return rows;
  }
  const top = await listRows(
    `${COMMENT_SELECT} WHERE c.module_id = $1 AND c.parent_comment_id IS NULL ORDER BY c.created_at ASC, c.comment_id ASC`,
    [moduleId],
    paging
  );
  const ids = top.rows.map((c) => c.comment_id);
  const replies = ids.length
    ? (await query(`${COMMENT_SELECT} WHERE c.parent_comment_id = ANY($1::int[]) ORDER BY c.created_at ASC`, [ids])).rows
    : [];
  return { rows: [...top.rows, ...replies], total: top.total };
};
