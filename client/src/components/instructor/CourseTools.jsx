import { useState } from 'react';
import api from '../../api/axios';

// Batch creation + announcements for one course (F21). Both endpoints are owner-only on the server.
export default function CourseTools({ courseId, onBatchCreated }) {
  const [batch, setBatch] = useState({ batchName: '', startDate: '', endDate: '', maxCapacity: 30 });
  const [ann, setAnn] = useState({ title: '', content: '' });
  const [msg, setMsg] = useState({ type: '', text: '' });

  const run = async (fn, okText, reset) => {
    setMsg({ type: '', text: '' });
    try {
      await fn();
      setMsg({ type: 'ok', text: okText });
      reset();
    } catch (err) {
      setMsg({ type: 'err', text: err.response?.data?.message || 'Request failed' });
    }
  };

  const input = 'w-full border rounded px-3 py-1.5 text-sm';

  return (
    <div className="grid md:grid-cols-2 gap-6 mb-8">
      {msg.text && (
        <div className={`md:col-span-2 p-3 rounded text-sm ${msg.type === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
          {msg.text}
        </div>
      )}
      <form
        className="bg-white p-5 rounded-lg border shadow-sm space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => api.post(`/courses/${courseId}/batches`, { ...batch, maxCapacity: Number(batch.maxCapacity) }),
            'Batch created.',
            () => {
              setBatch({ batchName: '', startDate: '', endDate: '', maxCapacity: 30 });
              onBatchCreated?.();
            }
          );
        }}
      >
        <h2 className="font-semibold text-slate-800">Create Batch</h2>
        <input required className={input} placeholder="Batch name" value={batch.batchName} onChange={(e) => setBatch({ ...batch, batchName: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <input required type="date" className={input} value={batch.startDate} onChange={(e) => setBatch({ ...batch, startDate: e.target.value })} />
          <input required type="date" className={input} value={batch.endDate} onChange={(e) => setBatch({ ...batch, endDate: e.target.value })} />
        </div>
        <input required type="number" min="1" max="30" className={input} value={batch.maxCapacity} onChange={(e) => setBatch({ ...batch, maxCapacity: e.target.value })} />
        <button className="bg-indigo-600 text-white px-4 py-1.5 rounded text-sm font-medium">+ Add Batch</button>
      </form>

      <form
        className="bg-white p-5 rounded-lg border shadow-sm space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => api.post(`/courses/${courseId}/announcements`, ann), 'Announcement sent to enrolled students.', () => setAnn({ title: '', content: '' }));
        }}
      >
        <h2 className="font-semibold text-slate-800">Post Announcement</h2>
        <input required className={input} placeholder="Title" value={ann.title} onChange={(e) => setAnn({ ...ann, title: e.target.value })} />
        <textarea required rows="3" className={input} placeholder="Message to all enrolled students" value={ann.content} onChange={(e) => setAnn({ ...ann, content: e.target.value })} />
        <button className="bg-indigo-600 text-white px-4 py-1.5 rounded text-sm font-medium">Send</button>
      </form>
    </div>
  );
}
