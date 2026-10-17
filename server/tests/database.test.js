import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from './helpers.js';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../database/migrations');

describe('database schema', () => {
  it('a fresh setup has every migration recorded as applied', async () => {
    const files = fs.readdirSync(migrationsDir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    const { rows } = await query('SELECT filename FROM schema_migrations ORDER BY filename');
    expect(rows.map((r) => r.filename)).toEqual(files);
  });

  it('the dead structures are gone', async () => {
    const tables = await query("SELECT to_regclass('public.reports') AS r, to_regclass('public.audit_log_details') AS d");
    expect(tables.rows[0]).toEqual({ r: null, d: null });
    const cols = await query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE (table_name = 'users' AND column_name = 'phone') OR (table_name = 'certificates' AND column_name = 'email_sent')`
    );
    expect(cols.rowCount).toBe(0);
  });

  it('has the indexes the app queries rely on', async () => {
    const { rows } = await query("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'");
    const names = rows.map((r) => r.indexname);
    for (const idx of ['idx_comments_module_created', 'idx_notif_user_created', 'idx_payments_status', 'idx_courses_instructor_status']) {
      expect(names, idx).toContain(idx);
    }
  });

  it('every function the server calls exists (guards against drift in the setup files)', async () => {
    const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
    const used = new Set();
    const walk = (d) => {
      for (const n of fs.readdirSync(d)) {
        const p = path.join(d, n);
        if (fs.statSync(p).isDirectory()) walk(p);
        else for (const m of fs.readFileSync(p, 'utf8').matchAll(/\b(fn_[a-z_]+)\s*\(/g)) used.add(m[1]);
      }
    };
    walk(src);
    const { rows } = await query("SELECT proname FROM pg_proc WHERE proname LIKE 'fn\\_%'");
    const have = new Set(rows.map((r) => r.proname));
    expect([...used].filter((f) => !have.has(f))).toEqual([]);
  });
});
