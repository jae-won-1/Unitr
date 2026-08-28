"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Supabase redirects here with the recovery token in the URL fragment.
  // The client picks it up automatically on auth state change.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError("Failed to update password. The link may have expired — request a new one.");
      return;
    }

    setDone(true);
    setTimeout(() => router.push("/"), 2000);
  };

  if (done) {
    return (
      <div className="flex flex-col min-h-screen px-4 pt-12 items-center justify-center gap-5 text-center">
        <div className="w-16 h-16 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2" strokeLinecap="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <div>
          <p className="text-lg font-bold mb-1">Password updated!</p>
          <p className="text-sm text-text-secondary">Redirecting you to the app…</p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex flex-col min-h-screen px-4 pt-12 pb-8">
        <header className="flex items-center gap-3 mb-8">
          <a href="/login" className="w-9 h-9 rounded-full bg-surface-2 border border-border flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
          </a>
          <h1 className="text-xl font-extrabold">Set New Password</h1>
        </header>
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          <p className="text-sm text-text-secondary">Verifying reset link…</p>
          <p className="text-xs text-text-secondary max-w-[240px]">
            If this takes too long, the link may have expired.{" "}
            <a href="/forgot-password" className="text-accent-ink font-medium">Request a new one</a>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen px-4 pt-12 pb-8">
      <header className="flex items-center gap-3 mb-8">
        <div className="w-9 h-9" />
        <h1 className="text-xl font-extrabold">Set New Password</h1>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <p className="text-sm text-text-secondary">Choose a new password for your account.</p>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-secondary">New Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            required
            className="bg-surface border border-border rounded-btn px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-secondary">Confirm Password</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat your new password"
            required
            className="bg-surface border border-border rounded-btn px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60"
          />
        </div>

        <button
          type="submit"
          disabled={loading || !password || !confirm}
          className="w-full py-3.5 rounded-btn bg-accent text-white font-bold text-sm mt-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              Updating…
            </>
          ) : "Update Password"}
        </button>
      </form>
    </div>
  );
}
