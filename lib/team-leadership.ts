"use client";

// ── Who can act for a team ─────────────────────────────────────────────
// A team has one captain and any number of CO-CAPTAINS: approved squad
// members the captain has promoted (`team_members.is_co_captain`,
// supabase_co_captains.sql). A co-captain has the captain's authority
// everywhere except appointing other co-captains — that stays with the
// person who was handed the team.
//
// Two rules make that work without rewriting every query in the app:
//
//   1. "The team I run" is resolved HERE, not by `.eq("captain_id", user.id)`
//      at each call site — a co-captain doesn't captain any team, so that
//      lookup returns nothing for them.
//   2. Anything written under a captain's id — a match post, a challenge, an
//      availability poll, an announcement — is written under the TEAM'S
//      captain_id, even when a co-captain pressed the button. The fixture
//      belongs to the team either way, and every existing query that reads
//      `.eq("captain_id", …)` keeps finding it.
//
// The database enforces the same split independently: is_team_leader() gates
// the captain-only RPCs, and a trigger refuses any write to is_co_captain
// that doesn't come from the captain themselves.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type Leadership = {
  teamId: string;
  /** The team's real captain — who fixtures, posts and polls are filed under. */
  captainId: string;
  isCaptain: boolean;
  isCoCaptain: boolean;
  /** Captain or co-captain: may do everything except appoint co-captains. */
  canManage: boolean;
};

// Missing-migration guard, per the house convention: without
// supabase_co_captains.sql the `is_co_captain` column isn't there and a named
// select of it fails the whole query. Fall back to plain membership — nobody
// is a co-captain, everything else keeps working.
async function readMembership(userId: string) {
  const withFlag = await supabase
    .from("team_members")
    .select("team_id, is_co_captain")
    .eq("player_id", userId).eq("status", "approved").maybeSingle();
  if (!withFlag.error) {
    return {
      teamId: (withFlag.data?.team_id as string) ?? null,
      isCoCaptain: Boolean(withFlag.data?.is_co_captain),
    };
  }
  const { data } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("player_id", userId).eq("status", "approved").maybeSingle();
  return { teamId: (data?.team_id as string) ?? null, isCoCaptain: false };
}

// The viewer's team and what they're allowed to do with it, or null if they
// have no team at all. Captaining wins: one approved membership per player is
// an invariant, and a captain has no membership row of their own.
export async function loadLeadership(
  userId: string | null | undefined,
): Promise<Leadership | null> {
  if (!userId) return null;

  const { data: own } = await supabase
    .from("teams").select("id").eq("captain_id", userId).maybeSingle();
  if (own?.id) {
    return { teamId: own.id, captainId: userId, isCaptain: true, isCoCaptain: false, canManage: true };
  }

  const { teamId, isCoCaptain } = await readMembership(userId);
  if (!teamId) return null;

  const { data: team } = await supabase
    .from("teams").select("captain_id").eq("id", teamId).maybeSingle();

  return {
    teamId,
    captainId: (team?.captain_id as string) ?? userId,
    isCaptain: false,
    isCoCaptain,
    canManage: isCoCaptain,
  };
}

// Drop-in for `supabase.from("teams").select(cols).eq("captain_id", userId)`:
// the team row this user runs, as captain OR co-captain. Null for a plain
// squad player, which is the same answer the old lookup gave them.
export async function loadLedTeam<T = Record<string, unknown>>(
  userId: string | null | undefined,
  columns = "*",
): Promise<T | null> {
  const led = await loadLeadership(userId);
  if (!led?.canManage) return null;
  const { data } = await supabase
    .from("teams").select(columns).eq("id", led.teamId).maybeSingle();
  return (data as T) ?? null;
}

// The id every "captain_id" column should carry for this team, whoever is
// acting. Falls back to the acting user so a caller is never left with null.
export async function actingCaptainId(
  userId: string,
  teamId?: string | null,
): Promise<string> {
  if (teamId) {
    const { data } = await supabase
      .from("teams").select("captain_id").eq("id", teamId).maybeSingle();
    return (data?.captain_id as string) ?? userId;
  }
  const led = await loadLeadership(userId);
  return led?.captainId ?? userId;
}

// ── Appointing ─────────────────────────────────────────────────────────

export type CoCaptainRow = { playerId: string; name: string; isCoCaptain: boolean };

// The squad, minus the captain, with each member's current flag. Returns null
// when the migration hasn't been run so the panel can say so plainly.
export async function loadSquadForAppointment(teamId: string): Promise<CoCaptainRow[] | null> {
  const { data, error } = await supabase
    .from("team_members")
    .select("player_id, is_co_captain, profiles(full_name)")
    .eq("team_id", teamId).eq("status", "approved");
  if (error) return null;

  const rows = (data ?? []) as unknown as {
    player_id: string; is_co_captain: boolean | null;
    profiles: { full_name: string | null } | null;
  }[];

  return rows.map((r) => ({
    playerId: r.player_id,
    name: r.profiles?.full_name ?? "Player",
    isCoCaptain: Boolean(r.is_co_captain),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

// Captain-only — set_co_captain re-checks that in the database, so a forged
// call from anywhere else fails there rather than here.
export async function setCoCaptain(
  teamId: string, playerId: string, make: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("set_co_captain", {
    p_team_id: teamId, p_player_id: playerId, p_make: make,
  });
  if (!error) return { ok: true };
  return {
    ok: false,
    error: /function public\.set_co_captain|does not exist|schema cache/i.test(error.message)
      ? "Co-captains aren't set up yet — run supabase_co_captains.sql in Supabase."
      : error.message,
  };
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useLeadership(userId: string | null | undefined) {
  const [led, setLed] = useState<Leadership | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLed(await loadLeadership(userId));
    setLoading(false);
  }, [userId]);

  useEffect(() => { reload(); }, [reload]);

  return { ...(led ?? {
    teamId: null as string | null, captainId: null as string | null,
    isCaptain: false, isCoCaptain: false, canManage: false,
  }), loading, reload };
}
