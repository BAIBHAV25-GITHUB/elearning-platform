import {
  findCommentById,
  createCommentInDb,
  getModuleCommentsFromDb,
} from '../repositories/comment.repository.js';
import { findModuleAccess } from '../repositories/module.repository.js';
import { handleError, toId } from '../utils/errors.js';

// 404 for a missing module, 403 when the user is not entitled to the course (X11)
const checkModuleAccess = async (moduleId, userId, res) => {
  const access = await findModuleAccess(moduleId, userId);
  if (!access) {
    res.status(404).json({ message: 'Module not found.' });
    return false;
  }
  if (!access.allowed) {
    res.status(403).json({ message: 'You must be enrolled in this course to use its discussion.' });
    return false;
  }
  return true;
};

export const postComment = async (req, res) => {
  try {
    const moduleId = toId(req.params.id);
    const userId = req.user.id;
    const { content, parentCommentId } = req.body ?? {};

    if (!moduleId) return res.status(400).json({ message: 'Invalid module id.' });
    if (typeof content !== 'string' || !content.trim() || content.length > 2000) {
      return res.status(400).json({ message: 'Comment must be 1-2000 characters.' });
    }
    if (!(await checkModuleAccess(moduleId, userId, res))) return;

    let parentId = null;
    if (parentCommentId !== undefined && parentCommentId !== null && parentCommentId !== '') {
      parentId = toId(parentCommentId);
      if (!parentId) return res.status(400).json({ message: 'Invalid parentCommentId.' });

      const parentComment = await findCommentById(parentId);
      if (!parentComment) {
        return res.status(404).json({ message: 'Parent comment not found.' });
      }
      // the reply must stay in the same module as its parent
      if (parentComment.module_id !== moduleId) {
        return res.status(400).json({ message: 'Reply must belong to the same module as its parent.' });
      }
      // Enforce 1-level depth (also enforced by trigger T-06)
      if (parentComment.parent_comment_id !== null) {
        return res.status(400).json({
          message: 'Nested replies are restricted to a maximum depth of 1 level.',
        });
      }
    }

    const newComment = await createCommentInDb({
      moduleId,
      userId,
      content: content.trim(),
      parentCommentId: parentId,
    });

    return res.status(201).json({ success: true, comment: newComment });
  } catch (error) {
    return handleError(res, error);
  }
};

export const getModuleComments = async (req, res) => {
  try {
    const moduleId = toId(req.params.id);
    if (!moduleId) return res.status(400).json({ message: 'Invalid module id.' });
    if (!(await checkModuleAccess(moduleId, req.user.id, res))) return;

    const allComments = await getModuleCommentsFromDb(moduleId);

    // Group into 1-level hierarchy (top-level + replies)
    const commentMap = new Map();
    const topLevelComments = [];

    allComments.forEach((c) => {
      c.replies = [];
      commentMap.set(c.comment_id, c);
    });

    allComments.forEach((c) => {
      if (c.parent_comment_id && commentMap.has(c.parent_comment_id)) {
        commentMap.get(c.parent_comment_id).replies.push(c);
      } else if (!c.parent_comment_id) {
        topLevelComments.push(c);
      }
    });

    return res.status(200).json({ success: true, comments: topLevelComments });
  } catch (error) {
    return handleError(res, error);
  }
};
