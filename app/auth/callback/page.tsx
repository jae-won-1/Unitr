"use client";

// Where Google sends the browser back to. Nothing is decided here beyond where
// this account belongs:
//
//   no profile row  → /welcome, to answer what Google can't tell us
//   venue account   → the portal
//   anything else   → the invite they arrived with, or Home
//
// The session itself is not read off the URL by hand. The client runs the
// default implicit flow, so supabase-js parses the fragment on construction
// and fires an auth event; this page waits for that rather than racing it.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { inviteDestination } from "@/lib/team-invite";
import { homeForAccount } from "@/lib/register-profile";

// Long enough to cover a slow profile lookup on a phone, short enough that a
// silent failure doesn't leave somebody staring at a spinner.
const GIVE_UP_MS = 10000;

/**
 * `?next=` is set by Connect Google on /profile, which is a round trip out of
 * a page rather than a way in, and wants to come back to where it started.
 * Only a path on this site is honoured — a full URL here would make the
 * callback an open redirect, and `//host` is a protocol-relative one.
 */
function safeNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let settled = false;

    // Google's own refusal — a cancelled consent screen, or a project whose
    // redirect URL doesn't match — comes back as a parameter rather than a
    // session. Implicit flow puts it in the fragment; say so plainly.
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const query = new URLSearchParams(window.location.search);
    const refusal = fragment.get("error_description") ?? query.get("error_description");
    if (refusal) {
      setError(refusal);
      return;
    }

    const route = async (session: Session) => {
      if (settled) return;
      settled = true;

      const { data: profile, error: profileError } = await supabase
        .from("profiles").select("account_type").eq("id", session.user.id).maybeSingle();

      // A failed lookup is not an account without a profile, and sending a
      // full member to /welcome would ask them to register a second time.
      if (profileError) {
        setError("Signed in, but we couldn't load your profile. Try again in a moment.");
        return;
      }

      // First time through: Google gave us an identity, not a squad player.
      // The invite code stays in localStorage for /welcome to spend.
      if (!profile) {
        router.replace("/welcome");
        return;
      }

      // Came from Connect Google on a page that wants itself back.
      const next = safeNext(new URLSearchParams(window.location.search).get("next"));
      if (next) { router.replace(next); return; }

      const accountType = profile.account_type === "venue_manager" ? "venue_manager" : "player";
      router.replace(homeForAccount(accountType, inviteDestination()));
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) void route(session);
    });

    // Already signed in — a refresh of this URL after the session was stored,
    // or a fragment supabase-js had parsed before this effect ran.
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) void route(data.session);
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      setError("That took too long. Try signing in again.");
    }, GIVE_UP_MS);

    return () => { subscription.unsubscribe(); clearTimeout(timer); };
  }, [router]);

  return (
    <div className="flex flex-col min-h-screen items-center justify-center px-6 gap-4">
      {error ? (
        <>
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 w-full max-w-sm">
            <p className="text-sm text-red-600">{error}</p>
          </div>
          <a href="/login" className="text-sm font-medium text-accent-ink">Back to sign in</a>
        </>
      ) : (
        <>
          <svg className="animate-spin text-accent" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
          <p className="text-sm text-text-secondary">Signing you in…</p>
        </>
      )}
    </div>
  );
}
