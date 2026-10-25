import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getOverviewApi } from '../../services/admin.service';
import { formatMoney } from '../../utils/format';
import { qk } from '../../api/queryKeys';
import { apiError } from '../../utils/apiError';

function Stat({ label, value, hint, tone = 'text-slate-800' }) {
  return (
    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
      <div className="text-xs font-semibold uppercase text-slate-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${tone}`}>{value}</div>
      {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}

export default function Dashboard() {
  const { data, error } = useQuery({ queryKey: qk.admin.overview, queryFn: getOverviewApi });

  if (error) return <div role="alert" className="bg-red-50 text-red-600 p-3 rounded text-sm">{apiError(error, 'Failed to load the overview')}</div>;
  if (!data) return <div className="py-10 text-center text-slate-600">Loading overview...</div>;

  const o = data.overview;
  return (
    <div className="space-y-8">
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Users" value={o.users_total} hint={`${o.students} students · ${o.instructors} instructors`} />
        <Stat
          label="Not active"
          value={o.inactive_or_banned}
          hint="Inactive or banned accounts"
          tone={o.inactive_or_banned ? 'text-amber-600' : 'text-slate-800'}
        />
        <Stat
          label="Courses"
          value={o.courses_total}
          hint={`${o.courses_published} published · ${o.courses_draft} draft · ${o.courses_archived} archived`}
        />
        <Stat label="Active enrollments" value={o.enrollments_active} hint={`${o.enrollments_completed} completed`} />
        <Stat label="Revenue" value={formatMoney(o.revenue_total)} tone="text-emerald-600" />
        <Stat label="Certificates" value={o.certificates_issued} />
        <Stat
          label="Failed payments"
          value={o.payments_failed}
          tone={o.payments_failed ? 'text-red-600' : 'text-slate-800'}
        />
        <Stat label="Pending payments" value={o.payments_pending} />
        <Stat
          label="Needs refund"
          value={o.payments_needs_refund}
          hint={`${o.payments_refunded} refunded so far`}
          tone={o.payments_needs_refund ? 'text-red-600' : 'text-slate-800'}
        />
      </section>

      <section className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 mb-4">Top courses by revenue</h2>
        {data.topCourses.length === 0 ? (
          <p className="text-sm text-slate-500">No courses yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase">
                  <th className="py-3 px-4">Course</th>
                  <th className="py-3 px-4">Instructor</th>
                  <th className="py-3 px-4">Enrollments</th>
                  <th className="py-3 px-4">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {data.topCourses.map((c) => (
                  <tr key={c.course_id}>
                    <td className="py-3 px-4 font-medium text-slate-800">{c.course_title}</td>
                    <td className="py-3 px-4 text-slate-600">{c.instructor_name}</td>
                    <td className="py-3 px-4 text-slate-600">{c.total_enrollments}</td>
                    <td className="py-3 px-4 font-bold text-emerald-600">{formatMoney(c.total_revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-slate-500 mt-4">
          Per-batch capacity and student progress for the whole platform are on the{' '}
          <Link to="/instructor/analytics" className="text-indigo-600 font-medium">Analytics</Link> page.
        </p>
      </section>
    </div>
  );
}
