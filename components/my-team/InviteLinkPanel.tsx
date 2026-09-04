"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { inviteUrl } from "@/lib/team-invite";

// ── The captain's half of the invite link ───────────────────────────────
// One link per team, minted on first view rather than behind a "Generate"
// button: a captain who opens Team Settings to invite someone wants the link,
// not a button that produces one. ensure_team_invite_code() is idempotent, so
// re-opening the page returns the same link — the one already sitting in the
// squad's group chat keeps working.
//
// Resetting is the deliberate act, and it is destructive in the way that
// matters (every copy of the old link dies), so that one confirms.

type Props = { teamId: string; teamName: string };

const MISSING_MIGRATION =
  "Run supabase_team_invites.sql in Supabase first — the invite functions aren't there yet.";

export default function InviteLinkPanel({ teamId, teamName }: Props) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.rpc("ensure_team_invite_code", { p_team_id: teamId }).then(({ data, error: err }) => {
      if (cancelled) return;
      if (err) setError(describe(err.message));
      else setCode(data as string);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [teamId]);

  const url = code ? inviteUrl(code) : "";

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API needs a secure context and, on some mobile browsers, a
      // permission the user never granted. Selecting the text is the fallback
      // that always works — they can copy it by hand.
      const el = document.getElementById("invite-link-text");
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (!url || typeof navigator.share !== "function") return;
    try {
      await navigator.share({
        title: `Join ${teamName} on Unitr`,
        text: `Join ${teamName} on Unitr`,
        url,
      });
    } catch {
      // The share sheet was dismissed. Nothing to report.
    }
  };

  const handleReset = async () => {
    setResetting(true);
    const { data, error: err } = await supabase.rpc("rotate_team_invite_code", { p_team_id: teamId });
    setResetting(false);
    setConfirmingReset(false);
    if (err) { setError(describe(err.message)); return; }
    setCode(data as string);
    setError(null);
  };

  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <section id="invite" className="bg-surface border border-border shadow-card rounded-card p-4 mb-6 scroll-mt-20">
      <p className="text-sm font-bold">Invite link</p>
      <p className="text-xs text-text-secondary mt-1 leading-relaxed">
        Send this to your players. Anyone who opens it joins {teamName} straight away —
        no join request for you to approve.
      </p>

      {loading ? (
        <div className="flex justify-center py-5">
          <div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        </div>
      ) : error ? (
        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-btn px-3 py-2.5 mt-3">
          {error}
        </p>
      ) : (
        <>
          <div className="bg-surface-2 border border-border rounded-btn px-3 py-2.5 mt-3">
            <p id="invite-link-text" className="text-xs font-medium break-all select-all">{url}</p>
          </div>

          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={handleCopy}
              className="flex-1 py-2.5 rounded-btn bg-accent text-white text-xs font-bold"
            >
              {copied ? "Copied ✓" : "Copy link"}
            </button>
            {canShare && (
              <button
                type="button"
                onClick={handleShare}
                className="flex-1 py-2.5 rounded-btn border border-border text-xs font-semibold text-text-secondary"
              >
                Share
              </button>
            )}
          </div>

          {confirmingReset ? (
            <div className="mt-3 bg-surface-2 border border-border rounded-btn p-3">
              <p className="text-xs text-text-secondary leading-relaxed">
                Resetting kills the link you&rsquo;ve already sent out — anyone who hasn&rsquo;t
                used it yet will need the new one. Players already in the squad stay in.
              </p>
              <div className="flex gap-2 mt-2.5">
                <button
                  type="button"
                  onClick={() => setConfirmingReset(false)}
                  className="flex-1 py-2 rounded-lg border border-border text-xs font-semibold text-text-secondary"
                >
                  Keep current link
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={resetting}
                  className="flex-1 py-2 rounded-lg bg-red-500 text-white text-xs font-bold disabled:opacity-50"
                >
                  {resetting ? "Resetting…" : "Reset link"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingReset(true)}
              className="mt-3 text-xs font-semibold text-text-secondary underline"
            >
              Reset link
            </button>
          )}
        </>
      )}
    </section>
  );
}

// Postgres hands back either our own captain check or the "function does not
// exist" of an unrun migration. Both are worth saying plainly; anything else
// isn't, so it gets the generic line.
function describe(message: string): string {
  if (/does not exist|schema cache/i.test(message)) return MISSING_MIGRATION;
  if (/captain/i.test(message)) return "Only the team captain can manage the invite link.";
  return "Couldn't load the invite link. Please try again.";
}
