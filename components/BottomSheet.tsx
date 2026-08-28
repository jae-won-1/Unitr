"use client";

import { useEffect } from "react";

// ── Bottom sheet ──────────────────────────────────────────────────────
// The rebrand's one overlay shape. Every panel that used to be a centred
// dialog — Top Up, Collect Payment, Settle Payments, the poll composer — is
// drawn as a sheet rising from the bottom edge: rounded only at the top, full
// width, with a grabber above the title.
//
// It is anchored to the bottom rather than centred because these panels are
// reached one-handed on a phone mid-task, and a centred box puts its primary
// action in the middle of the screen where the thumb is not.
//
// z-[60] is the house overlay floor (see CLAUDE.md): the TopBar and BottomNav
// are z-40 chrome, and at an equal z the nav paints over the sheet's bottom
// edge — which is exactly where the primary button lives.

export default function BottomSheet({ title, subtitle, onClose, children, footer, clipBody = true }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Pinned below the scrolling body — for a sheet whose action must stay put. */
  footer?: React.ReactNode;
  /**
   * False when the body contains absolutely-positioned dropdowns — the
   * date/time pickers in the poll composer, for one. Scrolling the body means
   * `overflow-y-auto`, and that clips any child escaping the panel's bounds.
   * With this off the panel grows to its content and the backdrop scrolls
   * instead, so a dropdown can overhang freely.
   */
  clipBody?: boolean;
}) {
  // Escape closes, matching the scrim tap. Without it a sheet opened by keyboard
  // can only be dismissed by pointing at the backdrop.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className={`fixed inset-0 z-[60] flex justify-center ${clipBody ? "items-end" : "items-end overflow-y-auto"}`}
      style={{ background: "rgba(11,21,38,0.55)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full max-w-lg bg-surface rounded-t-[24px] px-5 pt-2.5 pb-6 flex flex-col gap-4 ${clipBody ? "max-h-[88dvh]" : "mt-16"}`}
        style={{ boxShadow: "0 -8px 32px rgba(11,21,38,0.18)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="w-11 h-1 rounded-full bg-border self-center flex-none" />

        <div className="flex items-start justify-between gap-2.5 flex-none">
          <div className="flex flex-col gap-1 min-w-0">
            <p className="text-[22px] font-extrabold leading-tight">{title}</p>
            {subtitle && <p className="text-[13px] font-medium text-text-secondary">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="flex-none mt-1">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div className={`flex flex-col gap-4 ${clipBody ? "overflow-y-auto flex-1" : ""}`}>{children}</div>

        {footer && <div className="flex-none">{footer}</div>}
      </div>
    </div>
  );
}
