"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const positions = ["GK", "CB", "LB", "RB", "CDM", "CM", "CAM", "LW", "RW", "ST"];
const experiences = ["Beginner", "Casual", "Intermediate", "Competitive", "Semi-Pro"];

// How much football someone actually plays, which is a different question from
// how good they are. Buckets rather than a number because the answer is a
// self-reported estimate — the stored value is the `value`, the label is only
// ever shown. Kept in sync with supabase_play_frequency.sql.
const playFrequencies = [
  { value: "1-2", label: "1–2 games" },
  { value: "3-5", label: "3–5 games" },
  { value: "6-9", label: "6–9 games" },
  { value: "10+", label: "10+ games" },
];

// Pilot testing is London-only, so the location question is not worth asking
// yet — every answer would be the same. Profiles still carry a location (the
// Transfer Market, search and squad lists all render it), so we write this
// rather than leaving the column null and those cards blank.
const PILOT_LOCATION = "London";

type AccountType = "player" | "venue_manager";

export default function RegisterPage() {
  const router = useRouter();
  const [accountType, setAccountType] = useState<AccountType | null>(null);

  // Shared fields
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Player-only fields
  const [position, setPosition] = useState("");
  const [experience, setExperience] = useState("");
  const [gamesPerMonth, setGamesPerMonth] = useState("");

  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!accountType) { setError("Please select an account type."); return; }
    if (!fullName || !email || !password) { setError("Please fill in all required fields."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirmPassword) { setError("Passwords do not match."); return; }
    if (accountType === "player" && (!position || !experience || !gamesPerMonth)) {
      setError("Please fill in all player fields.");
      return;
    }

    setLoading(true);

    const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
    if (signUpError) { setError(signUpError.message); setLoading(false); return; }

    if (data.user) {
      const profileData =
        accountType === "venue_manager"
          ? { id: data.user.id, full_name: fullName, account_type: "venue_manager" }
          : {
              id: data.user.id,
              full_name: fullName,
              location: PILOT_LOCATION,
              position,
              experience,
              games_per_month: gamesPerMonth,
              account_type: "player",
            };

      const { error: profileError } = await supabase.from("profiles").insert(profileData);
      if (profileError) { setError(profileError.message); setLoading(false); return; }
    }

    setLoading(false);
    router.push(accountType === "venue_manager" ? "/venue/calendar" : "/");
  };

  return (
    <div className="flex flex-col min-h-screen pb-10">
      {/* Same green hero as Sign in — the two screens are one flow. */}
      <div className="relative overflow-hidden bg-accent px-6 pt-12 pb-8">
        <div className="absolute inset-0" style={{ background: "repeating-linear-gradient(90deg,rgba(255,255,255,0.05) 0 40px,rgba(0,0,0,0.05) 40px 80px)" }} />
        <span className="relative flex items-center gap-1.5">
          <span className="text-[34px] font-extrabold text-white tracking-[-0.03em] leading-none">UNITR</span>
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

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Account type selector */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-text-secondary">I am a…</label>
          <div className="grid grid-cols-2 gap-3">
            {/* Player card */}
            <button type="button" onClick={() => setAccountType("player")}
              className={`flex flex-col items-start gap-3 p-4 rounded-2xl border-2 transition-all text-left ${accountType === "player" ? "border-accent bg-accent/10" : "border-border bg-surface-2"}`}>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${accountType === "player" ? "bg-accent/20" : "bg-surface"}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={accountType === "player" ? "#0E7A3C" : "#5A6478"} strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                  <path d="M2 12h20"/>
                </svg>
              </div>
              <div>
                <p className={`text-sm font-bold ${accountType === "player" ? "text-accent-ink" : "text-text-primary"}`}>Player</p>
                <p className="text-xs text-text-secondary mt-0.5">Join teams, find matches, track stats</p>
              </div>
              {accountType === "player" && (
                <div className="absolute top-2 right-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="#0E7A3C"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
              )}
            </button>

            {/* Venue manager card */}
            <button type="button" onClick={() => setAccountType("venue_manager")}
              className={`flex flex-col items-start gap-3 p-4 rounded-2xl border-2 transition-all text-left ${accountType === "venue_manager" ? "border-accent bg-accent/10" : "border-border bg-surface-2"}`}>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${accountType === "venue_manager" ? "bg-accent/20" : "bg-surface"}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={accountType === "venue_manager" ? "#0E7A3C" : "#5A6478"} strokeWidth="2" strokeLinecap="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                </svg>
              </div>
              <div>
                <p className={`text-sm font-bold ${accountType === "venue_manager" ? "text-accent-ink" : "text-text-primary"}`}>Venue Manager</p>
                <p className="text-xs text-text-secondary mt-0.5">List your pitch, manage bookings</p>
              </div>
            </button>
          </div>
        </div>

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

        {/* Player-only fields */}
        {accountType === "player" && (
          <>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-secondary">Position</label>
              <div className="flex flex-wrap gap-2">
                {positions.map((pos) => (
                  <button key={pos} type="button" onClick={() => setPosition(pos)}
                    className={`px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${position === pos ? "bg-accent text-white border-accent" : "border-border bg-surface-2 text-text-secondary"}`}>
                    {pos}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-secondary">Experience Level</label>
              <div className="flex flex-col gap-2">
                {experiences.map((level) => (
                  <button key={level} type="button" onClick={() => setExperience(level)}
                    className={`w-full px-4 py-3 rounded-xl border text-sm font-medium text-left transition-colors ${experience === level ? "bg-accent text-white border-accent" : "border-border bg-surface-2 text-text-secondary"}`}>
                    {level}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-secondary">How often do you play?</label>
              <div className="grid grid-cols-2 gap-2">
                {playFrequencies.map((freq) => (
                  <button key={freq.value} type="button" onClick={() => setGamesPerMonth(freq.value)}
                    className={`px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${gamesPerMonth === freq.value ? "bg-accent text-white border-accent" : "border-border bg-surface-2 text-text-secondary"}`}>
                    {freq.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-text-secondary">Roughly, per month.</p>
            </div>
          </>
        )}

        {/* Venue manager info banner */}
        {accountType === "venue_manager" && (
          <div className="bg-accent/5 border border-accent/20 rounded-xl px-4 py-3">
            <p className="text-xs text-accent-ink font-semibold mb-1">What happens next</p>
            <p className="text-xs text-text-secondary leading-relaxed">
              After signing up you&apos;ll land in your Venue Portal where you can register your pitch, set availability, and start receiving bookings from Unitr players.
            </p>
          </div>
        )}

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

        <p className="text-center text-sm text-text-secondary">
          Already have an account?{" "}
          <a href="/login" className="text-accent-ink font-medium">Sign In</a>
        </p>
      </form>
      </div>
    </div>
  );
}
