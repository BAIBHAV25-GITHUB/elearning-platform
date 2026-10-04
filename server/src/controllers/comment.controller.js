import {
  findCommentById,
  createCommentInDb,
  getModuleCommentsFromDb
} from '../repositories/comment.repository.js';

export const postComment = async (req, res) => {
  try {
    const moduleId = req.params.id;
    const userId = req.user.user_id || req.user.id;
    const { content, parentCommentId } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ message: 'Comment content cannot be empty.' });
    }

    if (parentCommentId) {
      const parentComment = await findCommentById(parentCommentId);
      if (!parentComment) {
        return res.status(404).json({ message: 'Parent comment not found.' });
      }

      // Enforce 1-level depth: reject if parent already has a parent_comment_id
      if (parentComment.parent_comment_id !== null) {
        return res.status(400).json({
          message: 'Nested replies are restricted to a maximum depth of 1 level.'
        });
      }
    }

    const newComment = await createCommentInDb({
      moduleId: parseInt(moduleId, 10),
      userId,
      content: content.trim(),
      parentCommentId: parentCommentId ? parseInt(parentCommentId, 10) : null
    });

    return res.status(201).json({ success: true, comment: newComment });
  } catch (error) {
    console.error('Error posting comment:', error);
    return res.status(500).json({ message: error.message || 'Failed to post comment.' });
  }
};

export const getModuleComments = async (req, res) => {
  try {
    const moduleId = req.params.id;
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
    console.error('Error fetching comments:', error);
    return res.status(500).json({ message: error.message || 'Failed to fetch comments.' });
  }
};