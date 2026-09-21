// The discovery feed's data layer: what open matches and multi-team events a
// viewer could join, and the squad-suggestion list that sits beside them.
//
// This was extracted out of components/GameFeed.tsx so the mobile app can share
// it. The hooks below were always pure data — Supabase queries, shaping and
// optimistic updates, no JSX and no DOM — so the move is a lift, not a rewrite,
// and GameFeed.tsx re-exports what it used to own so nothing importing from
// there had to change.
//
// The types come with them. MatchPost and PitchOption previously lived in
// components/ChallengePanel.tsx, which is the wrong direction of dependency for
// shared code: a data module cannot reasonably import from a React component
// that a phone will never render. ChallengePanel now re-exports them from here.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmtKickoff, isKickoffPast } from "@/lib/match-dates";

// ── Types ─────────────────────────────────────────────────────

export type PitchOption = {
  id: string;
  name: string;
  address: string;
  price: number;
  format: string;
  distance: string;
  // Optional per-pitch kickoff time. Older posts won't have it → fall back to the post time.
  time?: string;
};

export type MatchPost = {
  id: string;
  team_id: string;
  captain_id: string;
  team: string;
  location: string;
  date: string;
  match_date: string;
  match_time: string;
  pitchOptions: PitchOption[];
  description: string;
  availabilityMatch: boolean;
  status: string;
  payment_mode: string;
  pitchSecured: boolean;
  securedBookingId: string | null;
};

export type Tournament = {
  id: string;
  title: string;
  // 'tournament' | 'league' | 'match' — this tab carries all multi-team events.
  matchType: string;
  pitchName: string;
  matchDate: string;
  startTime: string;
  format: string | null;
  skillLevel: string;
  pricePerTeamPence: number;
  maxTeams: number;
  joinedCount: number;
  // Null for venue-hosted tournaments.
  organiserTeamName: string | null;
  // Set on admin-hosted (Uniter staff) events.
  organiserAdminName: string | null;
  // Teams already bought in — so the card can say "you're entered" instead of
  // offering the buy-in again.
  joinedTeamIds: string[];
  // Pending-invitation discount off the buy-in for the viewer's team (0 if none).
  inviteDiscountPence: number;
};

// ── Suggestions ───────────────────────────────────────────────
// Mirrors RingerFeed's handling of an unrun migration: a missing table
// disables the button with an explanation rather than throwing.
export function useSuggestions(teamId: string | null, userId: string) {
  const [suggested, setSuggested] = useState<Set<string>>(new Set());
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!teamId) return;
    supabase.from("match_suggestions").select("post_id").eq("team_id", teamId)
      .then(({ data, error }) => {
        if (error) { setUnavailable(true); return; }
        setSuggested(new Set((data ?? []).map((r) => r.post_id as string)));
      });
  }, [teamId]);

  const suggest = useCallback(async (postId: string, kind: "match" | "tournament") => {
    if (!teamId) return;
    setSuggested((prev) => new Set(prev).add(postId));
    const { error } = await supabase.from("match_suggestions").insert({
      team_id: teamId, suggested_by: userId, kind, post_id: postId,
    });
    // A duplicate is the desired end state anyway — only a real failure rolls back.
    if (error && !error.message.includes("duplicate")) {
      setSuggested((prev) => { const next = new Set(prev); next.delete(postId); return next; });
      setUnavailable(true);
    }
  }, [teamId, userId]);

  return { suggested, unavailable, suggest };
}

