"use client";

// ── Captain action menu ──────────────────────────────────────────────
// The + at the head of My Team's icon row. Tapping it fans the things a
// captain *creates* out in an arc — training, announcement, task, invite
// link — over a lightly blurred page, so the row itself stays about the tabs.
//
// Portalled to <body> at z-[60]+ like every sheet, so the TopBar and
// BottomNav (z-40) are blurred along with the page rather than painting over
// it. The arc is positioned off the + button's own rect, measured on open.
//
// Players see the same slot greyed, per the house convention: the row keeps
// its shape for every role.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { inviteUrl } from "@/lib/team-invite";

type ActionKey = "training" | "announcement" | "task" | "invite";

type Action = {
  key: ActionKey;
  label: string;
  /** Where the action goes. null on a link-less action: invite copies instead,
   *  and training / task aren't built yet, so they render greyed. */
  href: string | null;
  icon: React.ReactNode;
};

const ACTIONS: Action[] = [
  {
    key: "training",
    label: "Training",
    href: null,
    icon: <><path d="M6.5 6.5h11" /><path d="M6.5 17.5h11" /><path d="M3 9.5v5" /><path d="M21 9.5v5" /><rect x="5" y="5" width="3" height="14" rx="1" /><rect x="16" y="5" width="3" height="14" rx="1" /><path d="M8 12h8" /></>,
  },
  {
    key: "announcement",
    label: "Announcement",
    href: "/my-team/announcement/create",
    icon: <><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></>,
  },
  {
    key: "task",
    label: "Task",
    href: null,
    icon: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
  },
  {
    key: "invite",
    label: "Invite link",
    href: null,
    icon: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>,
  },
];

const isLive = (a: Action) => a.href !== null || a.key === "invite";

// Fan from straight right (0°) down to straight below (90°): the + sits at the
// left edge of the row, so this is the only quarter with room on a phone.
const RADIUS = 124;
const angleFor = (i: number) => (Math.PI / 2) * (i / (ACTIONS.length - 1));

const PlusIcon = (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export default function CaptainActionMenu({ teamId, isCaptain }: { teamId: string; isCaptain: boolean }) {
  const router = useRouter();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Separate from `open` so the items can animate out before unmounting.
  const [shown, setShown] = useState(false);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Fetched when the menu opens, not when Invite is tapped: Safari only lets a
  // page write the clipboard inside the tap itself, and an RPC in between
  // would spend that permission before the link existed.
  const inviteCode = useRef<string | null>(null);

  function openMenu() {
    const r = buttonRef.current?.getBoundingClientRect();
    if (!r) return;
    setOrigin({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    setOpen(true);
    requestAnimationFrame(() => setShown(true));
    if (!inviteCode.current) {
      // Idempotent — returns the team's existing code, minting one only if
      // there is none, so this never invalidates a link already shared.
      supabase.rpc("ensure_team_invite_code", { p_team_id: teamId }).then(({ data }) => {
        if (data) inviteCode.current = data as string;
      });
    }
  }

  function closeMenu() {
    setShown(false);
    window.setTimeout(() => setOpen(false), 180);
  }

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2200);
  }

  async function copyInvite() {
    const code = inviteCode.current;
    closeMenu();
    // No code (lookup still running, or the invite migration isn't there):
    // Team Settings shows the link, or says exactly why it can't.
    if (!code) { router.push("/my-team/settings#invite"); return; }
    try {
      await navigator.clipboard.writeText(inviteUrl(code));
      flash("Invite link copied");
    } catch {
      // Clipboard refused (insecure context, denied permission) — the settings
      // panel shows the link selectable, which always works.
      router.push("/my-team/settings#invite");
    }
  }

  function select(a: Action) {
    if (a.key === "invite") { copyInvite(); return; }
    if (a.href) { closeMenu(); router.push(a.href); }
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeMenu(); };
    // The arc is pinned to where the button was; moving the page would detach it.
    const onScroll = () => closeMenu();
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={!isCaptain}
        onClick={openMenu}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex flex-col items-center gap-2 flex-1 min-w-[72px] snap-start disabled:opacity-40"
      >
        <span className="w-14 h-14 rounded-full flex items-center justify-center bg-surface border-2 border-dashed border-accent/60 text-accent-ink">
          {PlusIcon}
        </span>
        <p className="text-[11px] text-center leading-tight font-semibold text-text-secondary">Create</p>
      </button>

      {open && origin && createPortal(
        <div className="fixed inset-0 z-[60]" role="menu">
          <button
            type="button"
            aria-label="Close menu"
            onClick={closeMenu}
            className={`absolute inset-0 w-full h-full bg-black/10 backdrop-blur-sm transition-opacity duration-200 ${shown ? "opacity-100" : "opacity-0"}`}
          />

          {ACTIONS.map((a, i) => {
            const angle = angleFor(i);
            const dx = shown ? Math.cos(angle) * RADIUS : 0;
            const dy = shown ? Math.sin(angle) * RADIUS : 0;
            const enabled = isLive(a);
            return (
              <button
                key={a.key}
                type="button"
                role="menuitem"
                disabled={!enabled}
                onClick={() => select(a)}
                style={{
                  left: origin.x,
                  top: origin.y,
                  transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(${shown ? 1 : 0.4})`,
                  transitionDelay: shown ? `${i * 35}ms` : "0ms",
                }}
                className={`absolute flex flex-col items-center transition-all duration-200 ease-out ${shown ? "opacity-100" : "opacity-0"}`}
              >
                <span className={`w-12 h-12 rounded-full flex items-center justify-center shadow-card ${
                  enabled ? "bg-accent text-white" : "bg-surface border border-border text-text-secondary"}`}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {a.icon}
                  </svg>
                </span>
                <span className={`absolute top-full mt-1 whitespace-nowrap text-[11px] font-bold px-2 py-0.5 rounded-full bg-surface shadow-card ${
                  enabled ? "text-text-primary" : "text-text-secondary"}`}>
                  {a.label}{enabled ? "" : " · soon"}
                </span>
              </button>
            );
          })}

          {/* The + itself, redrawn above the blur and turned into a close. */}
          <button
            type="button"
            aria-label="Close menu"
            onClick={closeMenu}
            style={{ left: origin.x, top: origin.y }}
            className="absolute -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-full flex items-center justify-center bg-accent text-white shadow-card"
          >
            <span className={`transition-transform duration-200 ${shown ? "rotate-45" : "rotate-0"}`}>{PlusIcon}</span>
          </button>
        </div>,
        document.body,
      )}

      {toast && createPortal(
        <div role="status" className="fixed left-1/2 -translate-x-1/2 bottom-24 z-[70] px-4 py-2 rounded-full bg-text-primary text-white text-xs font-bold shadow-card">
          {toast}
        </div>,
        document.body,
      )}
    </>
  );
}
