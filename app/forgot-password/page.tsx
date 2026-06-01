"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setLoading(false);

    if (resetError) {
      setError("Something went wrong. Please check the email and try again.");
      return;
    }

    setSent(true);
  };

  return (
    <div className="flex flex-col min-h-screen px-4 pt-12 pb-8">
      <header className="flex items-center gap-3 mb-8">
        <a href="/login" className="w-9 h-9 rounded-full bg-surface-2 border border-border flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </a>
        <h1 className="text-xl font-bold">Reset Password</h1>
      </header>

      {sent ? (
        <div className="flex flex-col items-center justify-center py-16 gap-5 text-center">
          <div className="w-16 h-16 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <div>
            <p className="text-lg font-bold mb-1">Check your email</p>
            <p className="text-sm text-text-secondary max-w-[260px]">
              We sent a password reset link to <span className="text-text-primary font-medium">{email}</span>. Click the link to set a new password.
            </p>
          </div>
          <a href="/login" className="text-sm text-accent font-medium">Back to Sign In</a>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <p className="text-sm text-text-secondary leading-relaxed">
            Enter the email address for your account and we&apos;ll send you a link to reset your password.
          </p>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text-secondary">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !email}
            className="w-full py-3.5 rounded-xl bg-accent text-black font-bold text-sm mt-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                Sending…
              </>
            ) : "Send Reset Link"}
          </button>

          <p className="text-center text-sm text-text-secondary">
            Remembered it?{" "}
            <a href="/login" className="text-accent font-medium">Sign In</a>
          </p>
        </form>
      )}
    </div>
  );
}
