"use client";

// The wall a signed-out browser hits the moment they try to *do* something —
// open a team, join a match. Browsing is deliberately open (that's the pitch:
// see real teams and real games before committing), so this is the only place
// the app asks for an account, and it names what they were reaching for rather
// than showing a generic "please sign in".

export type GateTarget = {
  title: string;
  subtitle?: string;
  /** What signing up unlocks, phrased as a promise: "see the squad, …" */
  unlocks: string;
};

export default function SignUpGate({ target, onClose }: {
  target: GateTarget | null;
  onClose: () => void;
}) {
  if (!target) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim" onClick={onClose}>
      <div
        className="w-full max-w-md bg-surface border-t border-border rounded-t-2xl p-5 pb-8 max-h-[85dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <p className="font-bold text-base">Join Unitr</p>
          <button type="button" onClick={onClose} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="bg-surface border border-border rounded-btn p-4 mb-4">
          <p className="text-sm font-semibold truncate">{target.title}</p>
          {target.subtitle && (
            <p className="text-xs text-text-secondary truncate mt-0.5">{target.subtitle}</p>
          )}
        </div>

        <p className="text-sm text-text-secondary mb-5 leading-relaxed">
          Create a free account to {target.unlocks}. Takes a minute — no card needed to sign up.
        </p>

        <div className="flex gap-3">
          <a
            href="/login"
            className="flex-1 py-3 rounded-xl border border-border text-text-primary font-semibold text-sm text-center"
          >
            Sign In
          </a>
          <a
            href="/register"
            className="flex-[2] py-3 rounded-btn bg-accent text-white font-bold text-sm text-center"
          >
            Create Account
          </a>
        </div>
      </div>
    </div>
  );
}
