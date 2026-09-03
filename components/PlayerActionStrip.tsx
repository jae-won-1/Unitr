"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import DuesTopUpModal, { useMyDues } from "@/components/DuesTopUpModal";
import AvailabilityModal, { useAvailabilityPoll } from "@/components/AvailabilityModal";
import { useMatchAvailability } from "@/components/MatchAvailabilityList";
import { fmtFee, useJoiningFee } from "@/lib/joining-fee";

// The two things a captain actually asks of a squad player: answer the
// availability poll, and put money in. Both resolve in a popup — a player who
// taps here never leaves home and never loses their place in the feed.

export default function PlayerActionStrip({ teamId, userId }: { teamId: string | null; userId: string }) {
  const { request, myAnswer, loading, reload } = useAvailabilityPoll(teamId, userId);
  // Games that were matched without a poll still need an answer from this
  // player, so the tile opens even when there's no poll running.
  const { matches, awaiting, loading: matchesLoading, reload: reloadMatches } = useMatchAvailability(teamId, userId);
  const { owedPence, reload: reloadDues } = useMyDues(teamId, userId);
  const { owedPence: feeOwedPence, reload: reloadFee } = useJoiningFee(teamId, userId);
  const [balancePence, setBalancePence] = useState<number | null>(null);
  const [showAvailability, setShowAvailability] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);

  useEffect(() => {
    if (!teamId) return;
    supabase.from("team_credits").select("balance_pence").eq("team_id", teamId).maybeSingle()
      .then(({ data }) => setBalancePence(data?.balance_pence ?? 0));
  }, [teamId]);

  const hasSomething = !!request || matches.length > 0;
  const needsAnswer = (!!request && myAnswer === null) || awaiting > 0;

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {/* ── Availability ── */}
        <button
          type="button"
          onClick={() => hasSomething && setShowAvailability(true)}
          disabled={!hasSomething}
          className={`relative rounded-2xl p-4 text-left border transition-colors ${
            needsAnswer
              ? "bg-orange-500/10 border-orange-500/30"
              : "bg-surface-2 border-border"
          } ${!hasSomething ? "opacity-60 cursor-default" : ""}`}
        >
          {needsAnswer && <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-danger" />}
          <div className={`w-9 h-9 rounded-full flex items-center justify-center mb-2 ${needsAnswer ? "bg-orange-500/20" : "bg-accent/10 border border-accent/30"}`}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={needsAnswer ? "#FB923C" : "#0E7A3C"} strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
            </svg>
          </div>
          <p className="text-sm font-bold leading-tight">Submit Availability</p>
          {/* An unanswered fixture outranks the poll: it's a game that is
              definitely happening, and the captain is picking a squad from it. */}
          <p className="text-[11px] text-text-secondary mt-1 leading-tight">
            {loading || matchesLoading ? "Checking…"
              : awaiting > 0 ? `${awaiting} match${awaiting === 1 ? "" : "es"} need your reply`
              : !request ? (matches.length > 0 ? "Replied to every match · tap to change" : "No open request")
              : myAnswer === null ? "Captain is waiting on you"
              : myAnswer.length === 0 ? "You said none work · tap to change"
              : `${myAnswer.length} date${myAnswer.length === 1 ? "" : "s"} sent · tap to change`}
          </p>
        </button>

        {/* ── Top up ── */}
        <button
          type="button"
          onClick={() => teamId && setShowTopUp(true)}
          disabled={!teamId}
          className={`relative rounded-2xl p-4 text-left border disabled:opacity-60 ${
            owedPence + feeOwedPence > 0 ? "bg-red-500/10 border-red-500/30" : "bg-surface-2 border-border"
          }`}
        >
          {owedPence + feeOwedPence > 0 && <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-danger" />}
          <div className={`w-9 h-9 rounded-full flex items-center justify-center mb-2 ${owedPence + feeOwedPence > 0 ? "bg-red-500/20" : "bg-accent/10 border border-accent/30"}`}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={owedPence + feeOwedPence > 0 ? "#F87171" : "#0E7A3C"} strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/>
            </svg>
          </div>
          <p className="text-sm font-bold leading-tight">Top Up Team Credit</p>
          {/* The joining fee outranks match dues: until it's paid the player
              can't vote for games at all, so it's the thing to say first. */}
          <p className={`text-[11px] mt-1 leading-tight ${owedPence + feeOwedPence > 0 ? "text-red-600 font-semibold" : "text-text-secondary"}`}>
            {feeOwedPence > 0
              ? `${fmtFee(feeOwedPence)} joining fee due`
              : owedPence > 0
              ? `You owe £${(owedPence / 100).toFixed(2)}`
              : balancePence === null ? "Loading…" : `Team balance £${(balancePence / 100).toFixed(2)}`}
          </p>
        </button>
      </div>

      {showAvailability && hasSomething && (
        <AvailabilityModal
          request={request}
          myAnswer={myAnswer}
          userId={userId}
          teamId={teamId}
          matches={matches}
          onMatchChanged={reloadMatches}
          onClose={() => { setShowAvailability(false); reload(); reloadMatches(); }}
          onSubmitted={() => reload()}
        />
      )}

      {showTopUp && teamId && (
        <DuesTopUpModal
          teamId={teamId}
          userId={userId}
          onBalanceChange={setBalancePence}
          onClose={() => { setShowTopUp(false); reloadDues(); reloadFee(); }}
        />
      )}
    </>
  );
}
