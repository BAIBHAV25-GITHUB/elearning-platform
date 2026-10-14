import multer from 'multer';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { HttpError } from '../utils/errors.js';
import { env } from '../config/env.js';

// Files go to a temp file on disk (not RAM) and are streamed to Cloudinary;
// the controller deletes the temp file when it is done (X16).
const storage = multer.diskStorage({
  destination: os.tmpdir(),
  filename: (req, file, cb) =>
    cb(null, `upload-${crypto.randomBytes(12).toString('hex')}${path.extname(file.originalname || '').slice(0, 10)}`),
});

const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    'video/mp4',
    'video/webm',
    'video/x-matroska', // .mkv
    'video/quicktime', // .mov
    'application/pdf',
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new HttpError(400, 'Invalid file type. Only MP4, MKV, MOV, WEBM, and PDF are allowed.'), false);
  }
};

export const uploadSingleFile = multer({
  storage,
  fileFilter,
  limits: {
    // Videos are compressed and split on the server, so the original may be big.
    // (PDFs go straight to Cloudinary, whose free plan allows 10 MB for non-video files.)
    fileSize: env.maxVideoUploadMb * 1024 * 1024,
    files: 1,
  },
}).single('file');
