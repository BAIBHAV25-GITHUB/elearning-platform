import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

// Return DATE columns (batch start/end dates) as 'YYYY-MM-DD' strings instead of JS Dates,
// which avoids off-by-one-day shifts across timezones.
pg.types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: env.isProduction ? { rejectUnauthorized: false } : false,
});

pool.on('connect', () => {
  console.log('PostgreSQL database connected successfully');
});

pool.on('error', (err) => {
  console.error('Unexpected database error on idle client:', err);
  process.exit(-1);
});

export const query = (text, params) => pool.query(text, params);
export default pool;
