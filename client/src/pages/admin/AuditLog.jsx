import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { listAuditLogsApi } from '../../services/admin.service';
import Pager from './Pager';
import { qk } from '../../api/queryKeys';
import { apiError } from '../../utils/apiError';
import StatusBadge from '../../components/common/StatusBadge';

const LIMIT = 25;

const short = (v) => (v ? JSON.stringify(v) : '—');

export default function AuditLog() {
  const [filters, setFilters] = useState({ table: '', action: '' });
  const [page, setPage] = useState(1);

  const list = useQuery({
    queryKey: [...qk.admin.auditLogs, { page, ...filters }],
    queryFn: () => {
      const params = { page, limit: LIMIT };
      if (filters.table) params.table = filters.table;
      if (filters.action) params.action = filters.action;
      return listAuditLogsApi(params);
    },
    placeholderData: keepPreviousData, // paging / filtering keeps the old rows on screen until the new ones arrive
  });
  const data = list.data ?? { logs: [], total: 0 };
  const loading = list.isPending;
  const error = list.error ? apiError(list.error, 'Failed to load the audit log') : '';

  const update = (patch) => {
    setPage(1);
    setFilters((f) => ({ ...f, ...patch }));
  };

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4">
        <label htmlFor="audit-table" className="sr-only">Table</label>
        <select id="audit-table" className="border rounded px-3 py-2 text-sm" value={filters.table} onChange={(e) => update({ table: e.target.value })}>
          <option value="">All tables</option>
          <option value="courses">courses</option>
          <option value="enrollments">enrollments</option>
          <option value="users">users</option>
          <option value="payments">payments</option>
        </select>
        <label htmlFor="audit-action" className="sr-only">Action</label>
        <select id="audit-action" className="border rounded px-3 py-2 text-sm" value={filters.action} onChange={(e) => update({ action: e.target.value })}>
          <option value="">All actions</option>
          <option value="INSERT">INSERT</option>
          <option value="UPDATE">UPDATE</option>
          <option value="DELETE">DELETE</option>
        </select>
        <button onClick={() => list.refetch()} className="border px-4 py-2 rounded text-sm hover:bg-slate-100">Refresh</button>
      </div>

      {error && <div className="bg-red-50 text-red-600 p-3 rounded mb-3 text-sm">{error}</div>}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase">
              <th className="py-3 px-4">When</th>
              <th className="py-3 px-4">Who</th>
              <th className="py-3 px-4">Action</th>
              <th className="py-3 px-4">Record</th>
              <th className="py-3 px-4">Before</th>
              <th className="py-3 px-4">After</th>
              <th className="py-3 px-4">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {loading ? (
              <tr><td colSpan={7} className="py-8 text-center text-slate-500 text-sm">Loading...</td></tr>
            ) : data.logs.length === 0 ? (
              <tr><td colSpan={7} className="py-8 text-center text-slate-500 text-sm">No entries.</td></tr>
            ) : (
              data.logs.map((l) => (
                <tr key={l.log_id} className="hover:bg-slate-50 align-top">
                  <td className="py-3 px-4 whitespace-nowrap text-slate-600">{new Date(l.timestamp).toLocaleString('en-IN')}</td>
                  <td className="py-3 px-4 text-slate-700">{l.user_name || (l.user_id ? `#${l.user_id}` : 'system')}</td>
                  <td className="py-3 px-4">
                    <StatusBadge status={l.action_type === 'INSERT' ? 'success' : l.action_type === 'DELETE' ? 'failed' : 'draft'} label={l.action_type} className="normal-case" />
                  </td>
                  <td className="py-3 px-4 text-slate-700">{l.table_name}{l.record_id ? ` #${l.record_id}` : ''}</td>
                  <td className="py-3 px-4 font-mono text-slate-500 break-all max-w-[220px]">{short(l.old_values)}</td>
                  <td className="py-3 px-4 font-mono text-slate-500 break-all max-w-[220px]">{short(l.new_values)}</td>
                  <td className="py-3 px-4 text-slate-500">{l.ip_address || '—'}</td>
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
