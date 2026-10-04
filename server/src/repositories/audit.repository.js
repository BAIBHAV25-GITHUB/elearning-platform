import { query } from '../config/db.js';

export const insertAuditLog = async ({ userId, action, tableName, entityId, oldValues, newValues, ipAddress }) => {
  const sql = `
    INSERT INTO audit_logs (user_id, action, table_name, entity_id, old_values, new_values, ip_address)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING audit_id
  `;
  const { rows } = await query(sql, [
    userId || null,
    action,
    tableName,
    entityId ? String(entityId) : null, // Stored as BIGINT/string representation
    oldValues ? JSON.stringify(oldValues) : null,
    newValues ? JSON.stringify(newValues) : null,
    ipAddress || null
  ]);
  return rows[0];
};