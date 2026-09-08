"use client";

import { useEffect, useState } from "react";
import { TUTORIAL, type TutorialArt, type TutorialRole, type TutorialSlide } from "@/lib/tutorial-content";

// The in-app tutorial: a role-aware carousel, shown once on first run and
// reachable forever after from the avatar menu.
//
// A carousel rather than a spotlight tour over the real UI. Coach marks have to
// anchor to a mounted element, and on Home almost every strip is conditional —
// no next fixture, no live poll, no join requests means the element the tooltip
// points at isn't in the DOM. The tour would break for exactly the brand-new
// user it exists to serve. This does the job that actually matters for a pilot:
// orientation, plus a real link onto the screen being described.
//
// Mounted once, from TopBar, which is app-wide and already inside RoleProvider.

// ── Storage ───────────────────────────────────────────────────────────
// Per role, so someone promoted from player to captain is shown the captain
// track once rather than never. Versioned so a rewritten tutorial can be shown
// again. localStorage rather than a profiles column: no migration, and
// re-showing on a new device is fine — arguably right — for a tutorial.
//
// Every access is wrapped: a private window or a browser set to block site data
// throws on read, and the tutorial is never important enough to break a page.
const KEY_VERSION = "v1";

function seenKey(role: TutorialRole) {
  return `uniter.tutorialSeen.${role}.${KEY_VERSION}`;
}

export function hasSeenTutorial(role: TutorialRole): boolean {
  try {
    return localStorage.getItem(seenKey(role)) === "1";
  } catch {
    // Can't tell — assume seen. Failing this way shows the tutorial to nobody
    // rather than to the same person on every single page load.
    return true;
  }
}

export function markTutorialSeen(role: TutorialRole) {
  try {
    localStorage.setItem(seenKey(role), "1");
  } catch {
    /* Nothing to do — worst case it opens again next visit. */
  }
}

// ── Art ───────────────────────────────────────────────────────────────
// Abstract marks in the app's own stroke style (2px, round caps, accent green)
// rather than screenshots. At sheet width a screenshot of the app inside the
// app is illegible, and it would go stale the first time a screen changed.
function Art({ kind }: { kind: TutorialArt }) {
  const common = {
    width: 48, height: 48, viewBox: "0 0 24 24", fill: "none",
    stroke: "#0E7A3C", strokeWidth: 1.6,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  };
  return (
    <div className="w-20 h-20 rounded-2xl bg-accent/10 border border-accent/25 flex items-center justify-center flex-none">
      {kind === "pitch" && (
        <svg {...common}><rect x="2" y="4" width="20" height="16" rx="1.5"/><path d="M12 4v16"/><circle cx="12" cy="12" r="2.6"/><path d="M2 9h3v6H2M22 9h-3v6h3"/></svg>
      )}
      {kind === "team" && (
        <svg {...common}><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20v-1.5A4.5 4.5 0 0 1 7 14h4a4.5 4.5 0 0 1 4.5 4.5V20"/><path d="M16.5 5.5a3.2 3.2 0 0 1 0 6.2M18 14.2a4.5 4.5 0 0 1 3.5 4.3V20"/></svg>
      )}
      {kind === "credit" && (
        <svg {...common}><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/><path d="M6 15h3"/></svg>
      )}
      {kind === "calendar" && (
        <svg {...common}><rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/><path d="M8.5 14.5l2.2 2.2 4.3-4.3"/></svg>
      )}
      {kind === "trophy" && (
        <svg {...common}><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.7V17c0 .6-.5 1-1 1.2C7.9 18.8 7 20.2 7 22M14 14.7V17c0 .6.5 1 1 1.2 1.1.6 2 2 2 3.8M18 2H6v7a6 6 0 0 0 12 0V2z"/></svg>
      )}
      {kind === "tactics" && (
        <svg {...common}><rect x="2" y="4" width="20" height="16" rx="1.5"/><circle cx="6" cy="12" r="1.2"/><circle cx="11" cy="8" r="1.2"/><circle cx="11" cy="16" r="1.2"/><circle cx="16" cy="12" r="1.2"/><path d="M7.1 11.4l2.8-2.2M7.1 12.6l2.8 2.2M12.2 8.7l2.8 2.4M12.2 15.3l2.8-2.4"/></svg>
      )}
      {kind === "chat" && (
        <svg {...common}><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.6 9.6 0 0 1-2.9-.4L3 21l1.6-4.3A8 8 0 0 1 3.6 11 8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/></svg>
      )}
      {kind === "shield" && (
        <svg {...common}><path d="M12 2.5l8 3v6c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10v-6l8-3z"/><path d="M9 12l2.2 2.2L15.5 10"/></svg>
      )}
    </div>
  );
}

