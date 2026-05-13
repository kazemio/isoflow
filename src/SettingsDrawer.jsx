import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";

export function SettingsDrawer({ open, onClose, title = "Settings", children }) {
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  // When the drawer closes, blur any focused descendant so focus doesn't
  // remain trapped on a hidden element. `inert` (below) also prevents new
  // focus, but a button mid-press can still hold focus until we move it.
  useEffect(() => {
    if (open) return;
    const root = rootRef.current;
    if (root && root.contains(document.activeElement) && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`drawer-root${open ? " open" : ""}`}
      // `inert` both hides the subtree from assistive tech AND prevents
      // focus from landing inside it — replaces the previous aria-hidden,
      // which warned when a descendant retained focus.
      {...(open ? {} : { inert: "" })}
    >
      <div
        className="drawer-overlay"
        onClick={onClose}
      />
      <aside
        className="drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="drawer-header">
          <h3 className="drawer-title">{title}</h3>
          <button
            type="button"
            className="drawer-close"
            onClick={onClose}
            aria-label="Close settings"
          >
            <X size={18} />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}
