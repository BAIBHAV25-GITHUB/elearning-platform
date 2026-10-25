// Loads manifest.json (from upload-videos.mjs) into your Postgres tables:
//   one content_modules row per lesson folder, one content row per 10-minute part.
//
// Put this file in the server/ folder (so it can use the server's node_modules and .env), copy
// manifest.json next to it, create the course in the app first, then:
//   node seed-content.mjs <courseId> --dry      (prints the plan, touches nothing)
//   node seed-content.mjs <courseId>            (inserts)
// Re-running is safe: a lesson whose first part is already in the DB is skipped.
import fs from "node:fs";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const courseId = parseInt(process.argv[2], 10);
const dry = process.argv.includes("--dry");
const manifestPath = process.argv.find((a) => a.endsWith(".json")) || "./manifest.json";

if (!courseId) {
  console.error("Usage: node seed-content.mjs <courseId> [manifest.json] [--dry]");
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
const lessonNames = [...lessons.keys()].sort(natural);
for (const parts of lessons.values()) parts.sort((a, b) => natural(a.file, b.file));

const prettyTitle = (name) => name.replace(/[-_]+/g, " ").trim();

if (dry) {
  let n = 0;
  lessonNames.forEach((name, i) => {
    const parts = lessons.get(name);
    n += parts.length;
    console.log(`Module ${i + 1}: "${prettyTitle(name)}"  (${parts.length} parts)`);
  });
  console.log(`\n${lessonNames.length} modules, ${n} content rows would be created for course ${courseId}.`);
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

    const exists = await client.query("SELECT 1 FROM content WHERE cloudinary_id = $1", [parts[0].public_id]);
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

      let seq = 0;
      for (const p of parts) {
        seq += 1;
        await client.query(
          `INSERT INTO content (module_id, title, type, video_url, cloudinary_id, duration_sec, sequence_no, status)
           VALUES ($1, $2, 'video', $3, $4, $5, $6, 'ready')`,
          [moduleId, `${title} - Part ${seq}`, p.url, p.public_id, Math.round(p.duration || 0), seq]
        );
      }
      await client.query("COMMIT");
      console.log(`OK   ${name} -> module ${moduleSeq}, ${parts.length} parts`);
    } catch (e) {
      await client.query("ROLLBACK");
      console.error(`FAIL ${name}:`, e.message);
    }
  }
} finally {
  await client.end();
}
