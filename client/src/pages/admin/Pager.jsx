export default function Pager({ page, limit, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (total <= limit) return <div className="text-xs text-slate-500 mt-3">{total} result{total === 1 ? '' : 's'}</div>;
  return (
    <div className="flex items-center justify-between mt-4 text-sm text-slate-600">
      <span>{total} results</span>
      <div className="flex items-center gap-2">
        <button
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-slate-100"
        >
          Previous
        </button>
        <span>Page {page} of {pages}</span>
        <button
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-slate-100"
        >
          Next
        </button>
      </div>
    </div>
  );
}
