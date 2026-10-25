import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const ConfirmContext = createContext(null);

/**
 * Promise-based confirmation dialog (replaces window.confirm):
 *   const confirm = useConfirm();
 *   if (!(await confirm('Delete this?'))) return;
 *   await confirm({ title, message, confirmLabel: 'Delete', danger: true });
 * Accessible: role=alertdialog, focus moves into the dialog, Tab stays inside, Esc cancels,
 * and focus returns to the element that opened it.
 */
export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null); // { options, resolve }

  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => {
        const opts = typeof options === 'string' ? { message: options } : options;
        setDialog({ options: opts, resolve });
      }),
    []
  );

  const close = (result) => {
    dialog?.resolve(result);
    setDialog(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {dialog && <ConfirmDialog options={dialog.options} onClose={close} />}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({ options, onClose }) {
  const { title = 'Please confirm', message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = options;
  const panelRef = useRef(null);
  const cancelRef = useRef(null);

  useEffect(() => {
    const previous = document.activeElement;
    cancelRef.current?.focus(); // safest default for destructive actions
    return () => previous?.focus?.();
  }, []);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose(false);
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = panelRef.current?.querySelectorAll('button:not([disabled])');
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 px-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
      >
        <h2 id="confirm-title" className="text-lg font-bold text-slate-800">{title}</h2>
        <p id="confirm-message" className="mt-2 text-sm text-slate-600 whitespace-pre-line">{message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => onClose(false)}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => onClose(true)}
            className={`rounded-md px-4 py-2 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
              danger ? 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-500' : 'bg-indigo-600 hover:bg-indigo-700 focus-visible:ring-indigo-500'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Without a provider (isolated component tests) fall back to the browser's own confirm.
const fallback = (options) =>
  Promise.resolve(window.confirm(typeof options === 'string' ? options : options.message));
export const useConfirm = () => useContext(ConfirmContext) || fallback;
