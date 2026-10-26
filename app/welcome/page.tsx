"use client";

// Finish setting up. A Google account arrives with a name and an email and
// nothing else — no account type, no position, no experience — so this asks
// the questions app/register asks and writes the same row (lib/register-profile).
//
// Until it is finished there is no profile, and components/ProfileGate keeps
// sending the account back here: half a profile is worse than none, because a
// player with no position is invisible to every filter in the Transfer Market.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { inviteDestination } from "@/lib/team-invite";
import {
  AccountTypeCards, PlayerDetailsFields, VenueNextStepsNote,
} from "@/components/RegistrationFields";
import {
  EMPTY_PLAYER_DETAILS, homeForAccount, insertNewProfile, playerDetailsIncomplete,
  type AccountType, type PlayerDetails,
} from "@/lib/register-profile";

export default function WelcomePage() {
  const router = useRouter();
  const { user, loading: authLoading, signOut } = useAuth();

  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [fullName, setFullName] = useState("");
  const [details, setDetails] = useState<PlayerDetails>(EMPTY_PLAYER_DETAILS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (authLoading) return;

    // No session at all: this page is only reachable after signing in.
    if (!user) { router.replace("/login"); return; }

    // Google's name, as the starting point rather than the answer — it is
    // whatever their Google account says, which is often not what a squad
    // list should show. The field stays editable.
    const fromGoogle =
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined) ??
      "";
    setFullName((current) => current || fromGoogle);

    // Somebody who already finished — a bookmark, a back button, a second tab
    // — has nothing to do here.
    void supabase
      .from("profiles").select("account_type").eq("id", user.id).maybeSingle()
      .then(({ data: profile, error: profileError }) => {
        if (profile) {
          const existing = profile.account_type === "venue_manager" ? "venue_manager" : "player";
          router.replace(homeForAccount(existing, inviteDestination()));
          return;
        }
        // A failed lookup leaves the form up: filling it in again is
        // recoverable, and the insert will tell us if the row was there.
        if (profileError) setError(null);
        setChecking(false);
      });
  }, [user, authLoading, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!user) { router.replace("/login"); return; }
    if (!accountType) { setError("Please select an account type."); return; }
    if (!fullName.trim()) { setError("Please enter your name."); return; }
    if (accountType === "player" && playerDetailsIncomplete(details)) {
      setError("Please fill in all player fields.");
      return;
    }

    setSaving(true);
    const insertError = await insertNewProfile(user.id, accountType, fullName.trim(), details);
    if (insertError) { setError(insertError); setSaving(false); return; }

    setSaving(false);
    // /join/<code> rather than joining here: that page redeems the code and is
    // the one screen that explains what just happened.
    router.push(homeForAccount(accountType, inviteDestination()));
  };

  if (authLoading || checking) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center gap-3">
        <svg className="animate-spin text-accent" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
        </svg>
        <p className="text-sm text-text-secondary">One moment…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen pb-10">
      {/* Same green hero as Sign in and Create an account — one flow. */}
      <div className="relative overflow-hidden bg-accent px-6 pt-12 pb-8">
        <div className="absolute inset-0" style={{ background: "repeating-linear-gradient(90deg,rgba(255,255,255,0.05) 0 40px,rgba(0,0,0,0.05) 40px 80px)" }} />
        <span className="relative flex items-center gap-1.5">
          <span className="text-[34px] font-extrabold text-white tracking-[-0.03em] leading-none">UNITER</span>
          <span className="w-[11px] h-6 bg-accent-2 -skew-x-12" />
        </span>
      </div>

      <div className="flex flex-col px-6 pt-6">
        <header className="mb-2">
          <h1 className="text-[22px] font-extrabold tracking-[-0.01em]">Finish setting up</h1>
          <p className="text-sm text-text-secondary mt-1">
            You&apos;re signed in{user?.email ? ` as ${user.email}` : ""}. A few things Google can&apos;t tell us.
          </p>
        </header>

        {/* The app can't detect this itself: `profiles` stores no email and the
            browser can't read auth.users. An account registered with a
            different address from this Google one is a *different* user to Supabase, so finishing
            here would leave the original one — squad, stats, payments — sitting
            untouched behind a password they still have. Say so before they fill
            anything in. */}
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-btn px-4 py-3 mt-4">
          <p className="text-sm font-semibold text-amber-700">Had a Uniter account already?</p>
          <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">
            If it used a different email from this Google account, this is a new one. Sign in
            with your email and password instead, then connect Google from your profile — that
            keeps your team and everything on it.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5 mt-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <AccountTypeCards value={accountType} onChange={setAccountType} />

          {accountType && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-secondary">
                {accountType === "venue_manager" ? "Your Name" : "Full Name"}
              </label>
              <input type="text" autoComplete="name" autoCapitalize="words" enterKeyHint="next"
                value={fullName} onChange={(e) => setFullName(e.target.value)}
                placeholder={accountType === "venue_manager" ? "e.g. Sarah Johnson" : "e.g. Jamie Dawson"}
                className="bg-surface border border-border rounded-btn px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60" />
            </div>
          )}

          {accountType === "player" && (
            <PlayerDetailsFields
              value={details}
              onChange={(patch) => setDetails((d) => ({ ...d, ...patch }))}
            />
          )}

          {accountType === "venue_manager" && <VenueNextStepsNote />}

          {accountType && (
            <button type="submit" disabled={saving}
              className="w-full py-3.5 rounded-btn bg-accent text-white font-bold text-sm mt-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {saving ? (
                <>
                  <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                  Saving…
                </>
              ) : accountType === "venue_manager" ? "Create Venue Account" : "Finish"}
            </button>
          )}

          {/* The way out for somebody who signed in with the wrong Google
              account. Without it this page is a dead end — ProfileGate sends
              them straight back to it from anywhere else in the app. */}
          <button type="button" onClick={() => signOut("/login")}
            className="text-center text-sm text-text-secondary underline underline-offset-4">
            Use a different account
          </button>
        </form>
      </div>
    </div>
  );
}
