import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal shell: role=dialog, labelled by `title`, focus moves in (to the first field, or the element
 * marked data-autofocus), Tab stays inside, Esc and a click on the backdrop call onClose, and focus returns to
 * the element that opened it. Pass `busy` to block closing while a request is running.
 *   <Modal title="Reassign course" onClose={() => setX(null)}> ...fields and buttons... </Modal>
 */
export default function Modal({ title, onClose, busy = false, children, maxWidth = 'max-w-md' }) {
  const panel = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const previous = document.activeElement;
    const nodes = panel.current?.querySelectorAll(FOCUSABLE);
    const first = panel.current?.querySelector('[data-autofocus]') || nodes?.[0];
    (first || panel.current)?.focus();
    return () => previous?.focus?.();
  }, []);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!busyRef.current) closeRef.current();
      return;
    }
    if (e.key !== 'Tab') return;
    const nodes = panel.current?.querySelectorAll(FOCUSABLE);
    if (!nodes?.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        className={`bg-white rounded-xl shadow-xl w-full ${maxWidth} p-6 focus:outline-none`}
      >
        <h2 id="modal-title" className="text-lg font-bold mb-1">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
