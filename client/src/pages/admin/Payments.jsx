import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { listPaymentsApi, refundPaymentApi } from '../../services/admin.service';
import { formatDate, formatMoney } from '../../utils/format';
import Pager from './Pager';
import { qk } from '../../api/queryKeys';
import { apiError } from '../../utils/apiError';
import StatusBadge from '../../components/common/StatusBadge';
import Modal from '../../components/common/Modal';

const LIMIT = 15;

export default function Payments() {
  const [filters, setFilters] = useState({ search: '', status: '', needsRefund: false });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [refund, setRefund] = useState(null); // { payment, reason, saving, error }

  const list = useQuery({
    queryKey: [...qk.admin.payments, { page, ...applied }],
    queryFn: () => {
      const params = { page, limit: LIMIT };
      if (applied.search.trim()) params.search = applied.search.trim();
      if (applied.status) params.status = applied.status;
      if (applied.needsRefund) params.needsRefund = 'true';
      return listPaymentsApi(params);
    },
    placeholderData: keepPreviousData, // paging / filtering keeps the old rows on screen until the new ones arrive
  });
  const data = list.data ?? { payments: [], total: 0 };
  const loading = list.isPending;
  const error = actionError || (list.error ? apiError(list.error, 'Failed to load payments') : '');
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.admin.payments });

  const submit = (e) => {
    e.preventDefault();
    setPage(1);
    setApplied(filters);
  };

  const canRefund = (p) =>
    Number(p.amount) > 0 &&
    p.transaction_id &&
    p.enrollment_status !== 'completed' &&
    (p.status === 'success' || p.needs_refund) &&
    p.status !== 'refunded';

  const confirmRefund = async () => {
    const reason = refund.reason.trim();
    if (!reason) {
      setRefund((r) => ({ ...r, error: 'Please give a reason.' }));
      return;
    }
    setRefund((r) => ({ ...r, saving: true, error: '' }));
    try {
      const res = await refundPaymentApi(refund.payment.payment_id, reason);
      setNotice(res.message);
      setRefund(null);
      await refresh();
    } catch (err) {
      setRefund((r) => ({ ...r, saving: false, error: err.response?.data?.message || 'Refund failed' }));
    }
  };

  return (
    <div>
      {refund && (
        <Modal title="Refund payment" onClose={() => setRefund(null)} busy={refund.saving}>
            <p className="text-sm text-slate-600 mb-4">
              Refund {formatMoney(refund.payment.amount)} to {refund.payment.student_name} for &quot;{refund.payment.course_title}&quot;.
              The full amount goes back through Razorpay, the enrollment is closed (the student loses access) and the student is notified.
              This cannot be undone.
            </p>
            {refund.error && <div className="bg-red-50 text-red-600 p-3 rounded mb-3 text-sm">{refund.error}</div>}
            <label htmlFor="refund-reason" className="sr-only">Reason for the refund</label>
            <textarea
              id="refund-reason"
              className="w-full border rounded px-3 py-2 text-sm mb-4"
              rows={3}
              maxLength={300}
              placeholder="Reason (kept in the audit log)"
              value={refund.reason}
              onChange={(e) => setRefund((r) => ({ ...r, reason: e.target.value }))}
            />
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setRefund(null)} className="px-4 py-2 text-sm rounded border">Cancel</button>
              <button
                onClick={confirmRefund}
                disabled={refund.saving}
                className="px-4 py-2 text-sm rounded bg-red-600 text-white font-semibold disabled:opacity-50"
              >
                {refund.saving ? 'Refunding...' : 'Refund'}
              </button>
            </div>
        </Modal>
      )}

      <form onSubmit={submit} className="flex flex-wrap gap-3 mb-4 items-center">
        <label htmlFor="payments-search" className="sr-only">Search payments</label>
        <input id="payments-search"
          className="border rounded px-3 py-2 text-sm flex-1 min-w-[200px]"
          placeholder="Search student, email, course or payment id"
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
        />
        <label htmlFor="payments-status" className="sr-only">Payment status</label>
        <select id="payments-status"
          className="border rounded px-3 py-2 text-sm"
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
        >
          <option value="">All statuses</option>
          <option value="success">Success</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
          <option value="refunded">Refunded</option>
        </select>
        <label className="text-sm text-slate-700 flex items-center gap-2">
          <input
            type="checkbox"
            checked={filters.needsRefund}
            onChange={(e) => setFilters({ ...filters, needsRefund: e.target.checked })}
          />
          Needs refund
        </label>
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
              <th className="py-3 px-4">Student</th>
              <th className="py-3 px-4">Course</th>
              <th className="py-3 px-4">Amount</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Date</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm">
            {loading ? (
              <tr><td colSpan={6} className="py-8 text-center text-slate-500">Loading...</td></tr>
            ) : data.payments.length === 0 ? (
              <tr><td colSpan={6} className="py-8 text-center text-slate-500">No payments match.</td></tr>
            ) : (
              data.payments.map((p) => (
                <tr key={p.payment_id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-medium text-slate-800">
                    {p.student_name}
                    <div className="text-xs text-slate-400">{p.student_email}</div>
                  </td>
                  <td className="py-3 px-4 text-slate-600">
                    {p.course_title}
                    <div className="text-xs text-slate-400">enrollment: {p.enrollment_status}</div>
                  </td>
                  <td className="py-3 px-4 text-slate-600">{formatMoney(p.amount)}</td>
                  <td className="py-3 px-4">
                    <StatusBadge status={p.status} />
                    {p.needs_refund && p.status !== 'refunded' && (
                      <StatusBadge status="needs refund" className="ml-2" />
                    )}
                    {p.refund_reason && <div className="text-xs text-slate-400 mt-1">{p.refund_reason}</div>}
                  </td>
                  <td className="py-3 px-4 text-slate-600">{formatDate(p.refunded_at || p.paid_at || p.created_at)}</td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    {canRefund(p) ? (
                      <button
                        onClick={() => setRefund({ payment: p, reason: '', saving: false, error: '' })}
                        className="text-red-600 text-xs font-semibold hover:underline"
                      >
                        Refund
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">-</span>
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
