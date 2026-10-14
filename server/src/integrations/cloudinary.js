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
