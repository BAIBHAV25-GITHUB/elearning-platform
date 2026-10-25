import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { listUsersApi, setUserStatusApi, setUserRoleApi, reviewInstructorApi } from '../../services/admin.service';
import { formatDate } from '../../utils/format';
import { useAuth } from '../../context/AuthContext';
import Pager from './Pager';
import { qk } from '../../api/queryKeys';
import { apiError } from '../../utils/apiError';
import { useConfirm } from '../../components/common/Confirm';
import StatusBadge from '../../components/common/StatusBadge';

const LIMIT = 15;

export default function Users() {
  const confirm = useConfirm();
  const { user: me } = useAuth();
  const [filters, setFilters] = useState({ search: '', role: '', status: '', instructorStatus: '' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  const list = useQuery({
    queryKey: [...qk.admin.users, { page, ...applied }],
    queryFn: () => {
      const params = { page, limit: LIMIT };
      if (applied.search.trim()) params.search = applied.search.trim();
      if (applied.role) params.role = applied.role;
      if (applied.status) params.status = applied.status;
      if (applied.instructorStatus) params.instructorStatus = applied.instructorStatus;
      return listUsersApi(params);
    },
    placeholderData: keepPreviousData, // paging / filtering keeps the old rows on screen until the new ones arrive
  });
  const data = list.data ?? { users: [], total: 0 };
  const loading = list.isPending;
  const error = actionError || (list.error ? apiError(list.error, 'Failed to load users') : '');
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.admin.users });

  const submit = (e) => {
    e.preventDefault();
    setPage(1);
    setApplied(filters);
  };

  const changeStatus = async (u, status) => {
    const verb = status === 'banned' ? 'Ban' : status === 'inactive' ? 'Deactivate' : 'Reactivate';
    if (!(await confirm({ title: `${verb} user`, message: `${verb} ${u.name} (${u.email})?`, confirmLabel: verb, danger: status !== 'active' }))) return;
    setActionError('');
    setNotice('');
    try {
      const res = await setUserStatusApi(u.id, status);
      setNotice(`${u.name}: ${res.message}`);
      await refresh();
    } catch (err) {
      setActionError(err.response?.data?.message || 'Failed to change the status');
    }
  };

  const changeRole = async (u, role) => {
    const text =
      role === 'instructor'
        ? `Make ${u.name} (${u.email}) an instructor? The account is approved right away.`
        : `Make ${u.name} (${u.email}) a student? They lose access to the instructor area.`;
    if (!(await confirm({ title: 'Change role', message: text, confirmLabel: 'Change role' }))) return;
    setActionError('');
    setNotice('');
    try {
      const res = await setUserRoleApi(u.id, role);
      setNotice(`${u.name}: ${res.message}`);
      await refresh();
    } catch (err) {
      setActionError(err.response?.data?.message || 'Failed to change the role');
    }
  };

  const review = async (u, decision) => {
    if (!(await confirm({ title: 'Review instructor', message: `${decision === 'approved' ? 'Approve' : 'Reject'} instructor ${u.name} (${u.email})?`, confirmLabel: decision === 'approved' ? 'Approve' : 'Reject', danger: decision !== 'approved' }))) return;
    setActionError('');
    setNotice('');
    try {
      const res = await reviewInstructorApi(u.id, decision);
      setNotice(`${u.name}: ${res.message}`);
      await refresh();
    } catch (err) {
      setActionError(err.response?.data?.message || 'Failed to review the instructor');
    }
  };

  return (
    <div>
      <form onSubmit={submit} className="flex flex-wrap gap-3 mb-4">
        <label htmlFor="users-search" className="sr-only">Search users</label>
        <input id="users-search"
          className="border rounded px-3 py-2 text-sm flex-1 min-w-[200px]"
          placeholder="Search name or email"
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
        />
        <label htmlFor="users-role" className="sr-only">Role</label>
        <select id="users-role"
          className="border rounded px-3 py-2 text-sm"
          value={filters.role}
          onChange={(e) => setFilters({ ...filters, role: e.target.value })}
        >
          <option value="">All roles</option>
          <option value="student">Student</option>
          <option value="instructor">Instructor</option>
          <option value="admin">Admin</option>
        </select>
        <label htmlFor="users-approval" className="sr-only">Instructor approval</label>
        <select id="users-approval"
          className="border rounded px-3 py-2 text-sm"
          value={filters.instructorStatus}
          onChange={(e) => setFilters({ ...filters, instructorStatus: e.target.value })}
        >
          <option value="">Any approval</option>
          <option value="pending">Pending approval</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <label htmlFor="users-status" className="sr-only">Account status</label>
        <select id="users-status"
          className="border rounded px-3 py-2 text-sm"
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="banned">Banned</option>
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
              <th className="py-3 px-4">Name</th>
              <th className="py-3 px-4">Email</th>
              <th className="py-3 px-4">Role</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Joined</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm">
            {loading ? (
              <tr><td colSpan={6} className="py-8 text-center text-slate-500">Loading...</td></tr>
            ) : data.users.length === 0 ? (
              <tr><td colSpan={6} className="py-8 text-center text-slate-500">No users match.</td></tr>
            ) : (
              data.users.map((u) => {
                const locked = u.role === 'admin' || u.id === me?.id; // the server enforces this too
                return (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-medium text-slate-800">{u.name}</td>
                    <td className="py-3 px-4 text-slate-600">{u.email}</td>
                    <td className="py-3 px-4 capitalize text-slate-600">
                      {u.role}
                      {u.role === 'instructor' && u.instructorStatus && (
                        <StatusBadge status={u.instructorStatus} className="ml-2" />
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge status={u.status} />
                    </td>
                    <td className="py-3 px-4 text-slate-600">{formatDate(u.createdAt)}</td>
                    <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                      {locked ? (
                        <span className="text-xs text-slate-400">protected</span>
                      ) : (
                        <>
                          {u.role === 'instructor' && u.instructorStatus !== 'approved' && (
                            <button onClick={() => review(u, 'approved')} className="text-emerald-700 text-xs font-semibold hover:underline">
                              Approve
                            </button>
                          )}
                          {u.role === 'instructor' && u.instructorStatus === 'pending' && (
                            <button onClick={() => review(u, 'rejected')} className="text-red-600 text-xs font-semibold hover:underline">
                              Reject
                            </button>
                          )}
                          {u.role === 'student' && (
                            <button onClick={() => changeRole(u, 'instructor')} className="text-indigo-600 text-xs font-semibold hover:underline">
                              Make instructor
                            </button>
                          )}
                          {u.role === 'instructor' && (
                            <button onClick={() => changeRole(u, 'student')} className="text-indigo-600 text-xs font-semibold hover:underline">
                              Make student
                            </button>
                          )}
                          {u.status !== 'active' && (
                            <button onClick={() => changeStatus(u, 'active')} className="text-emerald-700 text-xs font-semibold hover:underline">
                              Reactivate
                            </button>
                          )}
                          {u.status === 'active' && (
                            <button onClick={() => changeStatus(u, 'inactive')} className="text-amber-700 text-xs font-semibold hover:underline">
                              Deactivate
                            </button>
                          )}
                          {u.status !== 'banned' && (
                            <button onClick={() => changeStatus(u, 'banned')} className="text-red-600 text-xs font-semibold hover:underline">
                              Ban
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <Pager page={page} limit={LIMIT} total={data.total} onPage={setPage} />
    </div>
  );
}
