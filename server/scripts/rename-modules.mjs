// Renames + reorders modules that were ALREADY loaded by scripts/seed-content.mjs, using scripts/module-titles.json.
// Run from the server/ folder:
//   node scripts/rename-modules.mjs <courseId> manifest.json --dry   (shows what would change)
//   node scripts/rename-modules.mjs <courseId> manifest.json
// Modules are matched through their Cloudinary ids, so nothing else is touched.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../.env") });

const courseId = parseInt(process.argv[2], 10);
const dry = process.argv.includes("--dry");
const manifestPath = process.argv.find((a) => a.endsWith(".json") && !a.includes("module-titles")) || "./manifest.json";
if (!courseId) {
  console.error("Usage: node scripts/rename-modules.mjs <courseId> [manifest.json] [--dry]");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const titles = JSON.parse(fs.readFileSync(path.join(here, "module-titles.json"), "utf8"));

// folder -> public_id of its first part (how the module is found in the DB)
const firstPart = new Map();
for (const [key, v] of Object.entries(manifest)) {
  const [folder, file] = key.split("/");
  if (!firstPart.has(folder) || file < firstPart.get(folder).file) firstPart.set(folder, { file, id: v.public_id });
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  const plan = [];
  for (const [i, t] of titles.entries()) {
    const fp = firstPart.get(t.folder);
    if (!fp) { console.log(`skip ${t.folder}: not in manifest`); continue; }
    const r = await client.query(
      `SELECT m.module_id FROM content_modules m
        WHERE m.course_id = $2
          AND EXISTS (SELECT 1 FROM content ct WHERE ct.module_id = m.module_id AND ct.cloudinary_id = $1
                      UNION ALL
                      SELECT 1 FROM content ct JOIN content_parts cp ON cp.content_id = ct.content_id
                       WHERE ct.module_id = m.module_id AND cp.cloudinary_id = $1)`, [fp.id, courseId]);
    if (!r.rowCount) { console.log(`skip ${t.folder}: not loaded in course ${courseId}`); continue; }
    plan.push({ moduleId: r.rows[0].module_id, title: t.title, seq: plan.length + 1, folder: t.folder });
  }
  for (const p of plan) console.log(`${String(p.seq).padStart(2)}. ${p.folder.padEnd(48)} -> ${p.title}`);
  if (dry) { console.log(`\n${plan.length} modules would be renamed (dry run, nothing changed).`); await client.query("ROLLBACK"); process.exit(0); }

  // two-phase reorder so UNIQUE(course_id, sequence_no) is never violated midway
  await client.query("UPDATE content_modules SET sequence_no = sequence_no + 10000 WHERE course_id = $1", [courseId]);
  for (const p of plan) {
    await client.query("UPDATE content_modules SET title = $2, sequence_no = $3 WHERE module_id = $1", [p.moduleId, p.title, p.seq]);
    await client.query(
      `UPDATE content SET title = $2 WHERE module_id = $1 AND type = 'video'`, [p.moduleId, p.title]);
  }
  // modules not in the titles file keep their relative order after the renamed ones
  await client.query(
    `UPDATE content_modules m SET sequence_no = $2 + r.n
       FROM (SELECT module_id, row_number() OVER (ORDER BY sequence_no) AS n
               FROM content_modules WHERE course_id = $1 AND sequence_no > 10000) r
      WHERE m.module_id = r.module_id`, [courseId, plan.length]);
  await client.query("COMMIT");
  console.log(`\nRenamed ${plan.length} modules.`);
} catch (e) {
  await client.query("ROLLBACK");
  console.error("Failed, nothing changed:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
