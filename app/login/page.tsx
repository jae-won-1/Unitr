"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { inviteAuthHref, inviteDestination, inviteFromLocation } from "@/lib/team-invite";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ?invite=<code> means they came from a captain's link and this sign-in is
  // a step on the way into a squad. Read after mount rather than with
  // useSearchParams, which would force a Suspense boundary around the form.
  const [invite, setInvite] = useState<string | null>(null);
  useEffect(() => { setInvite(inviteFromLocation()); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setError("Invalid email or password.");
      setLoading(false);
      return;
    }

    // An invite outranks the default landing page, but not the venue portal —
    // a venue account can't join a squad, and /join says so rather than
    // silently dropping them somewhere they don't belong.
    const invited = inviteDestination(invite);

    // Redirect venue managers to their portal
    if (data.user) {
      const { data: profile } = await supabase
        .from("profiles").select("account_type").eq("id", data.user.id).maybeSingle();
      setLoading(false);
      router.push(profile?.account_type === "venue_manager" ? "/venue/calendar" : invited ?? "/");
      return;
    }

    setLoading(false);
    router.push(invited ?? "/");
  };

  return (
    <div className="flex flex-col min-h-screen pb-8">
      {/* Green hero. The auth screens are the only place the wordmark appears at
          full size, so they carry the brand rather than the app chrome — the
          TopBar is suppressed on these routes (see components/TopBar.tsx). */}
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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </a>
        <h1 className="text-[22px] font-extrabold tracking-[-0.01em]">Sign in</h1>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-secondary">Email</label>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint="next"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="bg-surface border border-border rounded-btn px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-secondary">Password</label>
          <input
            type="password"
            autoComplete="current-password"
            enterKeyHint="go"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            className="bg-surface border border-border rounded-btn px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60"
          />
          <a href="/forgot-password" className="text-xs text-accent-ink font-medium self-end mt-0.5">Forgot password?</a>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3.5 rounded-btn bg-accent text-white font-bold text-sm mt-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              Signing in…
            </>
          ) : "Sign In"}
        </button>

        <p className="text-center text-sm text-text-secondary">
          Don&apos;t have an account?{" "}
          <a href={invite ? inviteAuthHref("/register", invite) : "/register"} className="text-accent-ink font-medium">Create one</a>
        </p>
      </form>
      </div>
    </div>
  );
}
