"use client";

// How this account can be signed into, on /profile.
//
// It exists for the accounts that predate Google sign-in. An address Supabase
// has confirmed is matched automatically, but a made-up one — and the pilot has
// some — can never be matched to a Google account, so an explicit link is the
// only thing that will ever join the two. Connect attaches Google to whoever is
// signed in, which makes the registered address irrelevant.

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { connectGoogle, disconnectGoogle, hasGoogleIdentity } from "@/lib/google-auth";

export default function SignInMethods() {
  const { user } = useAuth();
  const [connected, setConnected] = useState<boolean | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) { setConnected(undefined); return; }
    let live = true;
    void hasGoogleIdentity().then((has) => { if (live) setConnected(has); });
    return () => { live = false; };
  }, [user]);

  // Signed out, or the identity list wouldn't load — the same silence the card
  // section keeps rather than showing a broken panel.
  if (!user || connected === undefined) return null;

  const handleConnect = async () => {
    setError(null);
    setBusy(true);
    const message = await connectGoogle("/profile");
    // Resolving means it never left: a success has already gone to Google.
    if (message) { setError(message); setBusy(false); }
  };

  const handleDisconnect = async () => {
    setError(null);
    setBusy(true);
    const message = await disconnectGoogle();
    if (message) setError(message);
    else setConnected(false);
    setBusy(false);
  };

  return (
    <section>
      <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Sign-in Methods</h3>
      <div className="bg-surface border border-border shadow-card rounded-card p-4 space-y-3">
        <p className="text-xs text-text-secondary leading-relaxed">
          Your email and password always work. Connecting Google adds a second way into
          this same account — your team, your stats and your payments stay exactly where
          they are.
        </p>

        <div className="flex items-center gap-3 bg-background border border-border rounded-xl px-3 py-2.5">
          <div className="w-9 h-9 rounded-lg bg-surface border border-border flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#4285F4" d="M45.12 24.5c0-1.57-.14-3.08-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/>
              <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/>
              <path fill="#FBBC05" d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"/>
              <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Google</p>
            <p className={`text-[11px] ${connected ? "text-accent-ink" : "text-text-secondary"}`}>
              {connected ? "Connected · you can sign in with Google" : "Not connected"}
            </p>
          </div>
          {connected ? (
            <button onClick={handleDisconnect} disabled={busy}
              className="text-xs text-red-600 font-medium flex-shrink-0 disabled:opacity-50">
              Disconnect
            </button>
          ) : (
            <button onClick={handleConnect} disabled={busy}
              className="text-xs text-accent-ink font-semibold flex-shrink-0 disabled:opacity-50">
              {busy ? "Opening…" : "Connect"}
            </button>
          )}
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </section>
  );
}
