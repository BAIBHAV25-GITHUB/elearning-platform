import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { listAdminCoursesApi, setAdminCourseStatusApi, listUsersApi, reassignCourseApi } from '../../services/admin.service';
import { formatDate, formatPrice } from '../../utils/format';
import Pager from './Pager';
import { qk } from '../../api/queryKeys';
import { apiError } from '../../utils/apiError';
import StatusBadge from '../../components/common/StatusBadge';
import Modal from '../../components/common/Modal';
import { useConfirm } from '../../components/common/Confirm';

const LIMIT = 15;

export default function Courses() {
  const confirm = useConfirm();
  const [filters, setFilters] = useState({ search: '', status: '' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [reassign, setReassign] = useState(null); // { course, instructors, choice, saving, error }

  const list = useQuery({
    queryKey: [...qk.admin.courses, { page, ...applied }],
    queryFn: () => {
      const params = { page, limit: LIMIT };
      if (applied.search.trim()) params.search = applied.search.trim();
      if (applied.status) params.status = applied.status;
      return listAdminCoursesApi(params);
    },
    placeholderData: keepPreviousData, // paging / filtering keeps the old rows on screen until the new ones arrive
  });
  const data = list.data ?? { courses: [], total: 0 };
  const loading = list.isPending;
  const error = actionError || (list.error ? apiError(list.error, 'Failed to load courses') : '');
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.admin.courses });

  const submit = (e) => {
    e.preventDefault();
    setPage(1);
    setApplied(filters);
  };

  const changeStatus = async (c, status, confirmText) => {
    if (confirmText && !(await confirm({ title: 'Please confirm', message: confirmText }))) return;
    setActionError('');
    setNotice('');
    try {
      const res = await setAdminCourseStatusApi(c.course_id, status);
      setNotice(`"${c.title}": ${res.message}`);
      await refresh();
    } catch (err) {
      setActionError(err.response?.data?.message || 'Failed to change the course status');
    }
  };

  const openReassign = async (course) => {
    setActionError('');
    setNotice('');
    try {
      const res = await listUsersApi({ role: 'instructor', instructorStatus: 'approved', status: 'active', limit: 100 });
      const instructors = res.users.filter((i) => i.id !== course.instructor_id);
      setReassign({ course, instructors, choice: instructors[0]?.id ?? '', saving: false, error: '' });
    } catch (err) {
      setActionError(err.response?.data?.message || 'Failed to load instructors');
    }
  };

  const confirmReassign = async () => {
    if (!reassign.choice) return;
    setReassign((r) => ({ ...r, saving: true, error: '' }));
    try {
      const res = await reassignCourseApi(reassign.course.course_id, Number(reassign.choice));
      setNotice(`"${reassign.course.title}": ${res.message}`);
      await refresh();
      setReassign(null);
    } catch (err) {
      setReassign((r) => ({ ...r, saving: false, error: err.response?.data?.message || 'Failed to reassign the course' }));
    }
  };

  return (
    <div>
      {reassign && (
        <Modal title="Reassign course" onClose={() => setReassign(null)} busy={reassign.saving}>
            <p className="text-sm text-slate-600 mb-4">
              &quot;{reassign.course.title}&quot; currently belongs to {reassign.course.instructor_name}. Students, batches and
              progress stay as they are.
            </p>
            {reassign.error && <div className="bg-red-50 text-red-600 p-3 rounded mb-3 text-sm">{reassign.error}</div>}
            {reassign.instructors.length === 0 ? (
              <p className="text-sm text-slate-500 mb-4">There is no other active, approved instructor to give the course to.</p>
            ) : (
              <>
                <label htmlFor="reassign-instructor" className="sr-only">New instructor</label>
                <select
                  id="reassign-instructor"
                  className="w-full border rounded px-3 py-2 text-sm mb-4"
                  value={reassign.choice}
                  onChange={(e) => setReassign((r) => ({ ...r, choice: e.target.value }))}
                >
                  {reassign.instructors.map((i) => (
                    <option key={i.id} value={i.id}>{i.name} ({i.email})</option>
                  ))}
                </select>
              </>
            )}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setReassign(null)} className="px-4 py-2 text-sm rounded border">Cancel</button>
              <button
                onClick={confirmReassign}
                disabled={reassign.saving || !reassign.choice}
                className="px-4 py-2 text-sm rounded bg-indigo-600 text-white font-semibold disabled:opacity-50"
              >
                {reassign.saving ? 'Saving...' : 'Reassign'}
              </button>
            </div>
        </Modal>
      )}
      <form onSubmit={submit} className="flex flex-wrap gap-3 mb-4">
        <label htmlFor="courses-search" className="sr-only">Search courses</label>
        <input id="courses-search"
          className="border rounded px-3 py-2 text-sm flex-1 min-w-[200px]"
          placeholder="Search course title or instructor"
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
        />
        <label htmlFor="courses-status" className="sr-only">Status</label>
        <select id="courses-status"
          className="border rounded px-3 py-2 text-sm"
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
        >
          <option value="">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </select>
        <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded text-sm font-semibold hover:bg-indigo-700">
          Filter
        </button>
      </form>

      {error && <div className="bg-red-50 text-red-600 p-3 rounded mb-3 text-sm">{error}</div>}
      {notice && <div className="bg-emerald-50 text-emerald-700 p-3 rounded mb-3 text-sm">{notice}</div>}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase">
              <th className="py-3 px-4">Course</th>
              <th className="py-3 px-4">Instructor</th>
              <th className="py-3 px-4">Price</th>
              <th className="py-3 px-4">Students</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Created</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm">
            {loading ? (
              <tr><td colSpan={7} className="py-8 text-center text-slate-500">Loading...</td></tr>
            ) : data.courses.length === 0 ? (
              <tr><td colSpan={7} className="py-8 text-center text-slate-500">No courses match.</td></tr>
            ) : (
              data.courses.map((c) => (
                <tr key={c.course_id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-medium text-slate-800">{c.title}</td>
                  <td className="py-3 px-4 text-slate-600">
                    {c.instructor_name}
                    <div className="text-xs text-slate-400">{c.instructor_email}</div>
                  </td>
                  <td className="py-3 px-4 text-slate-600">{formatPrice(c.price)}</td>
                  <td className="py-3 px-4 text-slate-600">{c.enrollment_count}</td>
                  <td className="py-3 px-4">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="py-3 px-4 text-slate-600">{formatDate(c.created_at)}</td>
                  <td className="py-3 px-4 text-right space-x-3 whitespace-nowrap">
                    <Link to={`/instructor/courses/${c.course_id}/edit`} className="text-indigo-600 text-xs font-semibold hover:underline">
                      Manage
                    </Link>
                    <button onClick={() => openReassign(c)} className="text-indigo-600 text-xs font-semibold hover:underline">
                      Reassign
                    </button>
                    {c.status === 'published' && (
                      <button
                        onClick={() => changeStatus(c, 'archived', `Archive "${c.title}"? It disappears from the catalog; enrolled students keep access.`)}
                        className="text-amber-700 text-xs font-semibold hover:underline"
                      >
                        Archive
                      </button>
                    )}
                    {c.status === 'published' && c.enrollment_count === 0 && (
                      <button
                        onClick={() => changeStatus(c, 'draft', `Unpublish "${c.title}" back to draft?`)}
                        className="text-slate-700 text-xs font-semibold hover:underline"
                      >
                        Unpublish
                      </button>
                    )}
                    {c.status === 'archived' && (
                      <button
                        onClick={() => changeStatus(c, 'published', `Restore "${c.title}" to the catalog?`)}
                        className="text-emerald-700 text-xs font-semibold hover:underline"
                      >
                        Restore
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pager page={page} limit={LIMIT} total={data.total} onPage={setPage} />
    </div>
  );
}
