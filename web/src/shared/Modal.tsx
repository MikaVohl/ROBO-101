import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
export function Modal({
  open,
  close,
  children,
  className,
  id,
  labelledBy,
}: {
  open: boolean;
  close: () => void;
  children: ReactNode;
  className: string;
  id: string;
  labelledBy: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      id={id}
      className={className}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target !== ref.current) return;
        const rect = ref.current!.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          close();
      }}
    >
      {children}
    </dialog>
  );
}
