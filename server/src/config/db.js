import pg from 'pg';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

// Return DATE columns (batch start/end dates) as 'YYYY-MM-DD' strings instead of JS Dates,
// which avoids off-by-one-day shifts across timezones.
pg.types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: env.dbSsl ? { rejectUnauthorized: env.dbSslRejectUnauthorized } : false,
});

// the pool opens several connections; announce only the first
let announced = false;
pool.on('connect', () => {
  if (announced) return;
  announced = true;
  logger.info('PostgreSQL database connected successfully');
});

// An idle client can error when the database restarts or the network blinks. The pool discards that client and
// opens a new one on demand, so log it and keep serving (the old code killed the whole process).
pool.on('error', (err) => {
  logger.error('Unexpected database error on idle client', { err });
});

export const query = (text, params) => pool.query(text, params);

/** True when the database answers a trivial query within the timeout. Used by /health. */
export const checkDb = async (timeoutMs = 2000) => {
  let timer;
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('database check timed out')), timeoutMs);
      }),
    ]);
    return true;
  } catch (err) {
    logger.warn('Database health check failed', { err: err.message });
    return false;
  } finally {
    clearTimeout(timer);
  }
};

/** Used on shutdown so in-flight queries finish and connections are released cleanly. */
export const closePool = () => pool.end();

export default pool;