// ── The sheet ─────────────────────────────────────────────────────────
export default function TutorialSheet({ role, onClose }: {
  /** Null closes the sheet. Non-null names the track to show. */
  role: TutorialRole | null;
  onClose: () => void;
}) {
  const [i, setI] = useState(0);

  // A fresh track starts at the beginning — otherwise reopening from the avatar
  // menu resumes on whichever slide it was closed at, which reads as a bug.
  useEffect(() => { setI(0); }, [role]);

  if (!role) return null;

  const slides: TutorialSlide[] = TUTORIAL[role];
  const slide = slides[i];
  const last = i === slides.length - 1;

  const finish = () => { markTutorialSeen(role); onClose(); };

  return (
    // z-[60] per the house floor: TopBar and BottomNav are z-40 chrome, and at
    // equal z the nav paints over the bottom of the sheet.
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-scrim" onClick={finish}>
      <div
        className="w-full max-w-md bg-surface border-t border-border rounded-t-2xl p-5 pb-8 max-h-[88dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="How Uniter works"
      >
        <div className="flex items-center justify-between mb-5">
          <p className="text-[11px] font-extrabold tracking-[0.08em] text-text-secondary uppercase">
            How Uniter works
          </p>
          {/* "Skip" while there's something to skip, "Close" on the last slide,
              where skipping ahead means nothing. */}
          <button type="button" onClick={finish}
            className="text-xs font-semibold text-text-secondary px-2 py-1 -mr-2">
            {last ? "Close" : "Skip"}
          </button>
        </div>

        <div className="flex flex-col items-center text-center gap-4">
          <Art kind={slide.art} />
          <div>
            <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{slide.title}</h2>
            <p className="text-sm text-text-secondary leading-relaxed mt-2">{slide.body}</p>
          </div>
        </div>

        {/* The slide's own link. Tapping it counts as finishing — someone who
            acts on the tutorial has got what it was for, and shouldn't meet it
            again on the screen they just asked to be taken to. */}
        {slide.cta && (
          <a href={slide.cta.href} onClick={finish}
            className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-btn bg-surface border border-accent/40 text-accent-ink text-sm font-bold mt-5">
            {slide.cta.label}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
          </a>
        )}

        {/* Dots double as a jump: a captain wanting the payments slide again
            shouldn't have to tap Next six times. */}
        <div className="flex items-center justify-center gap-1.5 mt-6 mb-4">
          {slides.map((s, n) => (
            <button key={s.id} type="button" onClick={() => setI(n)}
              aria-label={`Slide ${n + 1}: ${s.title}`}
              className={`h-1.5 rounded-full transition-all ${n === i ? "w-5 bg-accent" : "w-1.5 bg-border"}`} />
          ))}
        </div>

        <div className="flex items-center gap-3">
          {/* Held in place rather than removed on the first slide — a
              disappearing button shifts Next out from under a moving thumb. */}
          <button type="button" onClick={() => setI((n) => n - 1)} disabled={i === 0}
            className="flex-1 py-3 rounded-btn bg-surface border border-border text-sm font-bold text-text-secondary disabled:opacity-40">
            Back
          </button>
          {last ? (
            <button type="button" onClick={finish}
              className="flex-1 py-3 rounded-btn bg-accent text-white text-sm font-bold">
              Got it
            </button>
          ) : (
            <button type="button" onClick={() => setI((n) => n + 1)}
              className="flex-1 py-3 rounded-btn bg-accent text-white text-sm font-bold">
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
