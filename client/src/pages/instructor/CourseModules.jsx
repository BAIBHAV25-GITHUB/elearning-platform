import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getCourseModulesApi, createModuleApi, deleteContentApi } from '../../services/module.service';
import api from '../../api/axios';
import CourseTools from '../../components/instructor/CourseTools';

export default function CourseModules() {
  const { courseId } = useParams();
  const [modules, setModules] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sequenceNo, setSequenceNo] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Day 12: Content Upload & Progress States
  const [activeModuleId, setActiveModuleId] = useState(null);
  const [contentTitle, setContentTitle] = useState('');
  const [contentType, setContentType] = useState('video');
  const [contentSeq, setContentSeq] = useState('');
  const [file, setFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [contentError, setContentError] = useState('');

  const fetchModules = async () => {
    try {
      const data = await getCourseModulesApi(courseId);
      setModules(data.modules || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch modules');
    } finally {
      setLoading(false);
    }
  };

  // While any video is still being processed on the server, re-check every 5 seconds
  // (silently: no loading flicker) so it flips to Ready / Failed by itself.
  const anyProcessing = modules.some((m) => (m.contents || []).some((c) => c.status === 'processing' || c.status === 'uploading'));
  useEffect(() => {
    if (!anyProcessing) return;
    const timer = setInterval(async () => {
      try {
        const data = await getCourseModulesApi(courseId);
        setModules(data.modules || []);
      } catch {
        /* keep the last list; try again next tick */
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [anyProcessing, courseId]);

  useEffect(() => {
    // fetch on mount / course change (state is set after the await, not synchronously)
    const t = setTimeout(fetchModules, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const handleAddModule = async (e) => {
    e.preventDefault();
    setError('');

    try {
      await createModuleApi(courseId, { title, description, ...(sequenceNo ? { sequenceNo: Number(sequenceNo) } : {}) });
      setTitle('');
      setDescription('');
      setSequenceNo('');
      await fetchModules();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create module');
    }
  };

  // Toggle Content Upload Form for a Module
  const toggleContentForm = (moduleId) => {
    if (activeModuleId === moduleId) {
      setActiveModuleId(null);
    } else {
      setActiveModuleId(moduleId);
      setContentSeq('');
      setContentTitle('');
      setFile(null);
      setContentError('');
      setUploadProgress(0);
    }
  };

  // Day 12: Handle Video / Document Upload to Cloudinary via Express
  const handleUploadContent = async (e, moduleId) => {
    e.preventDefault();
    if (!file) {
      setContentError('Please select a video or document file.');
      return;
    }

    setContentError('');
    setUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('title', contentTitle);
    formData.append('type', contentType);
    if (contentSeq) formData.append('sequenceNo', Number(contentSeq));
    formData.append('file', file);

    try {
      await api.post(`/courses/${courseId}/modules/${moduleId}/content`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          );
          setUploadProgress(percentCompleted);
        },
      });

      // Reset Form State
      setContentTitle('');
      setContentType('video');
      setFile(null);
      setActiveModuleId(null);
      setUploadProgress(0);

      // Refresh Curriculum List
      await fetchModules();
    } catch (err) {
      setContentError(err.response?.data?.message || 'Failed to upload content');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteContent = async (moduleId, c) => {
    if (!window.confirm(`Delete "${c.title}"? The video file is removed permanently and students lose their progress on it.`)) return;
    setError('');
    try {
      await deleteContentApi(courseId, moduleId, c.content_id);
      await fetchModules();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete content');
    }
  };

  const fmtDuration = (sec) => {
    const m = Math.round(sec / 60);
    if (m < 60) return `${Math.max(1, m)} min`;
    return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Loading course modules...</div>;

  return (
    <div className="max-w-4xl mx-auto mt-8 p-6">
      <Link to="/instructor/courses" className="text-indigo-600 hover:underline mb-4 inline-block font-medium text-sm">
        &larr; Back to My Courses
      </Link>
      <h1 className="text-2xl font-bold mb-6 text-slate-900">Manage Course Curriculum</h1>

      {error && <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">{error}</div>}

      <CourseTools courseId={courseId} />

      {/* Module Creation Form */}
      <form onSubmit={handleAddModule} className="bg-white p-6 rounded-lg border shadow-sm mb-8 space-y-4">
        <h2 className="text-lg font-semibold border-b pb-2 text-slate-800">Add New Module</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-3">
            <label className="block text-sm font-medium mb-1 text-slate-700">Module Title</label>
            <input
              type="text"
              required
              className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Introduction to Binary Trees"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-slate-700">Sequence No.</label>
            <input
              type="number"
              min="1"
              placeholder="Auto"
              className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={sequenceNo}
              onChange={(e) => setSequenceNo(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 text-slate-700">Description</label>
          <textarea
            rows="2"
            className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Overview of this module's topics..."
          />
        </div>
        <button
          type="submit"
          className="bg-indigo-600 text-white px-5 py-2 rounded text-sm font-medium hover:bg-indigo-700 transition"
        >
          + Add Module
        </button>
      </form>

      {/* Modules & Content List */}
      <div className="space-y-6">
        <h2 className="text-lg font-semibold text-slate-900">Course Modules ({modules.length})</h2>
        {modules.length === 0 ? (
          <p className="text-gray-500 italic border p-4 rounded text-center bg-white">No modules created yet.</p>
        ) : (
          modules.map((m) => (
            <div key={m.module_id} className="bg-white border rounded-lg p-5 shadow-sm space-y-4">
              <div className="flex justify-between items-start border-b pb-3">
                <div>
                  <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded mr-2">
                    Module #{m.sequence_no}
                  </span>
                  <h3 className="text-md font-bold text-slate-900 inline-block">{m.title}</h3>
                  <p className="text-sm text-gray-600 mt-1">{m.description || 'No description provided.'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => toggleContentForm(m.module_id)}
                  className="text-xs font-semibold bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-3 py-1.5 rounded transition"
                >
                  {activeModuleId === m.module_id ? 'Cancel' : '+ Add Video / Media'}
                </button>
              </div>

              {/* Upload Content Form (Day 12 UI) */}
              {activeModuleId === m.module_id && (
                <form
                  onSubmit={(e) => handleUploadContent(e, m.module_id)}
                  className="bg-slate-50 border rounded-lg p-4 space-y-4 text-sm"
                >
                  <h4 className="font-semibold text-slate-800">Upload Media to "{m.title}"</h4>
                  {contentError && <div className="text-red-600 text-xs bg-red-50 p-2 rounded">{contentError}</div>}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-slate-600 mb-1">Content Title</label>
                      <input
                        type="text"
                        required
                        className="w-full border rounded px-3 py-1.5 text-sm bg-white"
                        placeholder="e.g. Video 1: Array Operations"
                        value={contentTitle}
                        onChange={(e) => setContentTitle(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Sequence No.</label>
                      <input
                        type="number"
                        min="1"
                        placeholder="Auto"
                        className="w-full border rounded px-3 py-1.5 text-sm bg-white"
                        value={contentSeq}
                        onChange={(e) => setContentSeq(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Media Type</label>
                      <select
                        className="w-full border rounded px-3 py-1.5 text-sm bg-white"
                        value={contentType}
                        onChange={(e) => setContentType(e.target.value)}
                      >
                        <option value="video">Video (MP4, MKV, MOV, WEBM)</option>
                        <option value="pdf">Document (PDF)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Select File</label>
                      <input
                        type="file"
                        required
                        accept={contentType === 'video' ? 'video/*' : '.pdf'}
                        onChange={(e) => setFile(e.target.files[0])}
                        className="w-full text-xs text-slate-600 bg-white border rounded p-1"
                      />
                    </div>
                  </div>

                  {contentType === 'video' && (
                    <p className="text-xs text-slate-500">
                      Upload the whole video as one file. It is compressed and prepared automatically after the upload,
                      which can take a while for long videos. You can leave this page; it will show as Ready when done.
                    </p>
                  )}

                  {/* Real-time Axios Progress Bar */}
                  {uploading && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs font-semibold text-slate-600">
                        <span>{uploadProgress >= 100 ? 'Finishing up...' : 'Uploading video to the server...'}</span>
                        <span>{uploadProgress}%</span>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-2">
                        <div
                          className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={uploading}
                    className="bg-emerald-600 text-white font-medium px-4 py-1.5 rounded text-xs hover:bg-emerald-700 disabled:opacity-50 transition"
                  >
                    {uploading ? 'Uploading...' : 'Upload Content'}
                  </button>
                </form>
              )}

              {/* Module Content List (Hierarchy: Course -> Module -> Video/Content) */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Module Content
                </span>
                {!m.contents || m.contents.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No media content uploaded for this module yet.</p>
                ) : (
                  m.contents.map((c) => (
                    <div key={c.content_id} className="flex items-center justify-between gap-2 bg-slate-50 p-2.5 rounded border text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-indigo-600">#{c.sequence_no}</span>
                        <span className="font-semibold text-slate-800">{c.title}</span>
                        <span className="text-slate-400">({c.type})</span>
                      </div>
                      {c.status === 'processing' || c.status === 'uploading' ? (
                        <span className="text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded font-medium">
                          Processing... (compressing &amp; preparing)
                        </span>
                      ) : c.status === 'error' ? (
                        <span
                          className="text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded font-medium max-w-xs truncate"
                          title={c.error_message || 'Processing failed'}
                        >
                          Failed: {c.error_message || 'processing failed, upload again'}
                        </span>
                      ) : (
                        <span className="text-slate-500 font-mono">
                          {c.duration_sec ? fmtDuration(c.duration_sec) : 'Ready'}
                        </span>
                      )}
                      {c.status !== 'processing' && c.status !== 'uploading' && (
                        <button
                          type="button"
                          onClick={() => handleDeleteContent(m.module_id, c)}
                          className="text-red-600 hover:bg-red-50 border border-red-200 px-2 py-0.5 rounded font-medium shrink-0"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}