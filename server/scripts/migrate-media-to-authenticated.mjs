// One-off: protect media that was uploaded before step 5 (it is public on Cloudinary).
// Moves each file from delivery type "upload" to "authenticated" and flips content.delivery /
// content_parts.delivery, so the API starts handing out signed URLs for it.
//   node scripts/migrate-media-to-authenticated.mjs          # do it
//   node scripts/migrate-media-to-authenticated.mjs --dry    # only list what would change
// Safe to run again: rows already marked 'authenticated' are skipped. Run migration 006 first.
// NOTE: written from the Cloudinary docs (uploader.rename with to_type) and not run against a real account;
// try it with --dry first, then on one course.
import cloudinary from '../src/integrations/cloudinary.js';
import { query } from '../src/config/db.js';

const dry = process.argv.includes('--dry');

const move = async (publicId, resourceType) => {
  await cloudinary.uploader.rename(publicId, publicId, {
    resource_type: resourceType,
    type: 'upload',
    to_type: 'authenticated',
    overwrite: true,
    invalidate: true,
  });
};

const run = async () => {
  const items = [
    ...(await query(
      `SELECT 'content' AS tbl, content_id AS id, cloudinary_id, CASE WHEN type = 'pdf' THEN 'raw' ELSE 'video' END AS rt
         FROM content WHERE delivery = 'upload' AND cloudinary_id IS NOT NULL`
    )).rows,
    ...(await query(
      `SELECT 'content_parts' AS tbl, part_id AS id, cloudinary_id, 'video' AS rt
         FROM content_parts WHERE delivery = 'upload'`
    )).rows,
  ];
  console.log(`${items.length} file(s) to protect${dry ? ' (dry run)' : ''}`);
  let ok = 0;
  for (const it of items) {
    if (dry) { console.log(`  would move ${it.rt} ${it.cloudinary_id}`); continue; }
    try {
      await move(it.cloudinary_id, it.rt);
      const idCol = it.tbl === 'content' ? 'content_id' : 'part_id';
      await query(`UPDATE ${it.tbl} SET delivery = 'authenticated' WHERE ${idCol} = $1`, [it.id]);
      ok += 1;
      console.log(`  moved ${it.rt} ${it.cloudinary_id}`);
    } catch (err) {
      console.error(`  FAILED ${it.cloudinary_id}: ${err.message || err.error?.message}`);
    }
  }
  console.log(dry ? 'Dry run finished.' : `Done: ${ok}/${items.length} protected.`);
  process.exit(0);
};
run();
