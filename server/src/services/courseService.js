import cloudinary from '../config/cloudinary.js';
import * as courseRepo from '../repositories/courseRepository.js';

const uploadToCloudinary = (fileBuffer, resourceType = 'auto') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { resource_type: resourceType, folder: 'elearning_platform' },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );
    uploadStream.end(fileBuffer);
  });
};

export const createNewCourse = async ({ instructorId, title, description, price, file }) => {
  let thumbnailUrl = null;
  if (file) {
    thumbnailUrl = await uploadToCloudinary(file.buffer, 'image');
  }
  return await courseRepo.createCourse({ instructorId, title, description, price, thumbnailUrl });
};

export const addLessonToCourse = async ({ courseId, title, orderIndex, file }) => {
  if (!file) {
    const error = new Error('Video file is required for a lesson');
    error.statusCode = 400;
    throw error;
  }
  const videoUrl = await uploadToCloudinary(file.buffer, 'video');
  return await courseRepo.addLesson({ courseId, title, videoUrl, orderIndex });
};