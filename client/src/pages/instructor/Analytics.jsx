import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import api from '../../api/axios';
import { qk } from '../../api/queryKeys';
import { apiError } from '../../utils/apiError';
import { formatMoney } from '../../utils/format';
import { useAuth } from '../../context/AuthContext';
import { LoadingState, ErrorState } from '../../components/common/States';
import StatusBadge from '../../components/common/StatusBadge';
import { RevenueChart, SeatsChart, CompletionChart, RevenueTimelineChart, EnrollmentsTimelineChart } from '../../components/charts/AnalyticsCharts';
import { revenueByCourse, seatsByBatch, completionBuckets, summary, monthlyTimeline, timelineIsEmpty } from '../../utils/analytics';

function Kpi({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-800">{value}</div>
    </div>
  );
}

const EMPTY_OVERVIEW = { batchCapacity: [], studentProgress: [], courseRevenue: [] };
const selectTimeline = (rows) => monthlyTimeline(rows);

export default function Analytics() {
  const { user } = useAuth();
  const [months, setMonths] = useState(12);

  const overview = useQuery({
    queryKey: qk.analytics.overview,
    queryFn: async () => {
      const res = await api.get('/analytics/overview');
      return res.data.success ? res.data.data : EMPTY_OVERVIEW;
    },
  });

  // revenue / enrollments per month: its own query, so a failure here never hides the rest of the page.
  // keepPreviousData: changing the range keeps showing the old chart until the new one arrives.
  const timelineQuery = useQuery({
    queryKey: qk.analytics.timeline(months),
    queryFn: async () => {
      const res = await api.get('/analytics/timeline', { params: { months } });
      return res.data.success ? res.data.data.months : [];
    },
    select: selectTimeline,
    placeholderData: keepPreviousData,
  });
  const timeline = timelineQuery.data ?? [];

  if (overview.isPending) return <LoadingState label="Loading analytics dashboard..." />;
  if (overview.error) return <ErrorState message={apiError(overview.error, 'Failed to load analytics.')} onRetry={overview.refetch} />;
  const data = overview.data;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-800">{user?.role === 'admin' ? 'Platform Analytics' : 'Instructor Analytics'}</h1>
        <p className="text-slate-600 mt-1">Real-time performance metrics across courses, batches, and enrollment progress.</p>
      </div>

      {/* Headline numbers */}
      {(() => {
        const k = summary(data);
        return (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi label="Revenue" value={formatMoney(k.revenue)} />
            <Kpi label="Enrollments" value={k.enrollments} />
            <Kpi label="Avg. completion" value={`${k.avg}%`} />
            <Kpi label="Courses completed" value={`${k.completed} / ${k.learners}`} />
          </div>
        );
      })()}

      {/* Revenue and enrollments over time */}
      <section className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm" aria-labelledby="timeline-heading">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="timeline-heading" className="text-lg font-bold text-slate-800">📈 Revenue &amp; enrollments over time</h2>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="timeline-months" className="text-slate-600">Show</label>
            <select
              id="timeline-months"
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-700"
            >
              <option value={6}>last 6 months</option>
              <option value={12}>last 12 months</option>
              <option value={24}>last 24 months</option>
            </select>
          </div>
        </div>
        {timelineQuery.error ? (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <span>{apiError(timelineQuery.error, 'Failed to load the monthly figures.')}</span>
            <button type="button" onClick={() => timelineQuery.refetch()} className="rounded border border-red-300 px-3 py-1 font-semibold hover:bg-red-100">Try again</button>
          </div>
        ) : timelineQuery.isPending ? (
          <p role="status" className="py-10 text-center text-sm text-slate-500">Loading monthly figures...</p>
        ) : timelineIsEmpty(timeline) ? (
          <p className="py-10 text-center text-sm italic text-slate-400">No payments or enrollments in this period yet.</p>
        ) : (
          <div className="space-y-6" aria-busy={timelineQuery.isPlaceholderData}>
            <div>
              <h3 className="mb-1 text-sm font-semibold text-slate-600">Revenue per month</h3>
              <p className="mb-2 text-xs text-slate-500">Refunded payments are subtracted: the green bar is what you kept, the red part was refunded.</p>
              <RevenueTimelineChart data={timeline} />
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold text-slate-600">New enrollments per month</h3>
              <EnrollmentsTimelineChart data={timeline} />
            </div>
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold text-indigo-700">View the monthly figures as a table</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase">
                      <th scope="col" className="py-2 px-3">Month</th>
                      <th scope="col" className="py-2 px-3">Enrollments</th>
                      <th scope="col" className="py-2 px-3">Gross</th>
                      <th scope="col" className="py-2 px-3">Refunded</th>
                      <th scope="col" className="py-2 px-3">Net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {timeline.map((m) => (
                      <tr key={m.month}>
                        <th scope="row" className="py-2 px-3 font-medium text-slate-800">{m.label}</th>
                        <td className="py-2 px-3 text-slate-600">{m.enrollments}</td>
                        <td className="py-2 px-3 text-slate-600">{formatMoney(m.gross)}</td>
                        <td className="py-2 px-3 text-slate-600">{formatMoney(m.refunded)}</td>
                        <td className="py-2 px-3 font-semibold text-emerald-600">{formatMoney(m.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        )}
      </section>

      {/* Revenue Section */}
      <section className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 mb-4">💰 Course Revenue</h2>
        <RevenueChart data={revenueByCourse(data.courseRevenue)} />
        <h3 className="sr-only">Revenue table</h3>
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
                  <td className="py-3 px-4 font-medium text-slate-800">{row.course_title}</td>
                  <td className="py-3 px-4 text-slate-600">{row.total_enrollments || 0}</td>
                  <td className="py-3 px-4 font-bold text-emerald-600">{formatMoney(row.total_revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Batch Capacity Section */}
      <section className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 mb-4">📊 Batch Capacity Status</h2>
        <div className="mb-6"><SeatsChart data={seatsByBatch(data.batchCapacity)} /></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.batchCapacity.map((batch, idx) => {
            const filledPercent = Math.min(100, Math.round(((batch.current_capacity || 0) / (batch.max_capacity || 1)) * 100));
            return (
              <div key={batch.batch_id || idx} className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                <div className="flex justify-between items-center text-sm font-bold text-slate-800">
                  <span>{batch.batch_name || `Batch #${batch.batch_id}`} <span className="font-normal text-slate-500">· {batch.course_title}</span></span>
                  <StatusBadge status={batch.is_full ? 'full' : batch.batch_status || 'open'} />
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
        <h2 className="text-lg font-bold text-slate-800 mb-4">🎓 Student Progress Overview</h2>
        <div className="mb-6"><CompletionChart data={completionBuckets(data.studentProgress)} /></div>
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
                  <td className="py-3 px-4 font-medium text-slate-800">{prog.student_name}</td>
                  <td className="py-3 px-4 text-slate-600">{prog.course_title}</td>
                  <td className="py-3 px-4 text-slate-600">{prog.completed_contents || 0} / {prog.total_contents || 0}</td>
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