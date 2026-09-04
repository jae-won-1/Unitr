"use client";

// ── Joining fee status, from the player's side ─────────────────────────
// One question, asked from several surfaces (PlayerActionStrip, the top-up
// modal, availability voting): "does this player still owe their joining
// fee?". The columns live on team_members and are only ever advanced
// server-side by credit_from_payment / record_cash_credit
// (supabase_joining_fees.sql) — this module just reads them.
//
// A captain has no team_members row, so their copy of the same two numbers
// lives on `teams` (captain_joining_fee_*, supabase_captain_joining_fee.sql)
// and is read from there. The captain plays in the games the fee pays for, so
// they owe it like anyone else. If either migration hasn't been run the select
// fails on the missing columns; per the house convention that degrades (owed
// 0, everything stays enabled) rather than crashing the surface that asked.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type JoiningFeeStatus = {
  duePence: number;   // snapshot owed at approval
  paidPence: number;  // how much of it is covered
  owedPence: number;  // due - paid, floored at 0
};

const NOTHING_OWED: JoiningFeeStatus = { duePence: 0, paidPence: 0, owedPence: 0 };

// "£20" for whole pounds, "£12.50" otherwise.
export function fmtFee(pence: number): string {
  return `£${(pence / 100).toFixed(2).replace(/\.00$/, "")}`;
}

export async function getJoiningFeeStatus(
  teamId: string | null | undefined,
  playerId: string | null | undefined,
): Promise<JoiningFeeStatus> {
  if (!teamId || !playerId) return NOTHING_OWED;
  const { data, error } = await supabase
    .from("team_members")
    .select("joining_fee_due_pence, joining_fee_paid_pence")
    .eq("team_id", teamId)
    .eq("player_id", playerId)
    .eq("status", "approved")
    .maybeSingle();

  if (!error && data) {
    const due = data.joining_fee_due_pence ?? 0;
    const paid = data.joining_fee_paid_pence ?? 0;
    return { duePence: due, paidPence: paid, owedPence: Math.max(0, due - paid) };
  }

  // No membership row: either the migration is missing (error) or this is the
  // team's captain, whose own fee is snapshotted onto the team.
  return getCaptainFeeStatus(teamId, playerId);
}

async function getCaptainFeeStatus(teamId: string, playerId: string): Promise<JoiningFeeStatus> {
  // select("*") rather than named columns so a team row still reads back when
  // supabase_captain_joining_fee.sql hasn't been run.
  const { data } = await supabase
    .from("teams").select("*").eq("id", teamId).eq("captain_id", playerId).maybeSingle();
  if (!data) return NOTHING_OWED;            // not the captain
  const due = (data.captain_joining_fee_due_pence as number | null) ?? 0;
  const paid = (data.captain_joining_fee_paid_pence as number | null) ?? 0;
  return { duePence: due, paidPence: paid, owedPence: Math.max(0, due - paid) };
}

export function useJoiningFee(
  teamId: string | null | undefined,
  playerId: string | null | undefined,
) {
  const [status, setStatus] = useState<JoiningFeeStatus>(NOTHING_OWED);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setStatus(await getJoiningFeeStatus(teamId, playerId));
    setLoading(false);
  }, [teamId, playerId]);

  useEffect(() => { reload(); }, [reload]);

  return { ...status, loading, reload };
}
