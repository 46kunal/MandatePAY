'use client';
// OWNER: C. Confirmation dialog built on the native <dialog> element: focus is trapped, Esc closes it, and
// screen readers announce it as a modal. Used before every financially significant action.
import { useEffect, useRef, type ReactNode } from 'react';
import u from './ui.module.css';

export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog ref={ref} className={u.dialog} aria-labelledby="dialog-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      {open && (
        <>
          <div className={u.dialogHead}>
            <h2 id="dialog-title" className={u.dialogTitle}>
              {title}
            </h2>
          </div>
          <div className={u.dialogBody}>{children}</div>
          <div className={u.dialogFoot}>{footer}</div>
        </>
      )}
    </dialog>
  );
}
