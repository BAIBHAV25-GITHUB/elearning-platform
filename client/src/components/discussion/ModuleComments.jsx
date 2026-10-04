import { useState, useEffect } from 'react';
import api from '../../api/axios';

export default function ModuleComments({ moduleId }) {
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyContent, setReplyContent] = useState('');

  const fetchComments = async () => {
    try {
      const res = await api.get(`/modules/${moduleId}/comments`);
      setComments(res.data.comments || []);
    } catch (err) {
      console.error('Failed to load module comments:', err);
    }
  };

  useEffect(() => {
    if (moduleId) fetchComments();
  }, [moduleId]);

  const handlePostTopComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    try {
      await api.post(`/modules/${moduleId}/comments`, { content: newComment });
      setNewComment('');
      fetchComments();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to post comment');
    }
  };

  const handlePostReply = async (parentCommentId) => {
    if (!replyContent.trim()) return;
    try {
      await api.post(`/modules/${moduleId}/comments`, {
        content: replyContent,
        parentCommentId
      });
      setReplyContent('');
      setReplyingTo(null);
      fetchComments();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to post reply');
    }
  };

  return (
    <div className="bg-slate-800 rounded-xl p-6 text-slate-100 space-y-6">
      <h3 className="text-lg font-bold border-b border-slate-700 pb-3">Module Discussion</h3>

      {/* Top Level Post Form */}
      <form onSubmit={handlePostTopComment} className="flex gap-3">
        <input
          type="text"
          placeholder="Ask a question or share thoughts..."
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-indigo-500"
        />
        <button
          type="submit"
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
        >
          Post
        </button>
      </form>

      {/* Comments List */}
      <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
        {comments.map((comment) => (
          <div key={comment.comment_id} className="bg-slate-900/60 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold text-indigo-300">{comment.user_name} ({comment.role})</span>
              <span>{new Date(comment.created_at).toLocaleString()}</span>
            </div>
            <p className="text-sm text-slate-200">{comment.content}</p>

            <button
              onClick={() => setReplyingTo(replyingTo === comment.comment_id ? null : comment.comment_id)}
              className="text-xs text-indigo-400 hover:underline"
            >
              Reply
            </button>

            {/* 1-Level Nested Form */}
            {replyingTo === comment.comment_id && (
              <div className="flex gap-2 pt-2">
                <input
                  type="text"
                  placeholder="Write a reply..."
                  value={replyContent}
                  onChange={(e) => setReplyContent(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded px-3 py-1 text-xs text-white focus:outline-none"
                />
                <button
                  onClick={() => handlePostReply(comment.comment_id)}
                  className="bg-indigo-600 text-xs px-3 py-1 rounded font-medium text-white hover:bg-indigo-500"
                >
                  Send
                </button>
              </div>
            )}

            {/* Render Nested Replies (1 Level Only) */}
            {comment.replies?.length > 0 && (
              <div className="ml-6 mt-3 space-y-2 border-l-2 border-slate-700 pl-3">
                {comment.replies.map((reply) => (
                  <div key={reply.comment_id} className="bg-slate-950/40 p-2 rounded text-xs space-y-1">
                    <div className="flex justify-between text-slate-400">
                      <span className="font-medium text-indigo-300">{reply.user_name}</span>
                      <span>{new Date(reply.created_at).toLocaleTimeString()}</span>
                    </div>
                    <p className="text-slate-300">{reply.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}