import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const ToastContext = createContext(null);

const STYLE = {
  success: 'bg-emerald-600 text-white',
  error: 'bg-red-600 text-white',
  info: 'bg-slate-800 text-white',
};

/**
 * Non-blocking messages (replaces alert()). Errors stay a bit longer than successes.
 * The container is an aria-live region so screen readers announce new toasts.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (type, message) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-3), { id, type, message }]);
      timers.current.set(id, setTimeout(() => dismiss(id), type === 'error' ? 7000 : 4000));
      return id;
    },
    [dismiss]
  );

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((handle) => clearTimeout(handle));
  }, []);

  const api = useMemo(
    () => ({
      success: (m) => show('success', m),
      error: (m) => show('error', m),
      info: (m) => show('info', m),
    }),
    [show]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 left-4 sm:left-auto z-[100] flex flex-col gap-2 sm:w-96 pointer-events-none"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.type === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-3 rounded-lg px-4 py-3 text-sm shadow-lg ${STYLE[t.type]}`}
          >
            <span className="flex-1">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss message"
              className="opacity-80 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white rounded"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// Without a provider (isolated component tests) the calls are harmless no-ops.
const NOOP = { success: () => {}, error: () => {}, info: () => {} };
export const useToast = () => useContext(ToastContext) || NOOP;
