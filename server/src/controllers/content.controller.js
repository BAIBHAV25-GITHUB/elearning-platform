import fs from 'fs/promises';
import { uploadStreamToCloudinary, deleteFromCloudinary } from '../integrations/cloudinary.js';
import * as contentRepo from '../repositories/content.repository.js';
import { enqueueVideo } from '../services/videoProcessing.service.js';
import { moduleBelongsToCourse } from '../repositories/module.repository.js';
import { handleError, toId } from '../utils/errors.js';

const CONTENT_TYPES = new Set(['video', 'pdf', 'text']);

export const addContentToModule = async (req, res) => {
  const tempPath = req.file?.path;
  let uploaded = null;
  let handedToProcessor = false; // the video job deletes the temp file itself

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

    // VIDEO: answer right away and do the heavy work (compress, cut into pieces, upload to Cloudinary)
    // in the background. The row is created as 'processing' and flips to 'ready' (or 'error') by itself,
    // so the instructor just sees one video. See services/videoProcessing.service.js.
    if (type === 'video') {
      const pending = await contentRepo.createContent({
        moduleId,
        title: title.trim(),
        type,
        videoUrl: null,
        cloudinaryId: null,
        durationSec: 0,
        sequenceNo: seq,
        status: 'processing',
      });
      handedToProcessor = true;
      enqueueVideo(pending.content_id, tempPath);
      return res.status(202).json({
        success: true,
        message: 'Video received. It is being processed and will appear as ready shortly.',
        content: pending,
      });
    }

    const resourceType = 'raw';

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
    if (tempPath && !handedToProcessor) fs.unlink(tempPath).catch(() => {});
  }
};

/**
 * Delete a video / document: removes the DB row (pieces + progress cascade), then the files from
 * Cloudinary. The DB goes first so the course is never left pointing at a deleted file; if a Cloudinary
 * call fails the row is already gone and the leftover id is logged for manual cleanup.
 */
export const deleteContentFromModule = async (req, res) => {
  try {
    const courseId = req.courseId; // set by requireCourseOwner
    const moduleId = toId(req.params.moduleId);
    const contentId = toId(req.params.contentId);
    if (!moduleId || !contentId || !(await moduleBelongsToCourse(moduleId, courseId))) {
      return res.status(404).json({ message: 'Content not found in this course' });
    }

    const result = await contentRepo.deleteContent(contentId, moduleId);
    if (!result) return res.status(404).json({ message: 'Content not found in this course' });
    if (result.busy) {
      return res.status(409).json({ message: 'This video is still being processed. Try again once it finishes.' });
    }

    const outcomes = await Promise.allSettled(
      result.assets.map((a) => deleteFromCloudinary(a.publicId, a.resourceType))
    );
    const failed = [];
    outcomes.forEach((o, i) => {
      const id = result.assets[i].publicId;
      if (o.status === 'rejected' || !['ok', 'not found'].includes(o.value?.result)) {
        failed.push(id);
        console.error('Cloudinary cleanup failed for', id, o.reason?.message || o.value?.result);
      }
    });

    return res.status(200).json({
      success: true,
      message: failed.length
        ? 'Deleted, but some files could not be removed from Cloudinary (see server log).'
        : 'Deleted.',
      cloudinaryFailed: failed,
    });
  } catch (error) {
    return handleError(res, error);
  }
};
