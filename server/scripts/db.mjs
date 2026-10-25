#!/usr/bin/env node
// Database runner: create / migrate / inspect the PostgreSQL schema. Replaces "drop and recreate by hand".
//
//   node scripts/db.mjs setup [--seed] [--python] [--reset]   fresh database: schema + functions + triggers + views
//                                                             (+ demo users/courses with --seed, + Python course with --python)
//   node scripts/db.mjs migrate                               apply migrations/*.sql that have not run yet
//   node scripts/db.mjs status                                list applied / pending migrations
//   node scripts/db.mjs baseline [--through 007]              mark migrations as already applied (database created
//                                                             before this runner existed)
//   node scripts/db.mjs init                                  for containers: setup if the DB is empty, else migrate
//                                                             (seeds only when SEED_DEMO_DATA=true)
//
// Connection: DATABASE_URL (from the environment or server/.env). Files come from ../database (or DB_DIR).
// Seed data contains known passwords, so --seed / --reset are refused when NODE_ENV=production
// unless ALLOW_SEED_IN_PRODUCTION=1 is set on purpose.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../.env'), quiet: true });
const dbDir = path.resolve(process.env.DB_DIR || path.join(here, '../../database'));

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const flagValue = (name) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};

const isProd = process.env.NODE_ENV === 'production';
const seedAllowed = !isProd || process.env.ALLOW_SEED_IN_PRODUCTION === '1';

const read = (f) => fs.readFileSync(path.join(dbDir, f), 'utf8');
const migrationFiles = () =>
  fs.readdirSync(path.join(dbDir, 'migrations')).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : false,
});

const ensureLedger = () =>
  client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
const applied = async () => new Set((await client.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename));
const mark = (f) => client.query('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [f]);

const run = async (file, sql) => {
  try {
    await client.query(sql);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    err.message = `${file}: ${err.message}`;
    throw err;
  }
};

const hasSchema = async () =>
  (await client.query("SELECT to_regclass('public.users') IS NOT NULL AS ok")).rows[0].ok;

const setup = async ({ seed, python, reset }) => {
  if ((seed || reset) && !seedAllowed) {
    throw new Error('Refusing to seed/reset with NODE_ENV=production (seed users share a known password). Set ALLOW_SEED_IN_PRODUCTION=1 if you really mean it.');
  }
  if (reset) {
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    console.log('Schema reset.');
  } else if (await hasSchema()) {
    throw new Error('Database already has a schema. Use "migrate", or "setup --reset" in development.');
  }
  for (const f of ['schema.sql', 'functions.sql', 'triggers.sql', 'views.sql']) {
    await run(f, read(f));
    console.log(`  applied ${f}`);
  }
  if (seed) {
    await run('seed/base_seed.sql', read('seed/base_seed.sql'));
    console.log('  applied seed/base_seed.sql');
    if (python) {
      await run('seed/python_course.sql', read('seed/python_course.sql'));
      console.log('  applied seed/python_course.sql');
    }
  }
  // schema.sql already contains everything the migrations do, so a fresh database starts fully migrated
  await ensureLedger();
  for (const f of migrationFiles()) await mark(f);
  console.log(`Fresh database ready (${migrationFiles().length} migrations recorded as applied).`);
};

const migrate = async () => {
  await ensureLedger();
  const done = await applied();
  const pending = migrationFiles().filter((f) => !done.has(f));
  if (!pending.length) return console.log('Nothing to migrate.');
  for (const f of pending) {
    await run(f, read(`migrations/${f}`));
    await mark(f);
    console.log(`  migrated ${f}`);
  }
};

const status = async () => {
  await ensureLedger();
  const done = await applied();
  for (const f of migrationFiles()) console.log(`${done.has(f) ? 'applied' : 'PENDING'}  ${f}`);
};

const baseline = async () => {
  await ensureLedger();
  const through = flagValue('--through');
  const files = migrationFiles().filter((f) => !through || f.slice(0, through.length) <= through);
  for (const f of files) await mark(f);
  console.log(`Marked ${files.length} migration(s) as applied.`);
};

const main = async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  await client.connect();
  switch (cmd) {
    case 'setup':
      return setup({ seed: flags.has('--seed'), python: flags.has('--python'), reset: flags.has('--reset') });
    case 'migrate':
      return migrate();
    case 'status':
      return status();
    case 'baseline':
      return baseline();
    case 'init':
      return (await hasSchema())
        ? migrate()
        : setup({ seed: process.env.SEED_DEMO_DATA === 'true', python: false, reset: false });
    default:
      console.log('Usage: node scripts/db.mjs <setup [--seed] [--python] [--reset] | migrate | status | baseline [--through NNN] | init>');
      process.exitCode = cmd ? 1 : 0;
  }
};

main()
  .catch((err) => {
    console.error(`db: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => client.end());
