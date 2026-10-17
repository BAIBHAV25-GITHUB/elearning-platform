import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getCourseModulesApi, createModuleApi, deleteContentApi, updateModuleApi, reorderModulesApi, deleteModuleApi } from '../../services/module.service';
import api from '../../api/axios';
import CourseTools from '../../components/instructor/CourseTools';
import BatchManager from '../../components/instructor/BatchManager';
import { useConfirm } from '../../components/common/Confirm';
import StatusBadge from '../../components/common/StatusBadge';

// How often rows that are still uploading / processing are re-checked.
export const POLL_MS = 5000;
const isBusy = (c) => c.status === 'processing' || c.status === 'uploading';
const isCancel = (err) => err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError';

export default function CourseModules() {
  const confirm = useConfirm();
  const { courseId } = useParams();
  const [modules, setModules] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sequenceNo, setSequenceNo] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [batchRefresh, setBatchRefresh] = useState(0);

  // module edit state
  const [editModuleId, setEditModuleId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [moduleBusy, setModuleBusy] = useState(false);

  // Day 12: Content Upload & Progress States
  const [activeModuleId, setActiveModuleId] = useState(null);
  const [contentTitle, setContentTitle] = useState('');
  const [contentType, setContentType] = useState('video');
  const [contentSeq, setContentSeq] = useState('');
  const [file, setFile] = useState(null);
  const [textBody, setTextBody] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [contentError, setContentError] = useState('');
  const [contentNotice, setContentNotice] = useState('');
  const [uploadFailed, setUploadFailed] = useState(false); // last attempt failed: the form is kept so it can be retried
  const uploadAbort = useRef(null); // AbortController of the upload in flight
  const lastStatus = useRef({}); // content_id -> status, to announce processing -> ready / failed
  const [announcement, setAnnouncement] = useState('');

  // Stores a fresh module list and, for every lesson that was processing a moment ago, announces how it ended.
  const applyModules = (list) => {
    for (const m of list) {
      for (const c of m.contents || []) {
        const before = lastStatus.current[c.content_id];
        if ((before === 'processing' || before === 'uploading') && !isBusy(c)) {
          setAnnouncement(c.status === 'error' ? `"${c.title}" failed to process.` : `"${c.title}" is ready.`);
        }
        lastStatus.current[c.content_id] = c.status;
      }
    }
    setModules(list);
  };

  const fetchModules = async () => {
    try {
      const data = await getCourseModulesApi(courseId);
      applyModules(data.modules || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch modules');
    } finally {
      setLoading(false);
    }
  };

  // While any video is still being processed on the server, re-check every POLL_MS (silently: no loading
  // flicker) until it flips to Ready / Failed. Polling stops when nothing is busy, and pauses in a hidden tab
  // (it catches up as soon as the tab is visible again).
  const anyProcessing = modules.some((m) => (m.contents || []).some(isBusy));
  useEffect(() => {
    if (!anyProcessing) return undefined;
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const data = await getCourseModulesApi(courseId);
        applyModules(data.modules || []);
      } catch {
        /* keep the last list; try again next tick */
      }
    };
    const timer = setInterval(refresh, POLL_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setContentType('video');
      setFile(null);
      setTextBody('');
      setContentError('');
      setContentNotice('');
      setUploadFailed(false);
      setUploadProgress(0);
    }
  };

  // Day 12: Handle Video / Document Upload to Cloudinary via Express
  const handleUploadContent = async (e, moduleId) => {
    e.preventDefault();
    const isText = contentType === 'text';
    if (isText && !textBody.trim()) {
      setContentError('Please write the lesson text.');
      return;
    }
    if (!isText && !file) {
      setContentError('Please select a video or document file.');
      return;
    }

    setContentError('');
    setContentNotice('');
    setUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('title', contentTitle);
    formData.append('type', contentType);
    if (contentSeq) formData.append('sequenceNo', Number(contentSeq));
    if (isText) formData.append('textBody', textBody);
    else formData.append('file', file);

    const controller = new AbortController();
    uploadAbort.current = controller;
    try {
      await api.post(`/courses/${courseId}/modules/${moduleId}/content`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        signal: controller.signal,
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) setUploadProgress(Math.round((progressEvent.loaded * 100) / progressEvent.total));
        },
      });

      // Reset Form State
      setContentTitle('');
      setContentType('video');
      setFile(null);
      setTextBody('');
      setActiveModuleId(null);
      setUploadProgress(0);
      setUploadFailed(false);

      // Refresh Curriculum List
      await fetchModules();
    } catch (err) {
      setUploadProgress(0);
      if (isCancel(err)) {
        // The form (title, file, text) stays filled in, so the upload can simply be started again.
        setContentNotice('Upload cancelled. Your details are still filled in, so you can upload again.');
        await fetchModules(); // in case the server had already accepted the file when you cancelled
      } else {
        setUploadFailed(true);
        setContentError(err.response?.data?.message || 'Failed to upload content');
      }
    } finally {
      uploadAbort.current = null;
      setUploading(false);
    }
  };

  const cancelUpload = () => uploadAbort.current?.abort();

  const handleDeleteContent = async (moduleId, c) => {
    if (!(await confirm({ title: 'Delete lesson', message: `Delete "${c.title}"? The file is removed permanently and students lose their progress on it.`, confirmLabel: 'Delete', danger: true }))) return;
    setError('');
    try {
      await deleteContentApi(courseId, moduleId, c.content_id);
      await fetchModules();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete content');
    }
  };

  const startEditModule = (m) => {
    setError('');
    setEditModuleId(m.module_id);
    setEditTitle(m.title);
    setEditDescription(m.description || '');
  };

  const handleSaveModule = async (e, moduleId) => {
    e.preventDefault();
    setError('');
    setModuleBusy(true);
    try {
      await updateModuleApi(courseId, moduleId, { title: editTitle, description: editDescription });
      setEditModuleId(null);
      await fetchModules();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save the module');
    } finally {
      setModuleBusy(false);
    }
  };

  // direction: -1 = move up, +1 = move down
  const handleMoveModule = async (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= modules.length) return;
    const ids = modules.map((m) => m.module_id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setError('');
    setModuleBusy(true);
    try {
      const data = await reorderModulesApi(courseId, ids);
      setModules(data.modules || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reorder the modules');
    } finally {
      setModuleBusy(false);
    }
  };

  const handleDeleteModule = async (m) => {
    const n = (m.contents || []).length;
    if (!(await confirm({ title: 'Delete module', message: `Delete module "${m.title}"${n ? ` and its ${n} lesson(s)` : ''}? The files are removed permanently and students lose their progress on them.`, confirmLabel: 'Delete', danger: true }))) return;
    setError('');
    setModuleBusy(true);
    try {
      await deleteModuleApi(courseId, m.module_id);
      await fetchModules();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete the module');
    } finally {
      setModuleBusy(false);
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

      {error && <div role="alert" className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">{error}</div>}
      <div role="status" aria-live="polite" className="sr-only">{announcement}</div>

      <CourseTools courseId={courseId} onBatchCreated={() => setBatchRefresh((n) => n + 1)} />
      <BatchManager courseId={courseId} refreshKey={batchRefresh} />

      {/* Module Creation Form */}
      <form onSubmit={handleAddModule} className="bg-white p-6 rounded-lg border shadow-sm mb-8 space-y-4">
        <h2 className="text-lg font-semibold border-b pb-2 text-slate-800">Add New Module</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-3">
            <label htmlFor="new-module-title" className="block text-sm font-medium mb-1 text-slate-700">Module Title</label>
            <input
              id="new-module-title"
              type="text"
              required
              className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Introduction to Binary Trees"
            />
          </div>
          <div>
            <label htmlFor="new-module-seq" className="block text-sm font-medium mb-1 text-slate-700">Sequence No.</label>
            <input
              id="new-module-seq"
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
          <label htmlFor="new-module-description" className="block text-sm font-medium mb-1 text-slate-700">Description</label>
          <textarea
            id="new-module-description"
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
          modules.map((m, idx) => (
            <div key={m.module_id} className="bg-white border rounded-lg p-5 shadow-sm space-y-4">
              {editModuleId === m.module_id ? (
                <form onSubmit={(e) => handleSaveModule(e, m.module_id)} className="border-b pb-3 space-y-2">
                  <label htmlFor={`edit-module-${m.module_id}-title`} className="sr-only">Module title</label>
                  <input
                    id={`edit-module-${m.module_id}-title`}
                    required
                    maxLength={200}
                    className="w-full border rounded px-3 py-1.5 text-sm"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                  />
                  <label htmlFor={`edit-module-${m.module_id}-description`} className="sr-only">Module description</label>
                  <textarea
                    id={`edit-module-${m.module_id}-description`}
                    rows="2"
                    className="w-full border rounded px-3 py-1.5 text-sm"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                  />
                  <div className="space-x-2">
                    <button type="submit" disabled={moduleBusy} className="bg-indigo-600 text-white px-3 py-1 rounded text-xs font-medium disabled:opacity-50">Save</button>
                    <button type="button" onClick={() => setEditModuleId(null)} className="text-xs text-slate-600 hover:underline">Cancel</button>
                  </div>
                </form>
              ) : (
                <div className="flex justify-between items-start gap-3 border-b pb-3">
                  <div>
                    <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded mr-2">
                      Module #{m.sequence_no}
                    </span>
                    <h3 className="text-md font-bold text-slate-900 inline-block">{m.title}</h3>
                    <p className="text-sm text-gray-600 mt-1">{m.description || 'No description provided.'}</p>
                  </div>
                  <div className="flex flex-wrap justify-end items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={moduleBusy || idx === 0}
                      onClick={() => handleMoveModule(idx, -1)}
                      title="Move up"
                      aria-label={`Move module ${m.title} up`}
                      className="text-xs border px-2 py-1 rounded hover:bg-slate-50 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={moduleBusy || idx === modules.length - 1}
                      onClick={() => handleMoveModule(idx, 1)}
                      title="Move down"
                      aria-label={`Move module ${m.title} down`}
                      className="text-xs border px-2 py-1 rounded hover:bg-slate-50 disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button type="button" onClick={() => startEditModule(m)} className="text-xs text-indigo-600 hover:underline">Edit</button>
                    <button type="button" disabled={moduleBusy} onClick={() => handleDeleteModule(m)} className="text-xs text-red-600 hover:underline disabled:opacity-50">Delete</button>
                    <button
                      type="button"
                      onClick={() => toggleContentForm(m.module_id)}
                      disabled={uploading}
                      title={uploading ? 'Cancel the upload first' : undefined}
                      className="text-xs font-semibold bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-3 py-1.5 rounded transition disabled:opacity-50"
                    >
                      {activeModuleId === m.module_id ? 'Cancel' : '+ Add Video / Media'}
                    </button>
                  </div>
                </div>
              )}

              {/* Upload Content Form (Day 12 UI) */}
              {activeModuleId === m.module_id && (
                <form
                  onSubmit={(e) => handleUploadContent(e, m.module_id)}
                  className="bg-slate-50 border rounded-lg p-4 space-y-4 text-sm"
                >
                  <h4 className="font-semibold text-slate-800">Add Content to "{m.title}"</h4>
                  {contentError && <div role="alert" className="text-red-600 text-xs bg-red-50 p-2 rounded">{contentError}</div>}
                  {contentNotice && <div role="status" className="text-slate-700 text-xs bg-slate-100 p-2 rounded">{contentNotice}</div>}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="md:col-span-2">
                      <label htmlFor="content-title" className="block text-xs font-medium text-slate-600 mb-1">Content Title</label>
                      <input
                        id="content-title"
                        type="text"
                        required
                        className="w-full border rounded px-3 py-1.5 text-sm bg-white"
                        placeholder="e.g. Video 1: Array Operations"
                        value={contentTitle}
                        onChange={(e) => setContentTitle(e.target.value)}
                      />
                    </div>
                    <div>
                      <label htmlFor="content-seq" className="block text-xs font-medium text-slate-600 mb-1">Sequence No.</label>
                      <input
                        id="content-seq"
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
                      <label htmlFor="content-type" className="block text-xs font-medium text-slate-600 mb-1">Content Type</label>
                      <select
                        id="content-type"
                        className="w-full border rounded px-3 py-1.5 text-sm bg-white"
                        value={contentType}
                        onChange={(e) => {
                          setContentType(e.target.value);
                          setFile(null); // a file picked for one type must not be sent as another
                        }}
                      >
                        <option value="video">Video (MP4, MKV, MOV, WEBM)</option>
                        <option value="pdf">Document (PDF)</option>
                        <option value="text">Text lesson</option>
                      </select>
                    </div>
                    {contentType !== 'text' && (
                      <div>
                        <label htmlFor="content-file" className="block text-xs font-medium text-slate-600 mb-1">Select File</label>
                        <input
                          id="content-file"
                          key={contentType}
                          type="file"
                          required
                          accept={contentType === 'video' ? 'video/*' : '.pdf'}
                          onChange={(e) => setFile(e.target.files[0])}
                          className="w-full text-xs text-slate-600 bg-white border rounded p-1"
                        />
                      </div>
                    )}
                  </div>

                  {contentType === 'text' && (
                    <div>
                      <label htmlFor="content-text" className="block text-xs font-medium text-slate-600 mb-1">Lesson Text</label>
                      <textarea
                        id="content-text"
                        required
                        rows="8"
                        maxLength={50000}
                        className="w-full border rounded px-3 py-2 text-sm bg-white"
                        placeholder="Write the lesson here. Line breaks are kept; formatting is plain text."
                        value={textBody}
                        onChange={(e) => setTextBody(e.target.value)}
                      />
                      <p className="text-xs text-slate-400 mt-1">{textBody.length} / 50000 characters</p>
                    </div>
                  )}

                  {contentType !== 'video' && (
                    <p className="text-xs text-slate-500">
                      Students open this in the course player and press &quot;Mark as complete&quot; to finish it.
                      It counts towards the certificate like a video does.
                    </p>
                  )}

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
                        <span>{uploadProgress >= 100 ? 'Finishing up...' : 'Uploading to the server...'}</span>
                        <span>{uploadProgress}%</span>
                      </div>
                      <div
                        role="progressbar"
                        aria-label="Upload progress"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={uploadProgress}
                        className="w-full bg-slate-200 rounded-full h-2"
                      >
                        <div
                          className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={uploading}
                      className="bg-emerald-600 text-white font-medium px-4 py-1.5 rounded text-xs hover:bg-emerald-700 disabled:opacity-50 transition"
                    >
                      {uploading ? 'Saving...' : uploadFailed || contentNotice ? 'Retry upload' : contentType === 'text' ? 'Add Lesson' : 'Upload Content'}
                    </button>
                    {uploading && (
                      <button
                        type="button"
                        onClick={cancelUpload}
                        className="text-xs font-medium text-slate-700 border border-slate-300 px-3 py-1.5 rounded hover:bg-slate-100"
                      >
                        Cancel upload
                      </button>
                    )}
                  </div>
                </form>
              )}

              {/* Module Content List (Hierarchy: Course -> Module -> Video/Content) */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Module Content
                </span>
                {!m.contents || m.contents.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No content added to this module yet.</p>
                ) : (
                  m.contents.map((c) => (
                    <div key={c.content_id} className="flex items-center justify-between gap-2 bg-slate-50 p-2.5 rounded border text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-indigo-600">#{c.sequence_no}</span>
                        <span className="font-semibold text-slate-800">{c.title}</span>
                        <span className="text-slate-400">({c.type})</span>
                      </div>
                      {isBusy(c) ? (
                        <span className="flex items-center gap-2 text-amber-800">
                          <StatusBadge status="processing" label="Processing" className="[&_svg]:animate-spin" />
                          <span>compressing &amp; preparing</span>
                        </span>
                      ) : c.status === 'error' ? (
                        <span className="flex items-center gap-2 min-w-0">
                          <StatusBadge status="error" label="Failed" />
                          <span className="text-red-700 max-w-xs truncate" title={c.error_message || 'Processing failed'}>
                            {c.error_message || 'processing failed, upload again'}
                          </span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-2 text-slate-500">
                          <StatusBadge status="ready" label="Ready" />
                          {c.duration_sec ? <span className="font-mono">{fmtDuration(c.duration_sec)}</span> : null}
                        </span>
                      )}
                      {!isBusy(c) && (
                        <button
                          type="button"
                          onClick={() => handleDeleteContent(m.module_id, c)}
                          aria-label={`Delete lesson ${c.title}`}
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