import fs from 'fs';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js'; // make sure .env is loaded before reading CLOUDINARY_*

void env;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Streams a file to Cloudinary.
 * @param {string} filePath - path of the temp file written by multer
 * @param {Object} options - Cloudinary upload options (resource_type, folder, etc.)
 */
export const uploadStreamToCloudinary = (filePath, options = {}) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'elearning_platform/contents',
        resource_type: 'auto', // Auto-detects video or raw/pdf
        ...options,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    const source = fs.createReadStream(filePath);
    source.on('error', reject);
    source.pipe(uploadStream);
  });
};

/** Removes an uploaded asset (used when the DB insert fails after a successful upload). */
export const deleteFromCloudinary = (publicId, resourceType = 'video') =>
  cloudinary.uploader.destroy(publicId, { resource_type: resourceType });

export default cloudinary;

/**
 * URL a viewer can use for a stored file.
 *  - delivery 'upload' (older files): the public URL that is stored in the database.
 *  - delivery 'authenticated': a signed URL built per request. Without CLOUDINARY_AUTH_TOKEN_KEY the URL is
 *    signed (cannot be guessed or altered) but does not expire; with the key it expires after
 *    MEDIA_URL_TTL_SECONDS. Only people the API lets see the content ever receive it.
 * resourceType: 'video' | 'raw'. Videos are always stored as MP4 by the processing pipeline.
 */
export const mediaUrl = ({ delivery, publicId, resourceType, storedUrl }) => {
  if (delivery !== 'authenticated' || !publicId) return storedUrl;
  const opts = {
    resource_type: resourceType,
    type: 'authenticated',
    secure: true,
    ...(resourceType === 'video' ? { format: 'mp4' } : {}),
  };
  if (env.cloudinaryAuthTokenKey) {
    opts.auth_token = { key: env.cloudinaryAuthTokenKey, duration: env.mediaUrlTtlSeconds };
  } else {
    opts.sign_url = true;
  }
  return cloudinary.url(publicId, opts);
};
