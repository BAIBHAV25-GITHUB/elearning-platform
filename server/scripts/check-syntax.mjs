// Minimal "lint" for CI: every source file must at least parse (node --check). Replace with ESLint/oxlint when wanted.
import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(m?js)$/.test(n) ? [p] : [];
  });

let failed = 0;
for (const f of [...walk('src'), ...walk('scripts'), ...walk('tests')]) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed++;
    console.error(`Syntax error in ${f}\n${r.stderr}`);
  }
}
if (failed) process.exit(1);
console.log('All files parse.');
