import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'elearning_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'Baibhav@25',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('[DB ERROR] Unexpected error on idle client:', err);
});

export const query = (text, params) => pool.query(text, params);

export default pool;