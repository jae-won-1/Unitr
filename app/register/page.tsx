"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { inviteAuthHref, inviteDestination, inviteFromLocation } from "@/lib/team-invite";
import GoogleAuthButton from "@/components/GoogleAuthButton";
import {
  AccountTypeCards, PlayerDetailsFields, VenueNextStepsNote,
} from "@/components/RegistrationFields";
import {
  EMPTY_PLAYER_DETAILS, homeForAccount, insertNewProfile, playerDetailsIncomplete,
  type AccountType, type PlayerDetails,
} from "@/lib/register-profile";

// The questions themselves — and the option lists behind them — live in
// components/RegistrationFields.tsx and lib/profile-options.ts. /welcome asks
// the same set of a Google account, and two copies would eventually offer two
// different forms. The reasoning behind each answer (why buckets rather than a
// number, why short keys rather than the labels) is on the migrations that
// added the columns: supabase_player_demographics.sql,
// supabase_play_frequency.sql, supabase_preferred_football_type.sql.

export default function RegisterPage() {
  const router = useRouter();
  const [accountType, setAccountType] = useState<AccountType | null>(null);

  // Shared fields
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Player-only fields
  const [details, setDetails] = useState<PlayerDetails>(EMPTY_PLAYER_DETAILS);

  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ?invite=<code> — this account is being created to take a captain's invite
  // link. Read after mount rather than with useSearchParams, which would force
  // a Suspense boundary around the whole form.
  const [invite, setInvite] = useState<string | null>(null);
  useEffect(() => { setInvite(inviteFromLocation()); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!accountType) { setError("Please select an account type."); return; }
    if (!fullName || !email || !password) { setError("Please fill in all required fields."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirmPassword) { setError("Passwords do not match."); return; }
    if (accountType === "player" && playerDetailsIncomplete(details)) {
      setError("Please fill in all player fields.");
      return;
    }

    setLoading(true);

    const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
    if (signUpError) { setError(signUpError.message); setLoading(false); return; }

    if (data.user) {
      const profileError = await insertNewProfile(data.user.id, accountType, fullName, details);
      if (profileError) { setError(profileError); setLoading(false); return; }
    }

    setLoading(false);
    // /join/<code> rather than joining here: that page redeems the code and is
    // the one screen that explains what just happened, so a brand-new member
    // and a returning one land on the same confirmation.
    router.push(homeForAccount(accountType, inviteDestination(invite)));
  };

  return (
    <div className="flex flex-col min-h-screen pb-10">
      {/* Same green hero as Sign in — the two screens are one flow. */}
      <div className="relative overflow-hidden bg-accent px-6 pt-12 pb-8">
        <div className="absolute inset-0" style={{ background: "repeating-linear-gradient(90deg,rgba(255,255,255,0.05) 0 40px,rgba(0,0,0,0.05) 40px 80px)" }} />
        <span className="relative flex items-center gap-1.5">
          <span className="text-[34px] font-extrabold text-white tracking-[-0.03em] leading-none">UNITER</span>
          <span className="w-[11px] h-6 bg-accent-2 -skew-x-12" />
        </span>
      </div>

      <div className="flex flex-col px-6 pt-6">
      <header className="flex items-center gap-3 mb-6">
        <a href="/" className="w-9 h-9 rounded-full bg-surface border border-border flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </a>
        <h1 className="text-[22px] font-extrabold tracking-[-0.01em]">Create an account</h1>
      </header>

      {/* Arriving from a captain's link. The team was named on /join, so this
          only has to reassure them the invite survived the detour. */}
      {invite && (
        <div className="bg-accent/10 border border-accent/30 rounded-btn px-4 py-3 mb-5">
          <p className="text-sm font-semibold text-accent-ink">You&apos;re joining a team</p>
          <p className="text-xs text-text-secondary mt-0.5">
            Finish signing up as a player and you&apos;ll be in the squad straight away.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Account type selector */}
        <AccountTypeCards value={accountType} onChange={setAccountType} />

        {/* Common fields — shown once account type is selected */}
        {accountType && (
          <>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-secondary">
                {accountType === "venue_manager" ? "Your Name" : "Full Name"}
              </label>
              <input type="text" autoComplete="name" autoCapitalize="words" enterKeyHint="next"
                value={fullName} onChange={(e) => setFullName(e.target.value)}
                placeholder={accountType === "venue_manager" ? "e.g. Sarah Johnson" : "e.g. Jamie Dawson"}
                className="bg-surface border border-border rounded-btn px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60" />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-secondary">Email</label>
              <input type="email" inputMode="email" autoComplete="email" autoCapitalize="none"
                autoCorrect="off" enterKeyHint="next"
                value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="bg-surface border border-border rounded-btn px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60" />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-secondary">Password</label>
              <input type="password" autoComplete="new-password" enterKeyHint="next"
                value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                className="bg-surface border border-border rounded-btn px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60" />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-secondary">Confirm Password</label>
              <input type="password" autoComplete="new-password" enterKeyHint="done"
                value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                className="bg-surface border border-border rounded-btn px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60" />
            </div>
          </>
        )}

        {/* Player-only fields. Shared with /welcome, which asks a Google
            account the same six questions — see components/RegistrationFields. */}
        {accountType === "player" && (
          <PlayerDetailsFields
            value={details}
            onChange={(patch) => setDetails((d) => ({ ...d, ...patch }))}
          />
        )}

        {/* Venue manager info banner */}
        {accountType === "venue_manager" && <VenueNextStepsNote />}

        {accountType && (
          <button type="submit" disabled={loading}
            className="w-full py-3.5 rounded-btn bg-accent text-white font-bold text-sm mt-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            {loading ? (
              <>
                <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
                Creating account…
              </>
            ) : accountType === "venue_manager" ? "Create Venue Account" : "Create Account"}
          </button>
        )}

        {/* Google creates the account from the same tap that signs one in, so
            this is on both screens. It skips the questions above — /welcome
            asks them on the way back, since Google can't answer them. */}
        <GoogleAuthButton invite={invite} onError={setError} />

        <p className="text-center text-sm text-text-secondary">
          Already have an account?{" "}
          <a href={invite ? inviteAuthHref("/login", invite) : "/login"} className="text-accent-ink font-medium">Sign In</a>
        </p>
      </form>
      </div>
    </div>
  );
}
