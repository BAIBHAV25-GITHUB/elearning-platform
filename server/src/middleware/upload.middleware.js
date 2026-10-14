import multer from 'multer';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { HttpError } from '../utils/errors.js';

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
    'application/pdf',
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new HttpError(400, 'Invalid file type. Only MP4, MKV, WEBM, and PDF are allowed.'), false);
  }
};

export const uploadSingleFile = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100 MB Limit
    files: 1,
  },
}).single('file');
