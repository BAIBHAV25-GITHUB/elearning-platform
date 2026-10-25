import { afterAll } from 'vitest';
import pool from '../src/config/db.js';

// each test file gets its own module graph (and its own pool): close it when the file is done
afterAll(async () => {
  await pool.end();
});
