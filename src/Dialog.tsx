import { useEffect, useRef, type ReactNode } from "react";
export function Dialog({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      className={wide ? "links-dialog" : ""}
      aria-labelledby="dialog-title"
    >
      <button className="close" onClick={onClose} aria-label="Close dialog">
        ×
      </button>
      <h2 id="dialog-title">{title}</h2>
      {children}
    </dialog>
  );
}
