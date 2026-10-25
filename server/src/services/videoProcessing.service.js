import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { env } from '../config/env.js';
import cloudinary, { deleteFromCloudinary } from '../integrations/cloudinary.js';
import { completeVideoContent, markContentError } from '../repositories/content.repository.js';
import { logger } from '../utils/logger.js';

/*
 * One uploaded video  ->  compressed + cut into ~10-minute pieces  ->  each piece uploaded to Cloudinary.
 *
 * Why: the free Cloudinary plan rejects video files over 100 MB. The instructor uploads ONE file and never
 * sees the pieces; the student player plays them back as a single video (see LessonPlayer.jsx).
 *
 * Pieces are cut at exact boundaries (a keyframe is forced every VIDEO_PART_SECONDS), so the timeline of
 * the whole video is simply the pieces laid end to end.
 */

const run = (args, { collectStderr = false } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => {
      err = (err + d).slice(-8000); // keep the tail: that is where ffmpeg prints the actual error
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (collectStderr || code === 0) return resolve(err);
      reject(new Error(`ffmpeg failed (exit ${code}): ${err.split('\n').filter(Boolean).slice(-3).join(' | ')}`));
    });
  });

/** Length of a media file in seconds, read from ffmpeg's banner ("Duration: 00:10:00.04"). */
export const probeDuration = async (file) => {
  const out = await run(['-hide_banner', '-i', file], { collectStderr: true });
  const m = out.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) throw new Error('Could not read the video duration (is the file a valid video?)');
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
};

/**
 * Compress `input` and cut it into pieces inside `outDir`.
 * Returns the piece file paths in play order.
 */
export const splitVideo = async (input, outDir, opts = {}) => {
  const partSeconds = opts.partSeconds ?? env.videoPartSeconds;
  const maxHeight = opts.maxHeight ?? env.videoMaxHeight;
  const crf = opts.crf ?? env.videoCrf;

  await run([
    '-hide_banner', '-y', '-i', input,
    '-map', '0:v:0', '-map', '0:a:0?',                 // first video + first audio track (audio optional)
    '-vf', `scale=-2:'min(${maxHeight},ih)'`,          // never upscale; width kept even for H.264
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '64k', '-ac', '2',
    '-force_key_frames', `expr:gte(t,n_forced*${partSeconds})`,
    '-f', 'segment', '-segment_time', String(partSeconds), '-reset_timestamps', '1',
    '-segment_format', 'mp4', '-segment_format_options', 'movflags=+faststart',
    path.join(outDir, 'part-%03d.mp4'),
  ]);

  const files = (await fs.readdir(outDir)).filter((f) => /^part-\d+\.mp4$/.test(f)).sort();
  if (!files.length) throw new Error('ffmpeg produced no output');
  return files.map((f) => path.join(outDir, f));
};

// upload_large does NOT return a promise (it returns a stream and only reports through its callback,
// which fires once after the last chunk or on the first error), so wrap the callback ourselves.
const uploadPart = (file, publicId) =>
  new Promise((resolve, reject) => {
    cloudinary.uploader.upload_large(
      file,
      { resource_type: 'video', type: 'authenticated', public_id: publicId, overwrite: true, chunk_size: 6_000_000 },
      (err, res) => {
        if (err) return reject(new Error(`Cloudinary upload failed: ${err.message || err}`));
        if (!res?.secure_url || !res?.public_id) {
          return reject(new Error(`Cloudinary upload failed: ${res?.error?.message || 'no URL returned'}`));
        }
        resolve(res);
      }
    );
  });

/**
 * Whole pipeline for one content row. Never throws: failures are written to content.status / error_message.
 * `sourcePath` (the multer temp file) is always deleted at the end.
 */
export const processVideo = async (contentId, sourcePath) => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `video-${contentId}-`));
  const uploadedIds = [];
  const t0 = Date.now();
  const log = (msg) => logger.info(`[video ${contentId}] ${msg}`);
  try {
    const { size: srcSize } = await fs.stat(sourcePath);
    log(`received ${(srcSize / 1048576).toFixed(0)} MB, compressing...`);
    const files = await splitVideo(sourcePath, workDir);
    log(`compressed into ${files.length} part(s), uploading...`);

    const parts = [];
    for (const [i, file] of files.entries()) {
      const { size } = await fs.stat(file);
      if (size > env.videoMaxPartMb * 1024 * 1024) {
        throw new Error(
          `Part ${i + 1} is ${(size / 1048576).toFixed(0)} MB, over the ${env.videoMaxPartMb} MB limit. ` +
            'Lower VIDEO_MAX_HEIGHT / raise VIDEO_CRF (or shorten VIDEO_PART_SECONDS) in the server .env.'
        );
      }
      const durationSec = Math.round(await probeDuration(file));
      const res = await uploadPart(file, `elearning_platform/videos/${contentId}/part-${String(i + 1).padStart(3, '0')}`);
      uploadedIds.push(res.public_id);
      log(`uploaded part ${i + 1}/${files.length}`);
      parts.push({ url: res.secure_url, publicId: res.public_id, durationSec });
    }

    await completeVideoContent(contentId, parts);
    log(`ready: ${parts.length} part(s), ${parts.reduce((t, p) => t + p.durationSec, 0)}s of video, took ${Math.round((Date.now() - t0) / 1000)}s`);
  } catch (err) {
    logger.error(`[video ${contentId}] failed:`, err.message);
    // don't leave orphaned pieces in Cloudinary
    await Promise.allSettled(uploadedIds.map((id) => deleteFromCloudinary(id, 'video')));
    // the instructor sees this text: keep it readable and free of server paths
    const shown = /Invalid data found/.test(err.message)
      ? 'This file could not be read as a video. Try exporting it again as MP4.'
      : err.message.replace(/(?:[A-Za-z]:)?[\\/][^\s|]+/g, '<file>');
    await markContentError(contentId, shown).catch((e) => logger.error('Could not record error:', e.message));
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await fs.unlink(sourcePath).catch(() => {});
  }
};

// Re-encoding is CPU heavy: process one video at a time, the rest wait in line.
let queue = Promise.resolve();
export const enqueueVideo = (contentId, sourcePath) => {
  queue = queue.then(() => processVideo(contentId, sourcePath));
  return queue;
};
