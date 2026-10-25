import { useState } from 'react';
import api from '../../api/axios';

/**
 * Viewer for PDF and text lessons. These have no playback, so progress is recorded when the
 * student presses "Mark as complete" (POST /progress). Without this a course that contains one
 * of them could never reach 100 % and the certificate would never be issued.
 *
 * Props
 *   content           the lesson (type 'pdf' | 'text'); PDFs keep their file URL in `video_url`
 *   enrollmentId      the student's enrollment; missing for an owner / admin previewing the course
 *   completed         true when the lesson is already done
 *   onProgressUpdate  (contentId, isCompleted) => void
 */
export default function ReadingLesson({ content, enrollmentId, completed, onProgressUpdate }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isPdf = content.type === 'pdf';
  const fileUrl = content.video_url;

  const markComplete = async () => {
    setError('');
    setSaving(true);
    try {
      await api.post('/progress', { enrollmentId, contentId: content.content_id });
      if (onProgressUpdate) onProgressUpdate(content.content_id, true);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save your progress. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {isPdf ? (
        fileUrl ? (
          <div className="space-y-2">
            <iframe
              src={fileUrl}
              title={content.title}
              className="w-full h-[70vh] rounded-xl bg-white border border-slate-700"
            />
            <a
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-sm text-indigo-300 hover:text-indigo-200 underline"
            >
              Open the PDF in a new tab
            </a>
          </div>
        ) : (
          <div className="p-8 text-center bg-slate-800 rounded-xl text-slate-400">This document is not available.</div>
        )
      ) : content.text_body ? (
        // plain text only (React escapes it), line breaks are kept
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 text-slate-100 leading-relaxed whitespace-pre-wrap break-words">
          {content.text_body}
        </div>
      ) : (
        <div className="p-8 text-center bg-slate-800 rounded-xl text-slate-400">This lesson has no text yet.</div>
      )}

      {error && <div className="bg-red-950/60 border border-red-800 text-red-300 p-3 rounded text-sm">{error}</div>}

      {enrollmentId ? (
        completed ? (
          <div className="inline-block text-emerald-400 font-semibold bg-emerald-950/60 px-3 py-1.5 rounded border border-emerald-800 text-sm">
            ✓ Completed
          </div>
        ) : (
          <button
            onClick={markComplete}
            disabled={saving}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-5 py-2 rounded-lg text-sm transition"
          >
            {saving ? 'Saving...' : 'Mark as complete'}
          </button>
        )
      ) : (
        <p className="text-xs text-slate-400">Preview mode: progress is only tracked for enrolled students.</p>
      )}
    </div>
  );
}
