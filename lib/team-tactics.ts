// A team's saved tactics presets (team_tactics), and the squad a preset can
// name. Moved unchanged out of components/my-team/TacticsTab.tsx so the mobile
// app reads presets — and loads one into a fixture — through the same code.
// The component re-exports both.

import { supabase } from "@/lib/supabase";

export type TeamTactic = {
  id: string;
  team_id: string;
  title: string;
  situation: string | null;
  formation: string;
  style: string | null;
  pressing: string | null;
  notes: string | null;
  /** { [formationSlotIndex]: player_id } — the same shape as match_tactics.lineup,
   *  so loading a preset into a fixture is a straight copy. */
  lineup: Record<number, string>;
};

/** Shared with Manage Match's "load from saved" picker. */
export async function loadTeamTactics(teamId: string): Promise<TeamTactic[] | null> {
  const { data, error } = await supabase
    .from("team_tactics")
    .select("id, team_id, title, situation, formation, style, pressing, notes, lineup")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false });
  // null means "the table isn't there", which the caller renders as a disabled
  // explanation. An empty array means "no presets yet" — a different message.
  if (error) return null;
  return ((data ?? []) as TeamTactic[]).map((t) => ({ ...t, lineup: t.lineup ?? {} }));
}

// ── The squad a preset can name ───────────────────────────────────────
export type SquadOption = { id: string; name: string; position: string | null };

/**
 * Everyone who could be put on the board: the captain plus every approved
 * member. The captain has no team_members row of their own, so they're fetched
 * and prepended — and teams.captain_id → profiles has no registered FK, so that
 * has to be a second query rather than an embedded select.
 */
export async function loadSquadOptions(teamId: string): Promise<SquadOption[]> {
  const { data: team } = await supabase
    .from("teams").select("captain_id").eq("id", teamId).maybeSingle();
  const { data: rows } = await supabase
    .from("team_members")
    .select("player_id, profiles(full_name, position)")
    .eq("team_id", teamId)
    .eq("status", "approved");

  const out: SquadOption[] = [];
  if (team?.captain_id) {
    const { data: cap } = await supabase
      .from("profiles").select("full_name, position").eq("id", team.captain_id).maybeSingle();
    out.push({ id: team.captain_id, name: cap?.full_name ?? "Captain", position: cap?.position ?? null });
  }
  const members = (rows ?? []) as unknown as {
    player_id: string; profiles: { full_name: string | null; position: string | null } | null;
  }[];
  for (const r of members) {
    if (r.player_id === team?.captain_id) continue;
    out.push({ id: r.player_id, name: r.profiles?.full_name ?? "Player", position: r.profiles?.position ?? null });
  }
  return out;
}
