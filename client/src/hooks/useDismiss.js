import { useEffect } from 'react';

/**
 * For dropdowns / popovers: while `open`, Escape and a click outside `containerRef` call onClose.
 * With Escape, focus goes back to `returnFocusRef` (the button that opened it).
 */
export function useDismiss({ open, containerRef, returnFocusRef, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose();
        returnFocusRef?.current?.focus();
      }
    };
    const onPointer = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open, containerRef, returnFocusRef, onClose]);
}
