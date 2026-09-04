"use client";

import { useState } from "react";
import { authedPost } from "@/lib/authed-fetch";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { fmtKickoff } from "@/lib/match-dates";
import TopUpModal from "@/components/TopUpModal";

// The buy-in sheet for entering a tournament. Lived inside the old /play page;
// it moved out when Play was split so both the Home feed and the tournament
// detail page can raise the same flow.
//
// The buy-in comes out of team credit server-side (/api/tournaments/join) —
// this sheet only confirms and reports. The route re-applies any invitation
// discount authoritatively; the discount here just keeps the UI in sync.

export type EnterTournamentTarget = {
  id: string;
  title: string;
  pitchName: string;
  matchDate: string;
  startTime: string;
  pricePerTeamPence: number;
  maxTeams: number;
  joinedCount: number;
  // Team-hosted tournaments name the organising team; venue-hosted ones fall
  // back to the pitch.
  organiserName: string;
  inviteDiscountPence: number;
};

export default function EnterTournamentPanel({
  tournament: t,
  myTeamId,
  myTeamName,
  onClose,
  onJoined,
}: {
  tournament: EnterTournamentTarget;
  myTeamId: string | null;
  myTeamName: string | null;
  onClose: () => void;
  onJoined: () => void;
}) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transferFailed, setTransferFailed] = useState(false);
  // Set when the buy-in is refused for want of credit, so the shortfall can be
  // topped up right here rather than sending the captain off to My Team and back.
  const [shortfall, setShortfall] = useState<{ shortfallPence: number; balancePence: number } | null>(null);
  const [topUpOpen, setTopUpOpen] = useState(false);

  const buyIn = Math.max(0, t.pricePerTeamPence - t.inviteDiscountPence);

  const handleJoin = async () => {
    if (!user || !myTeamId) { setError("You need to be a captain or co-captain to enter a tournament."); return; }
    setSaving(true);
    setError(null);
    setShortfall(null);

    const res = await authedPost("/api/tournaments/join", {
      openMatchId: t.id, teamId: myTeamId, teamName: myTeamName,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSaving(false);
      if (data.error === "INSUFFICIENT_CREDIT") {
        const available = typeof data.available === "number" ? data.available : 0;
        const shortPence = Math.max(0, buyIn - available);
        // The top-up modal prices the new balance off the raw balance, so read
        // the row rather than reusing `available` (which is net of holds).
        const { data: credit } = await supabase
          .from("team_credits").select("balance_pence").eq("team_id", myTeamId).maybeSingle();
        setShortfall({ shortfallPence: shortPence, balancePence: credit?.balance_pence ?? available });
        setError(`Your team needs to top up — entering costs £${(buyIn / 100).toFixed(2)} in available credit, £${(shortPence / 100).toFixed(2)} short.`);
      } else {
        setError(data.error ?? "Couldn't enter the tournament. Please try again.");
      }
      return;
    }

    // The venue payout (venue-hosted tournaments only) happens server-side in
    // the join route. Surface a non-blocking warning if it failed — the team is
    // still entered and their credit was already debited.
    setTransferFailed(data.transferStatus === "failed");
    setSaving(false);
    setConfirmed(true);
  };

  if (confirmed) {
    return (
      <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-scrim" onClick={onJoined}>
        <div className="w-full max-w-lg bg-surface rounded-t-2xl md:rounded-2xl p-6 text-center" onClick={(e) => e.stopPropagation()}>
          <div className="w-16 h-16 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <p className="text-lg font-bold mb-1">You&apos;re in!</p>
          <p className="text-sm text-text-secondary mb-5">
            {myTeamName} has entered <span className="font-semibold text-text-primary">{t.title}</span>. £{(buyIn / 100).toFixed(2)} was taken from your team credit and paid to {t.organiserName}. Your squad can settle their share afterwards from Team Credits.
          </p>
          {transferFailed && (
            <p className="text-xs text-yellow-600 bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-3 py-2 mb-5 text-left">
              Your entry is confirmed and your credit was charged, but the payout to the venue didn&apos;t go through (likely a test-mode balance issue). It&apos;ll show as failed in the venue&apos;s reports.
            </p>
          )}
          <div className="flex flex-col gap-2">
            <a href={`/play/tournament/${t.id}`} className="w-full py-3 rounded-btn bg-accent text-white font-bold text-sm">View schedule &amp; referees</a>
            <button onClick={onJoined} className="w-full py-2.5 rounded-xl bg-surface border border-border text-sm font-semibold">Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-scrim" onClick={onClose}>
      <div className="w-full max-w-lg bg-surface rounded-t-2xl md:rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <p className="font-bold">Enter Tournament</p>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="bg-surface border border-border rounded-btn p-4 mb-4">
          <p className="text-sm font-bold">{t.title}</p>
          <p className="text-xs text-text-secondary mt-0.5">{t.pitchName} · {fmtKickoff(t.matchDate, t.startTime)}</p>
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
            <span className="text-xs text-text-secondary">Buy-in (per team)</span>
            <span className="text-sm font-bold">
              {t.inviteDiscountPence > 0 && <span className="text-[11px] text-text-secondary line-through mr-1.5">£{(t.pricePerTeamPence / 100).toFixed(2)}</span>}
              £{(buyIn / 100).toFixed(2)}
            </span>
          </div>
          {t.inviteDiscountPence > 0 && (
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-xs text-accent-ink">Invitation discount</span>
              <span className="text-xs font-semibold text-accent-ink">−£{(t.inviteDiscountPence / 100).toFixed(2)}</span>
            </div>
          )}
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-xs text-text-secondary">Teams entered</span>
            <span className="text-sm font-semibold">{t.joinedCount}/{t.maxTeams}</span>
          </div>
        </div>

        <p className="text-xs text-text-secondary mb-4">
          The buy-in comes out of your team credit now and is paid to {t.organiserName}. Your players
          each refill their share from the tournament page afterwards.
        </p>

        {error && (shortfall ? (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3 py-2.5 mb-3 flex items-center gap-3">
            <p className="text-[11px] text-yellow-600 flex-1">{error}</p>
            <button onClick={() => setTopUpOpen(true)}
              className="shrink-0 px-3 py-2 rounded-btn bg-accent text-white font-bold text-xs">Top up now</button>
          </div>
        ) : (
          <p className="text-xs text-red-600 mb-3">{error}</p>
        ))}

        <button onClick={handleJoin} disabled={saving || !myTeamId}
          className="w-full py-3 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-50">
          {saving ? "Entering…" : `Pay £${(buyIn / 100).toFixed(2)} & Enter`}
        </button>
        {!myTeamId && <p className="text-[11px] text-text-secondary text-center mt-2">Only a team’s captain or co-captain can enter a tournament.</p>}
      </div>

      {/* Top up mid-entry — this sheet stays mounted behind it so the captain
          lands back on the buy-in with the new balance. */}
      {topUpOpen && shortfall && myTeamId && user && (
        <div onClick={(e) => e.stopPropagation()}>
          <TopUpModal
            teamId={myTeamId}
            userId={user.id}
            currentPence={shortfall.balancePence}
            suggestedPence={shortfall.shortfallPence}
            onClose={() => setTopUpOpen(false)}
            onSuccess={() => { setTopUpOpen(false); setShortfall(null); setError(null); }}
          />
        </div>
      )}
    </div>
  );
}
