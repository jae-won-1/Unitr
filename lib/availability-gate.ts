"use client";

// ── Who is allowed to put themselves forward for a game ────────────────
// Two debts, one rule. A player may not claim a place in a game while they
// owe the team money:
//
//   1. their joining fee (lib/joining-fee.ts), and
//   2. their share of games they've already played — the outstanding
//      payment_collection_status rows the captain has issued.
//
// The second is the one that bites repeatedly: a player who never settles up
// keeps taking a shirt while the team's credit pays for their pitch. Both are
// the same charge in the end, since paying either is a top-up into team
// credit, so both are asked in the same breath and paid through the same Top
// Up button.
//
// ONLY THE "AVAILABLE" ANSWER IS GATED. Saying you're out claims nothing and
// costs the team nothing, and blocking it turned a real "I can't play" into a
// silence the captain read as "hasn't replied". So this module answers one
// narrow question — may this player claim a place? — and the Unavailable
// button never asks it.
//
// This is the only place the rule lives; AvailabilityButtons (fixture answers)
// and AvailabilityModal (the poll) both read it, so the two can't drift.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmtFee, getJoiningFeeStatus } from "@/lib/joining-fee";

export type AvailabilityGate = {
  feeOwedPence: number;
  duesOwedPence: number;
  /** Owes something, so can't vote available. */
  blocked: boolean;
};

const CLEAR: AvailabilityGate = { feeOwedPence: 0, duesOwedPence: 0, blocked: false };

// ── The dues half ─────────────────────────────────────────────────────
// Deliberately narrower than useMyDues in components/DuesTopUpModal.tsx: that
// one resolves opponents, dates and per-charge ids because it renders a payable
// list, and lives in a file that pulls in Stripe. A gate on a fixture card only
// needs the total, so it asks for the two columns that make it.
//
// Every outstanding row is a game already played — Settle Payments issues a
// request for who *did* play — so there's no date filter here. Scoped to the
// team, because a debt is owed to a squad, not to football in general.
async function loadDuesOwed(teamId: string, playerId: string): Promise<number> {
  const { data, error } = await supabase
    .from("payment_collection_status")
    .select("share_pence, credited_pence")
    .eq("team_id", teamId)
    .eq("player_id", playerId)
    .eq("included", true)
    .eq("received", false);

  // House rule: a missing table or column degrades to "owes nothing" rather
  // than locking the squad out of a vote they're entitled to.
  if (error || !data) return 0;

  return data.reduce((sum, row) => {
    const remaining = (row.share_pence ?? 0) - (row.credited_pence ?? 0);
    return sum + Math.max(0, remaining);
  }, 0);
}

// Every card in an availability list asks this same question at the same
// moment, and the answer is identical for all of them — it's keyed on the
// player and their team, not on the fixture. So concurrent callers share one
// round trip. Only the IN-FLIGHT promise is shared, never a settled one: the
// answer changes the instant the player pays, and a cached "still owes" would
// leave the buttons greyed after they had.
const inFlight = new Map<string, Promise<AvailabilityGate>>();

export async function loadAvailabilityGate(
  teamId: string | null | undefined,
  playerId: string | null | undefined,
): Promise<AvailabilityGate> {
  if (!teamId || !playerId) return CLEAR;

  const key = `${teamId}:${playerId}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const run = (async () => {
    const [fee, duesOwedPence] = await Promise.all([
      getJoiningFeeStatus(teamId, playerId),
      loadDuesOwed(teamId, playerId),
    ]);
    const feeOwedPence = fee.owedPence;
    return { feeOwedPence, duesOwedPence, blocked: feeOwedPence + duesOwedPence > 0 };
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, run);
  return run;
}

export function useAvailabilityGate(
  teamId: string | null | undefined,
  playerId: string | null | undefined,
) {
  const [gate, setGate] = useState<AvailabilityGate>(CLEAR);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setGate(await loadAvailabilityGate(teamId, playerId));
    setLoading(false);
  }, [teamId, playerId]);

  useEffect(() => { reload(); }, [reload]);

  return { ...gate, loading, reload };
}

/**
 * What the player owes, as a noun phrase — "your £20 joining fee and £6 for
 * games you've played". One sentence fragment rather than a finished sentence
 * so each surface can frame it in its own voice, and one function so the fixture
 * card and the poll can't end up naming different debts.
 */
export function owedSummary(gate: AvailabilityGate): string {
  const parts: string[] = [];
  if (gate.feeOwedPence > 0) parts.push(`your ${fmtFee(gate.feeOwedPence)} joining fee`);
  if (gate.duesOwedPence > 0) parts.push(`${fmtFee(gate.duesOwedPence)} for games you've played`);
  return parts.join(" and ");
}
