import {
  Archive,
  Ban,
  CircleCheck,
  CircleX,
  Clock,
  FileEdit,
  LoaderCircle,
  Minus,
  TriangleAlert,
  Undo2,
} from 'lucide-react';

const TONES = {
  success: 'bg-emerald-100 text-emerald-800',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-800',
  info: 'bg-indigo-100 text-indigo-800',
  neutral: 'bg-slate-200 text-slate-700',
};

// status word -> tone + icon. The icon and the word carry the meaning, so it never depends on colour alone.
const STATUS = {
  success: ['success', CircleCheck],
  active: ['success', CircleCheck],
  published: ['success', CircleCheck],
  approved: ['success', CircleCheck],
  open: ['success', CircleCheck],
  completed: ['info', CircleCheck],
  pending: ['warning', Clock],
  inactive: ['warning', Clock],
  full: ['warning', TriangleAlert],
  archived: ['warning', Archive],
  refunded: ['warning', Undo2],
  failed: ['danger', CircleX],
  rejected: ['danger', CircleX],
  banned: ['danger', Ban],
  'needs refund': ['danger', TriangleAlert],
  ready: ['success', CircleCheck],
  processing: ['info', LoaderCircle],
  uploading: ['info', LoaderCircle],
  error: ['danger', CircleX],
  draft: ['neutral', FileEdit],
  dropped: ['neutral', Minus],
  closed: ['neutral', Minus],
};

/**
 * Pill with an icon and the status as text.   <StatusBadge status={p.status} />
 * `label` overrides the text, `tone` overrides the colour for statuses not in the table above.
 */
export default function StatusBadge({ status, label, tone, className = '' }) {
  const key = String(status ?? '').toLowerCase();
  const [knownTone, Icon] = STATUS[key] || ['neutral', null];
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold capitalize ${TONES[tone || knownTone]} ${className}`}
    >
      {Icon && <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />}
      {label ?? status}
    </span>
  );
}
