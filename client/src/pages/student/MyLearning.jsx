import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../../api/axios';
import { qk } from '../../api/queryKeys';
import { apiError } from '../../utils/apiError';
import { formatDate } from '../../utils/format';
import { useConfirm } from '../../components/common/Confirm';
import StatusBadge from '../../components/common/StatusBadge';

export default function MyLearning() {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState('');

  const { data: enrollments = [], isPending, error: loadError } = useQuery({
    queryKey: qk.enrollments,
    queryFn: async () => (await api.get('/enrollments/me')).data.enrollments || [],
  });

  const drop = useMutation({
    mutationFn: (id) => api.post(`/enrollments/${id}/drop`, { reason: 'Dropped by student' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.enrollments }),
    onError: (err) => setActionError(apiError(err, 'Could not drop enrollment')),
  });

  const handleDrop = async (id) => {
    if (!(await confirm({ title: 'Drop enrollment', message: 'Drop this enrollment? Your seat will be released and you lose access to the course. If you already paid, dropping does NOT refund you automatically; contact support to request one.', confirmLabel: 'Drop enrollment', danger: true }))) return;
    setActionError('');
    drop.mutate(id);
  };

  const error = actionError || (loadError ? apiError(loadError, 'Failed to load your courses') : '');

  if (isPending) return <div className="text-center py-20 text-slate-600">Loading your courses...</div>;

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
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-800">{e.course_title}</div>
                <div className="text-xs text-slate-500 mt-1">
                  {e.batch_name} · {formatDate(e.start_date)} – {formatDate(e.end_date)}
                </div>
                {['active', 'completed'].includes(e.enrollment_status) && e.total_lessons > 0 && (
                  <div className="mt-2 max-w-sm">
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500"
                        style={{ width: `${Math.round((e.completed_lessons / e.total_lessons) * 100)}%` }}
                      />
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {e.completed_lessons} of {e.total_lessons} lessons · {Math.round((e.completed_lessons / e.total_lessons) * 100)}%
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={e.enrollment_status} />
                {['active', 'completed'].includes(e.enrollment_status) && (
                  <Link to={`/learn/${e.course_id}`} className="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-semibold">
                    {e.enrollment_status === 'completed' ? 'Review' : e.completed_lessons > 0 ? 'Resume' : 'Start'}
                  </Link>
                )}
                {e.enrollment_status === 'pending' && (
                  <Link to={`/courses/${e.course_id}`} className="text-sm text-indigo-600 font-semibold">Finish payment</Link>
                )}
                {['pending', 'active'].includes(e.enrollment_status) && (
                  <button onClick={() => handleDrop(e.enrollment_id)} disabled={drop.isPending} className="text-sm text-red-600 hover:underline disabled:opacity-50">Drop</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
