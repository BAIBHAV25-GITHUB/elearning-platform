import { useEffect, useState } from 'react';
import api from '../../api/axios';

export default function Analytics() {
  const [data, setData] = useState({ batchCapacity: [], studentProgress: [], courseRevenue: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const res = await api.get('/analytics/overview');
        if (res.data.success) {
          setData(res.data.data);
        }
      } catch (err) {
        console.error('Failed to load analytics:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, []);

  if (loading) return <div className="text-center py-20 text-slate-600">Loading analytics dashboard...</div>;

  return (
    <div className="max-w-7xl mx-auto px-6 py-10 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-800">Instructor Analytics</h1>
        <p className="text-slate-600 mt-1">Real-time performance metrics across courses, batches, and enrollment progress.</p>
      </div>

      {/* Revenue Section */}
      <section className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 mb-4">💰 Course Revenue (vw_course_revenue)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase">
                <th className="py-3 px-4">Course Title</th>
                <th className="py-3 px-4">Total Enrollments</th>
                <th className="py-3 px-4">Total Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {data.courseRevenue.map((row, idx) => (
                <tr key={row.course_id || idx} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-medium text-slate-800">{row.title || row.course_title}</td>
                  <td className="py-3 px-4 text-slate-600">{row.total_enrollments || row.enrollment_count || 0}</td>
                  <td className="py-3 px-4 font-bold text-emerald-600">₹{Number(row.total_revenue || 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Batch Capacity Section */}
      <section className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 mb-4">📊 Batch Capacity Status (vw_batch_capacity)</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.batchCapacity.map((batch, idx) => {
            const filledPercent = Math.min(100, Math.round(((batch.current_capacity || 0) / (batch.max_capacity || 1)) * 100));
            return (
              <div key={batch.batch_id || idx} className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                <div className="flex justify-between items-center text-sm font-bold text-slate-800">
                  <span>{batch.batch_name || `Batch #${batch.batch_id}`}</span>
                  <span className={`text-xs px-2 py-0.5 rounded font-semibold ${batch.is_full ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {batch.is_full ? 'FULL' : 'OPEN'}
                  </span>
                </div>
                <div className="text-xs text-slate-500">Seats: {batch.current_capacity || 0} / {batch.max_capacity}</div>
                <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                  <div className={`h-full transition-all duration-300 ${batch.is_full ? 'bg-red-500' : 'bg-indigo-600'}`} style={{ width: `${filledPercent}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Student Progress View */}
      <section className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 mb-4">🎓 Student Progress Overview (vw_student_progress)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase">
                <th className="py-3 px-4">Student</th>
                <th className="py-3 px-4">Course</th>
                <th className="py-3 px-4">Completed Items</th>
                <th className="py-3 px-4">Completion %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {data.studentProgress.map((prog, idx) => (
                <tr key={idx} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-medium text-slate-800">{prog.user_name || prog.student_name}</td>
                  <td className="py-3 px-4 text-slate-600">{prog.course_title || prog.title}</td>
                  <td className="py-3 px-4 text-slate-600">{prog.completed_count || 0} / {prog.total_contents || 0}</td>
                  <td className="py-3 px-4 font-semibold text-indigo-600">{Math.round(prog.completion_percentage || 0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}