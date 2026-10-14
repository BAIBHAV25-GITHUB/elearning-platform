import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/axios';
import { formatDate } from '../../utils/format';

const STATUS_STYLE = {
  active: 'bg-emerald-100 text-emerald-700',
  completed: 'bg-indigo-100 text-indigo-700',
  pending: 'bg-yellow-100 text-yellow-800',
  dropped: 'bg-slate-100 text-slate-500',
};

export default function MyLearning() {
  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const res = await api.get('/enrollments/me');
      setEnrollments(res.data.enrollments || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load your courses');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleDrop = async (id) => {
    if (!window.confirm('Drop this enrollment? Your seat will be released.')) return;
    setError('');
    try {
      await api.post(`/enrollments/${id}/drop`, { reason: 'Dropped by student' });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not drop enrollment');
    }
  };

  if (loading) return <div className="text-center py-20 text-slate-600">Loading your courses...</div>;

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-bold text-slate-800 mb-6">My Learning</h1>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">{error}</div>}
      {enrollments.length === 0 ? (
        <div className="p-12 text-center bg-white border rounded-xl text-slate-500">
          You are not enrolled in any course yet. <Link className="text-indigo-600 font-semibold" to="/">Browse courses</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {enrollments.map((e) => (
            <div key={e.enrollment_id} className="bg-white border rounded-xl p-4 flex items-center justify-between gap-4">
              <div>
                <div className="font-semibold text-slate-800">{e.course_title}</div>
                <div className="text-xs text-slate-500 mt-1">
                  {e.batch_name} · {formatDate(e.start_date)} – {formatDate(e.end_date)}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-1 rounded font-semibold capitalize ${STATUS_STYLE[e.enrollment_status] || ''}`}>
                  {e.enrollment_status}
                </span>
                {['active', 'completed'].includes(e.enrollment_status) && (
                  <Link to={`/learn/${e.course_id}`} className="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-semibold">
                    Continue
                  </Link>
                )}
                {e.enrollment_status === 'pending' && (
                  <Link to={`/courses/${e.course_id}`} className="text-sm text-indigo-600 font-semibold">Finish payment</Link>
                )}
                {['pending', 'active'].includes(e.enrollment_status) && (
                  <button onClick={() => handleDrop(e.enrollment_id)} className="text-sm text-red-600 hover:underline">Drop</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
