import fs from 'fs/promises';
import { uploadStreamToCloudinary, deleteFromCloudinary } from '../integrations/cloudinary.js';
import * as contentRepo from '../repositories/content.repository.js';
import { moduleBelongsToCourse } from '../repositories/module.repository.js';
import { handleError, toId } from '../utils/errors.js';

const CONTENT_TYPES = new Set(['video', 'pdf', 'text']);

export const addContentToModule = async (req, res) => {
  const tempPath = req.file?.path;
  let uploaded = null;

  try {
    const courseId = req.courseId; // set by requireCourseOwner
    const moduleId = toId(req.params.moduleId);
    const { title, sequenceNo } = req.body ?? {};
    // the old client sent "document"; the enum value is "pdf"
    const type = req.body?.type === 'document' ? 'pdf' : req.body?.type || 'video';

    if (!moduleId || !(await moduleBelongsToCourse(moduleId, courseId))) {
      return res.status(404).json({ message: 'Module not found in this course' });
    }
    if (typeof title !== 'string' || !title.trim() || title.length > 200) {
      return res.status(400).json({ message: 'Title is required (max 200 characters)' });
    }
    if (!CONTENT_TYPES.has(type)) {
      return res.status(400).json({ message: 'type must be one of: video, pdf, text' });
    }

    // sequenceNo is optional: the repository assigns MAX + 1
    let seq = null;
    if (sequenceNo !== undefined && sequenceNo !== null && sequenceNo !== '') {
      seq = Number(sequenceNo);
      if (!Number.isInteger(seq) || seq < 1 || seq > 32767) {
        return res.status(400).json({ message: 'sequenceNo must be a positive integer' });
      }
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Media file is required' });
    }

    const resourceType = type === 'video' ? 'video' : 'raw';

    // 1. Stream the temp file to Cloudinary
    uploaded = await uploadStreamToCloudinary(tempPath, { resource_type: resourceType });

    // 2. Save content row into Database
    const newContent = await contentRepo.createContent({
      moduleId,
      title: title.trim(),
      type,
      videoUrl: uploaded.secure_url,
      cloudinaryId: uploaded.public_id,
      durationSec: Math.round(uploaded.duration || 0),
      sequenceNo: seq,
    });
    uploaded = null; // persisted, nothing to clean up

    return res.status(201).json({
      success: true,
      message: 'Content uploaded and added successfully',
      content: newContent,
    });
  } catch (error) {
    return handleError(res, error);
  } finally {
    // don't leave orphaned assets / temp files behind (X16)
    if (uploaded?.public_id) {
      deleteFromCloudinary(uploaded.public_id, uploaded.resource_type || 'video').catch((e) =>
        console.error('Failed to remove orphaned Cloudinary asset:', uploaded.public_id, e.message)
      );
    }
    if (tempPath) fs.unlink(tempPath).catch(() => {});
  }
};
