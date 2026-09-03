import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2 id="modal-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Kapat">
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

export function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <label className="field" htmlFor={htmlFor}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function FormActions({ busy, onCancel, submitLabel = "Kaydet" }: { busy: boolean; onCancel: () => void; submitLabel?: string }) {
  return (
    <div className="form-actions">
      <button className="button button-ghost" type="button" onClick={onCancel} disabled={busy}>
        Vazgeç
      </button>
      <button className="button button-primary" type="submit" disabled={busy}>
        {busy ? "Kaydediliyor…" : submitLabel}
      </button>
    </div>
  );
}