// ── Data ──────────────────────────────────────────────────────
// Selects the full post shape, not just what the card renders: a captain can
// open ChallengePanel straight from this feed, and that needs the pitch options,
// payment mode and secured-booking fields.
export function useOpenMatchPosts(teamId: string | null) {
  const [posts, setPosts] = useState<MatchPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("match_posts")
      .select("*")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setPosts(
          (data ?? [])
            .filter((r) => r.team_id !== teamId && !isKickoffPast(r.match_date, r.match_time))
            .map((r) => ({
              id: r.id,
              team_id: r.team_id,
              captain_id: r.captain_id,
              team: r.team_name,
              location: r.team_location ?? "",
              date: fmtKickoff(r.match_date, r.match_time),
              match_date: r.match_date,
              match_time: r.match_time,
              pitchOptions: (r.pitch_options ?? []) as PitchOption[],
              description: r.description ?? "",
              availabilityMatch: false,
              status: r.status,
              payment_mode: r.payment_mode ?? "credit",
              pitchSecured: Boolean(r.pitch_secured),
              securedBookingId: r.secured_booking_id ?? null,
            }))
        );
        setLoading(false);
      });
  }, [teamId]);

  const removePost = (id: string) => setPosts((prev) => prev.filter((p) => p.id !== id));

  return { posts, loading, removePost };
}

export function useOpenTournaments(teamId: string | null) {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const baseCols = "id, title, match_type, pitch_name, match_date, start_time, format, skill_level, price_per_team_pence, max_teams, organiser_team_id, organiser_team_name";
      let { data: oms, error: omErr } = await supabase.from("open_matches")
        .select(`${baseCols}, organiser_admin_name`)
        .in("match_type", ["tournament", "league", "match"])
        .neq("status", "cancelled")
        .order("match_date", { ascending: true });
      // 42703: supabase_admin_hosting.sql not run yet — retry without the admin column.
      if (omErr?.code === "42703") {
        const { data: legacy } = await supabase.from("open_matches")
          .select(baseCols)
          .in("match_type", ["tournament", "league", "match"])
          .neq("status", "cancelled")
          .order("match_date", { ascending: true });
        oms = (legacy ?? []).map((m) => ({ ...m, organiser_admin_name: null }));
      }

      // Hide the viewer's own hosted events; the !teamId branch keeps venue- and
      // admin-hosted posts (organiser_team_id null) visible to teamless viewers.
      const active = (oms ?? []).filter(
        (m) => (!teamId || m.organiser_team_id !== teamId) && !isKickoffPast(m.match_date, m.start_time)
      );

      // Pending invitations for the viewer's team → discount per tournament.
      const discountByTournament = new Map<string, number>();
      if (teamId) {
        const { data: invites } = await supabase.from("tournament_invitations")
          .select("open_match_id, discount_pence").eq("team_id", teamId).eq("status", "pending");
        for (const inv of invites ?? []) discountByTournament.set(inv.open_match_id as string, inv.discount_pence ?? 0);
      }

      const withCounts = await Promise.all(active.map(async (m) => {
        const { data: joined } = await supabase.from("open_match_teams")
          .select("team_id").eq("open_match_id", m.id);
        const joinedTeamIds = (joined ?? []).map((x) => x.team_id as string);
        return {
          id: m.id,
          title: m.title,
          matchType: m.match_type ?? "tournament",
          pitchName: m.pitch_name,
          matchDate: m.match_date,
          startTime: m.start_time,
          format: m.format,
          skillLevel: m.skill_level,
          pricePerTeamPence: m.price_per_team_pence,
          maxTeams: m.max_teams,
          joinedCount: joinedTeamIds.length,
          organiserTeamName: m.organiser_team_name ?? null,
          organiserAdminName: ("organiser_admin_name" in m ? m.organiser_admin_name : null) ?? null,
          joinedTeamIds,
          inviteDiscountPence: discountByTournament.get(m.id) ?? 0,
        } as Tournament;
      }));

      setTournaments(withCounts);
      setLoading(false);
    }
    load();
  }, [teamId]);

  // Optimistically mark the viewer's team as entered after a successful buy-in.
  const markJoined = (id: string, joinedTeamId: string) => setTournaments((prev) => prev.map((t) =>
    t.id === id && !t.joinedTeamIds.includes(joinedTeamId)
      ? { ...t, joinedCount: t.joinedCount + 1, joinedTeamIds: [...t.joinedTeamIds, joinedTeamId] }
      : t
  ));

  return { tournaments, loading, markJoined };
}
