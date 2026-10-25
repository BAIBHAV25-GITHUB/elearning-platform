// Loads manifest.json (from upload-videos.mjs) into your Postgres tables:
//   one content_modules row per lesson folder, ONE content row per lesson (the video), and its
//   10-minute pieces in content_parts. Same layout the app's own upload produces:
//     1 piece  -> content.video_url / cloudinary_id (no content_parts rows)
//     N pieces -> content_parts rows, content.video_url stays NULL; content.duration_sec = total
//
// Lives in server/scripts/ (uses the server's node_modules and ../.env). Create the course in the
// app first, then run from the server/ folder:
//   node scripts/seed-content.mjs <courseId> path/to/manifest.json --dry   (prints the plan)
//   node scripts/seed-content.mjs <courseId> path/to/manifest.json         (inserts)
// Re-running is safe: a lesson whose first piece is already in the DB is skipped.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const courseId = parseInt(process.argv[2], 10);
const dry = process.argv.includes("--dry");
const manifestPath = process.argv.find((a) => a.endsWith(".json")) || "./manifest.json";

if (!courseId) {
  console.error("Usage: node scripts/seed-content.mjs <courseId> [manifest.json] [--dry]");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

// Group "lesson/part-000.mp4" keys by lesson, with lessons and parts in natural order.
const lessons = new Map();
for (const [key, v] of Object.entries(manifest)) {
  const [lesson, file] = key.split("/");
  if (!lessons.has(lesson)) lessons.set(lesson, []);
  lessons.get(lesson).push({ file, ...v });
}
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true });
// scripts/module-titles.json = [{ "folder": "00001", "title": "..." }, ...]
// Its order is the module order; folders it does not list follow in natural order.
const titlesPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "module-titles.json");
const titleList = fs.existsSync(titlesPath) ? JSON.parse(fs.readFileSync(titlesPath, "utf8")) : [];
const titleOf = new Map(titleList.map((t) => [t.folder, t.title]));
const listed = titleList.map((t) => t.folder).filter((f) => lessons.has(f));
const lessonNames = [...listed, ...[...lessons.keys()].filter((k) => !titleOf.has(k)).sort(natural)];
for (const parts of lessons.values()) parts.sort((a, b) => natural(a.file, b.file));

const prettyTitle = (name) => titleOf.get(name) || name.replace(/[-_]+/g, " ").trim();

if (dry) {
  let n = 0;
  lessonNames.forEach((name, i) => {
    const parts = lessons.get(name);
    n += parts.length;
    console.log(`Module ${i + 1}: "${prettyTitle(name)}"  (1 video, ${parts.length} parts)`);
  });
  console.log(`\n${lessonNames.length} modules, ${lessonNames.length} videos (${n} parts) would be created for course ${courseId}.`);
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (check server/.env).");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});
await client.connect();

try {
  const course = await client.query("SELECT course_id FROM courses WHERE course_id = $1", [courseId]);
  if (!course.rowCount) throw new Error(`Course ${courseId} does not exist. Create it in the app first.`);

  const { rows } = await client.query(
    "SELECT COALESCE(MAX(sequence_no), 0) AS max FROM content_modules WHERE course_id = $1",
    [courseId]
  );
  let moduleSeq = rows[0].max;

  for (const name of lessonNames) {
    const parts = lessons.get(name);

    const exists = await client.query(
      `SELECT 1 FROM content WHERE cloudinary_id = $1
       UNION ALL SELECT 1 FROM content_parts WHERE cloudinary_id = $1`,
      [parts[0].public_id]
    );
    if (exists.rowCount) {
      console.log(`SKIP ${name} (already in database)`);
      continue;
    }

    await client.query("BEGIN");
    try {
      moduleSeq += 1;
      const title = prettyTitle(name);
      const m = await client.query(
        "INSERT INTO content_modules (course_id, title, sequence_no) VALUES ($1, $2, $3) RETURNING module_id",
        [courseId, title, moduleSeq]
      );
      const moduleId = m.rows[0].module_id;

      const total = parts.reduce((t, p) => t + Math.round(p.duration || 0), 0);
      const single = parts.length === 1;
      const c = await client.query(
        `INSERT INTO content (module_id, title, type, video_url, cloudinary_id, duration_sec, sequence_no, status)
         VALUES ($1, $2, 'video', $3, $4, $5, 1, 'ready') RETURNING content_id`,
        [moduleId, title, single ? parts[0].url : null, single ? parts[0].public_id : null, total]
      );
      if (!single) {
        for (const [i, p] of parts.entries()) {
          await client.query(
            `INSERT INTO content_parts (content_id, part_no, video_url, cloudinary_id, duration_sec)
             VALUES ($1, $2, $3, $4, $5)`,
            [c.rows[0].content_id, i + 1, p.url, p.public_id, Math.round(p.duration || 0)]
          );
        }
      }
      await client.query("COMMIT");
      console.log(`OK   ${name} -> module ${moduleSeq}, 1 video (${parts.length} parts)`);
    } catch (e) {
      await client.query("ROLLBACK");
      console.error(`FAIL ${name}:`, e.message);
    }
  }
} finally {
  await client.end();
}
