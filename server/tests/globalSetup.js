import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Runs once before all test files: make sure the test database exists, then rebuild it from ../database
// (schema + functions + triggers + views + demo seed) so every run starts from the same known state.
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/elearning_test';
  const dbName = new URL(url).pathname.slice(1);
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to wipe database "${dbName}": the test database name must contain "test".`);
  }

  // create the database when it is missing (CI creates it through the postgres service instead)
  const admin = new pg.Client({ connectionString: url.replace(/\/[^/]+$/, '/postgres') });
  try {
    await admin.connect();
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (!rowCount) await admin.query(`CREATE DATABASE "${dbName}"`);
  } catch {
    /* no access to the "postgres" database: assume the test database was created by hand */
  } finally {
    await admin.end().catch(() => {});
  }

  execFileSync(process.execPath, ['scripts/db.mjs', 'setup', '--seed', '--reset'], {
    cwd: serverDir,
    env: { ...process.env, DATABASE_URL: url, NODE_ENV: 'test' },
    stdio: 'pipe',
  });
}
