import { useEffect, useState } from 'react';
import { getCourseBatchesApi, updateBatchApi } from '../../services/course.service';
import { useConfirm } from '../../components/common/Confirm';
import StatusBadge from '../common/StatusBadge';

// Lists the batches of one course; edit (name, dates, capacity) and close / reopen. Owner-only on the server.
// `refreshKey` changes when a batch is created elsewhere, so the list reloads.
export default function BatchManager({ courseId, refreshKey = 0 }) {
  const confirm = useConfirm();
  const [batches, setBatches] = useState([]);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    getCourseBatchesApi(courseId)
      .then((d) => alive && setBatches(d.batches || []))
      .catch((err) => alive && setError(err.response?.data?.message || 'Failed to load batches'));
    return () => {
      alive = false;
    };
  }, [courseId, refreshKey]);

  const save = async (batchId, patch, onDone) => {
    setError('');
    try {
      const { batch } = await updateBatchApi(courseId, batchId, patch);
      setBatches((prev) => prev.map((b) => (b.batch_id === batchId ? batch : b)));
      onDone?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update the batch');
    }
  };

  const startEdit = (b) => {
    setError('');
    setEditId(b.batch_id);
    setForm({ batchName: b.batch_name, startDate: b.start_date, endDate: b.end_date, maxCapacity: b.max_capacity });
  };

  const toggleClose = async (b) => {
    if (b.status !== 'closed' && !(await confirm({ title: 'Close batch', message: `Close "${b.batch_name}"? No new students can join. Students already in it keep their access.`, confirmLabel: 'Close batch' }))) return;
    save(b.batch_id, { status: b.status === 'closed' ? 'open' : 'closed' });
  };

  const input = 'border rounded px-2 py-1 text-sm';

  return (
    <div className="bg-white p-5 rounded-lg border shadow-sm mb-8">
      <h2 className="font-semibold text-slate-800 mb-3">Batches ({batches.length})</h2>
      {error && <div className="bg-red-50 text-red-600 p-2 rounded mb-3 text-sm">{error}</div>}
      {batches.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No batches yet. Create one above.</p>
      ) : (
        <div className="space-y-2">
          {batches.map((b) =>
            editId === b.batch_id ? (
              <form
                key={b.batch_id}
                className="border rounded p-3 bg-slate-50 space-y-2"
                aria-label={`Edit batch ${b.batch_name}`}
                onKeyDown={(e) => e.key === 'Escape' && setEditId(null)}
                onSubmit={(e) => {
                  e.preventDefault();
                  save(
                    b.batch_id,
                    { batchName: form.batchName, startDate: form.startDate, endDate: form.endDate, maxCapacity: Number(form.maxCapacity) },
                    () => setEditId(null)
                  );
                }}
              >
                <label htmlFor={`batch-${b.batch_id}-name`} className="sr-only">Batch name</label>
                <input id={`batch-${b.batch_id}-name`} required className={`${input} w-full`} value={form.batchName} onChange={(e) => setForm({ ...form, batchName: e.target.value })} />
                <div className="flex flex-wrap gap-2 items-center">
                  <label htmlFor={`batch-${b.batch_id}-start`} className="sr-only">Start date</label>
                  <input id={`batch-${b.batch_id}-start`} required type="date" className={input} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                  <label htmlFor={`batch-${b.batch_id}-end`} className="sr-only">End date</label>
                  <input id={`batch-${b.batch_id}-end`} required type="date" className={input} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
                  <label htmlFor={`batch-${b.batch_id}-seats`} className="text-xs text-slate-600 flex items-center gap-1">
                    Seats
                    <input id={`batch-${b.batch_id}-seats`} required type="number" min={Math.max(1, b.current_capacity)} max="30" className={`${input} w-20`} value={form.maxCapacity} onChange={(e) => setForm({ ...form, maxCapacity: e.target.value })} />
                  </label>
                </div>
                <div className="space-x-2">
                  <button type="submit" className="bg-indigo-600 text-white px-3 py-1 rounded text-xs font-medium">Save</button>
                  <button type="button" onClick={() => setEditId(null)} className="text-xs text-slate-600 hover:underline">Cancel</button>
                </div>
              </form>
            ) : (
              <div key={b.batch_id} className="flex flex-wrap items-center justify-between gap-2 border rounded p-3 text-sm">
                <div>
                  <span className="font-semibold text-slate-800">{b.batch_name}</span>
                  <StatusBadge status={b.status} className="ml-2" />
                  <div className="text-xs text-slate-500 mt-0.5">
                    {b.start_date} to {b.end_date} · {b.current_capacity}/{b.max_capacity} seats taken
                  </div>
                </div>
                <div className="space-x-3 text-xs">
                  <button type="button" onClick={() => startEdit(b)} aria-label={`Edit batch ${b.batch_name}`} className="text-indigo-600 hover:underline">Edit</button>
                  <button type="button" onClick={() => toggleClose(b)} aria-label={`${b.status === 'closed' ? 'Reopen' : 'Close'} batch ${b.batch_name}`} className={b.status === 'closed' ? 'text-emerald-700 hover:underline' : 'text-red-600 hover:underline'}>
                    {b.status === 'closed' ? 'Reopen' : 'Close'}
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
