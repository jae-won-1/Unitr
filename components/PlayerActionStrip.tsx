"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import DuesTopUpModal, { useMyDues } from "@/components/DuesTopUpModal";
import AvailabilityModal, { useAvailabilityPoll } from "@/components/AvailabilityModal";

// The two things a captain actually asks of a squad player: answer the
// availability poll, and put money in. Both resolve in a popup — a player who
// taps here never leaves home and never loses their place in the feed.

export default function PlayerActionStrip({ teamId, userId }: { teamId: string | null; userId: string }) {
  const { request, myAnswer, loading, reload } = useAvailabilityPoll(teamId, userId);
  const { owedPence, reload: reloadDues } = useMyDues(teamId, userId);
  const [balancePence, setBalancePence] = useState<number | null>(null);
  const [showAvailability, setShowAvailability] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);

  useEffect(() => {
    if (!teamId) return;
    supabase.from("team_credits").select("balance_pence").eq("team_id", teamId).maybeSingle()
      .then(({ data }) => setBalancePence(data?.balance_pence ?? 0));
  }, [teamId]);

  const needsAnswer = !!request && myAnswer === null;

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {/* ── Availability ── */}
        <button
          type="button"
          onClick={() => request && setShowAvailability(true)}
          disabled={!request}
          className={`relative rounded-2xl p-4 text-left border transition-colors ${
            needsAnswer
              ? "bg-orange-500/10 border-orange-500/30"
              : "bg-surface-2 border-border"
          } ${!request ? "opacity-60 cursor-default" : ""}`}
        >
          {needsAnswer && <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-orange-400" />}
          <div className={`w-9 h-9 rounded-full flex items-center justify-center mb-2 ${needsAnswer ? "bg-orange-500/20" : "bg-accent/10 border border-accent/30"}`}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={needsAnswer ? "#FB923C" : "#00E676"} strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
            </svg>
          </div>
          <p className="text-sm font-bold leading-tight">Submit Availability</p>
          <p className="text-[11px] text-text-secondary mt-1 leading-tight">
            {loading ? "Checking…"
              : !request ? "No open request"
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
            owedPence > 0 ? "bg-red-500/10 border-red-500/30" : "bg-surface-2 border-border"
          }`}
        >
          {owedPence > 0 && <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-red-400" />}
          <div className={`w-9 h-9 rounded-full flex items-center justify-center mb-2 ${owedPence > 0 ? "bg-red-500/20" : "bg-accent/10 border border-accent/30"}`}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={owedPence > 0 ? "#F87171" : "#00E676"} strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/>
            </svg>
          </div>
          <p className="text-sm font-bold leading-tight">Top Up Team Credit</p>
          <p className={`text-[11px] mt-1 leading-tight ${owedPence > 0 ? "text-red-400 font-semibold" : "text-text-secondary"}`}>
            {owedPence > 0
              ? `You owe £${(owedPence / 100).toFixed(2)}`
              : balancePence === null ? "Loading…" : `Team balance £${(balancePence / 100).toFixed(2)}`}
          </p>
        </button>
      </div>

      {showAvailability && request && (
        <AvailabilityModal
          request={request}
          myAnswer={myAnswer}
          userId={userId}
          onClose={() => { setShowAvailability(false); reload(); }}
          onSubmitted={() => reload()}
        />
      )}

      {showTopUp && teamId && (
        <DuesTopUpModal
          teamId={teamId}
          userId={userId}
          onBalanceChange={setBalancePence}
          onClose={() => { setShowTopUp(false); reloadDues(); }}
        />
      )}
    </>
  );
}
