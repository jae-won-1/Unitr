// The Fill In (ringer) feed's data layer: open one-off guest spots a viewer
// could pay into and join.
//
// Extracted out of components/RingerFeed.tsx so the mobile app can share it —
// same reasoning as lib/game-feed.ts. The hook was always pure data (a
// Supabase query, shaping, no JSX and no DOM), so the move is a lift, not a
// rewrite, and RingerFeed.tsx re-exports what it used to own so nothing
// importing from there had to change. The checkout itself (Stripe Elements,
// confirmCardPayment) stays in components/RingerFeed.tsx — that part is
// genuinely web-only until the mobile app's own Phase 3 payment work lands.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { isUpcomingDate, sortKey, toDateKey } from "@/lib/match-dates";
import { loadLeadership } from "@/lib/team-leadership";

export type RingerPost = {
  id: string;
  matchId: string;
  teamId: string;
  teamName: string;
  opponentName: string;
  date: string;
  time: string;
  pitch: string;
  positions: string[];
  spotsLeft: number;
  pricePence: number;
  notes: string | null;
  joined: boolean;
};

// Display-only, and small enough that both apps can share it directly rather
// than each keeping their own copy.
export function fmtRingerDate(raw: string): string {
  const key = toDateKey(raw);
  if (!key) return raw;
  return new Date(`${key}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

// ── Data ──────────────────────────────────────────────────────
// Loaded in separate queries rather than embedded selects: teams/matches have
// no FK relationship registered with ringer_requests in the schema cache, and
// an embed that can't resolve fails the WHOLE query (PGRST200).
export function useRingerPosts(userId: string | undefined) {
  const [posts, setPosts] = useState<RingerPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    const { data: requests, error } = await supabase
      .from("ringer_requests")
      .select("id, match_id, team_id, positions, spots, notes, price_pence, status")
      .eq("status", "open");

    // Migration not run yet — show the empty state rather than a broken tab.
    if (error) { setUnavailable(true); setPosts([]); setLoading(false); return; }
    if (!requests || requests.length === 0) { setPosts([]); setLoading(false); return; }

    const matchIds = [...new Set(requests.map((r) => r.match_id))];
    const [{ data: matches }, { data: signups }] = await Promise.all([
      supabase.from("matches")
        .select("id, posting_team_id, challenging_team_id, match_date, match_time, confirmed_pitch")
        .in("id", matchIds),
      supabase.from("ringer_signups").select("request_id, player_id").in("request_id", requests.map((r) => r.id)),
    ]);

    const teamIds = [...new Set((matches ?? []).flatMap((m) => [m.posting_team_id, m.challenging_team_id]))];
    const { data: teams } = teamIds.length
      ? await supabase.from("teams").select("id, name").in("id", teamIds)
      : { data: [] as { id: string; name: string }[] };
    const teamName = new Map((teams ?? []).map((t) => [t.id, t.name as string]));
    const matchById = new Map((matches ?? []).map((m) => [m.id, m]));

    // The viewer's own team, so their captain's request isn't offered back to
    // them — they're already in that squad.
    let myTeamId: string | null = null;
    if (userId) {
      myTeamId = (await loadLeadership(userId))?.teamId ?? null;
    }

    const mapped: RingerPost[] = [];
    for (const r of requests) {
      const m = matchById.get(r.match_id);
      if (!m) continue;
      if (!isUpcomingDate(m.match_date)) continue;
      if (myTeamId && r.team_id === myTeamId) continue;

      const taken = (signups ?? []).filter((s) => s.request_id === r.id);
      const joined = !!userId && taken.some((s) => s.player_id === userId);
      const spotsLeft = Math.max(0, (r.spots ?? 1) - taken.length);
      if (spotsLeft === 0 && !joined) continue;

      const opponentId = r.team_id === m.posting_team_id ? m.challenging_team_id : m.posting_team_id;
      mapped.push({
        id: r.id,
        matchId: r.match_id,
        teamId: r.team_id,
        teamName: teamName.get(r.team_id) ?? "Team",
        opponentName: teamName.get(opponentId) ?? "Opponent",
        date: m.match_date,
        time: m.match_time,
        pitch: (m.confirmed_pitch as { name?: string } | null)?.name ?? "TBC",
        positions: r.positions ?? [],
        spotsLeft,
        pricePence: r.price_pence ?? 500,
        notes: r.notes,
        joined,
      });
    }

    mapped.sort((a, b) => sortKey(a.date, a.time).localeCompare(sortKey(b.date, b.time)));
    setPosts(mapped);
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  return { posts, loading, unavailable, reload: load };
}
