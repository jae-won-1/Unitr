"use client";

// ── Leaving the squad ─────────────────────────────────────────────────
// The last thing on My Team, and the only destructive control on it, so it is
// red, it is separated from the tabs above, and it asks a second time before
// anything happens — a mis-tap here costs somebody their place in a team.
//
// The captain sees it greyed rather than absent, per the house convention in
// QuickNav: a control that disappears for one role moves everything around it
// for the other. They can't leave — they hold the team (lib/leave-team says
// why) — so the button says so instead of failing when pressed.
//
// The confirmation names what leaving actually costs, and the two things
// people are surprised by afterwards: money already owed stays owed, and a
// joining fee is charged again on the way back in.

import { useState } from "react";
import { fmtFee } from "@/lib/joining-fee";
import { useAvailabilityGate, owedSummary } from "@/lib/availability-gate";
import { leaveTeam } from "@/lib/leave-team";
import { hardNavigate } from "@/lib/hard-navigate";

export default function LeaveTeamPanel({
  teamId, teamName, userId, isCaptain, joiningFeePence,
}: {
  teamId: string;
  teamName: string;
  userId: string;
  isCaptain: boolean;
  joiningFeePence?: number | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The same debts the availability gate weighs — the joining fee and the
  // share of games already played. Read here only to warn: leaving is not
  // blocked by owing money, because trapping someone in a squad is not how a
  // debt gets collected, and the captain's Payment Status keeps listing them
  // either way.
  const gate = useAvailabilityGate(isCaptain ? null : teamId, isCaptain ? null : userId);
  const owes = !gate.loading && gate.blocked ? owedSummary(gate) : "";
  const fee = joiningFeePence ?? 0;

  const handleLeave = async () => {
    setBusy(true);
    setError(null);
    const res = await leaveTeam(teamId, userId);
    if ("error" in res) {
      setBusy(false);
      setError(res.error);
      return;
    }
    // A full document load, not a router push: role, team and every cached
    // query on this device belong to a membership that no longer exists.
    hardNavigate("/my-team");
  };

  return (
    <section className="mt-8 pt-5 border-t border-border">
      {isCaptain ? (
        <>
          <div className="w-full py-2.5 rounded-btn border border-border text-center text-sm font-semibold text-text-secondary opacity-60">
            Leave team
          </div>
          <p className="text-[11px] text-text-secondary text-center mt-2">
            You captain {teamName}, so you can&apos;t leave it.
          </p>
        </>
      ) : !confirming ? (
        <button onClick={() => { setConfirming(true); setError(null); }}
          className="w-full py-2.5 rounded-btn border border-red-500/30 text-red-600 text-sm font-semibold">
          Leave team
        </button>
      ) : (
        <div className="bg-surface border border-red-500/30 shadow-card rounded-card p-4">
          <p className="text-sm font-semibold">Leave {teamName}?</p>
          <p className="text-[11px] text-text-secondary mt-1">
            You lose your place in the squad and the team chat, and any game you&apos;d said you
            could play is withdrawn. You can ask to join again later.
          </p>
          {owes && (
            <p className="text-[11px] text-text-secondary mt-2">
              Leaving doesn&apos;t clear {owes} — you still owe it.
            </p>
          )}
          {fee > 0 && (
            <p className="text-[11px] text-text-secondary mt-2">
              If you rejoin, you&apos;ll be asked for the {fmtFee(fee)} joining fee again.
            </p>
          )}
          {error && <p className="text-[11px] text-red-600 mt-2">{error}</p>}
          <div className="flex gap-2 mt-3">
            <button onClick={() => { setConfirming(false); setError(null); }} disabled={busy}
              className="flex-1 py-2 rounded-xl border border-border text-xs font-semibold disabled:opacity-40">
              Stay in the team
            </button>
            <button onClick={handleLeave} disabled={busy}
              className="flex-1 py-2 rounded-xl bg-red-500 text-white text-xs font-bold disabled:opacity-40">
              {busy ? "Leaving…" : "Yes, leave"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
