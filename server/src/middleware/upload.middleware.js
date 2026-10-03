import multer from 'multer';

// Store uploaded files in RAM buffer temporarily before streaming to Cloudinary
const storage = multer.memoryStorage();

// File filter for videos and documents
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    'video/mp4',
    'video/mkv',
    'video/webm',
    'application/pdf',
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only MP4, MKV, WEBM, and PDF are allowed.'), false);
  }
};

export const uploadSingleFile = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100 MB Limit
  },
}).single('file');