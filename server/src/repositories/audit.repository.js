import { query } from '../config/db.js';

// audit_logs.action_type is an enum (INSERT | UPDATE | DELETE). The middleware
// passes strings like 'POST_COURSES', so map the HTTP verb to the enum.
// Verbs with no equivalent (GET...) are not logged.
const toActionType = (action) => {
  const verb = String(action || '').split('_')[0].toUpperCase();
  if (verb === 'POST' || verb === 'INSERT') return 'INSERT';
  if (verb === 'PUT' || verb === 'PATCH' || verb === 'UPDATE') return 'UPDATE';
  if (verb === 'DELETE') return 'DELETE';
  return null;
};

export const insertAuditLog = async ({ userId, action, tableName, entityId, oldValues, newValues, ipAddress }) => {
  const actionType = toActionType(action);
  if (!actionType) return null;

  const sql = `
    INSERT INTO audit_logs (user_id, action_type, table_name, record_id, old_values, new_values, ip_address)
    VALUES ($1, $2::audit_action_enum, $3, $4, $5::jsonb, $6::jsonb, $7)
    RETURNING log_id
  `;
  const { rows } = await query(sql, [
    userId || null,
    actionType,
    tableName,
    /^\d+$/.test(String(entityId ?? '')) ? String(entityId) : null, // record_id is BIGINT, nullable
    oldValues ? JSON.stringify(oldValues) : null,
    newValues ? JSON.stringify(newValues) : null,
    ipAddress || null,
  ]);
  return rows[0];
};
