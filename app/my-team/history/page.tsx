"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type HistoryFixture = {
  postId: string;
  matchRowId: string | null;
  opponent: string;
  date: string;
  time: string;
  pitch: string;
  paymentStatus: "paid" | "unpaid";
};

function fmtDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export default function MatchHistoryPage() {
  const { user } = useAuth();
  const [fixtures, setFixtures] = useState<HistoryFixture[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    async function load() {
      // Resolve the captain id this player's history is tied to (their own
      // id if they captain a team, otherwise their team's captain).
      let captainId: string | undefined = user!.id;
      const { data: ownTeam } = await supabase.from("teams").select("id").eq("captain_id", user!.id).maybeSingle();
      if (!ownTeam) {
        const { data: membership } = await supabase.from("team_members")
          .select("team_id").eq("player_id", user!.id).eq("status", "approved").maybeSingle();
        if (!membership?.team_id) { setLoading(false); return; }
        const { data: team } = await supabase.from("teams").select("captain_id").eq("id", membership.team_id).maybeSingle();
        captainId = team?.captain_id;
      }
      if (!captainId) { setLoading(false); return; }

      // Matches where this team posted and was challenged
      const { data: myPosts } = await supabase.from("match_posts")
        .select("id, match_date, match_time").eq("captain_id", captainId).eq("status", "matched");

      const posterFixtures = await Promise.all(
        (myPosts ?? []).map(async (post) => {
          const { data: ch } = await supabase.from("challenges")
            .select("challenger_team_name, selected_pitch").eq("post_id", post.id).eq("status", "accepted").maybeSingle();
          return {
            postId: post.id,
            opponent: (ch as { challenger_team_name: string } | null)?.challenger_team_name ?? "Unknown",
            date: post.match_date,
            time: post.match_time,
            pitch: ((ch as { selected_pitch?: { name: string } } | null)?.selected_pitch?.name) ?? "TBC",
          };
        })
      );

      // Matches where this team challenged another team's post
      const { data: myChallenges } = await supabase.from("challenges")
        .select("post_id, selected_pitch").eq("challenger_captain_id", captainId).eq("status", "accepted");

      const challengerFixtures = await Promise.all(
        (myChallenges ?? []).map(async (c) => {
          const { data: post } = await supabase.from("match_posts")
            .select("id, team_name, match_date, match_time").eq("id", c.post_id).maybeSingle();
          return {
            postId: c.post_id,
            opponent: (post as { team_name: string } | null)?.team_name ?? "Unknown",
            date: (post as { match_date: string } | null)?.match_date ?? "",
            time: (post as { match_time: string } | null)?.match_time ?? "",
            pitch: (c.selected_pitch as { name: string } | null)?.name ?? "TBC",
          };
        })
      );

      const all = [...posterFixtures, ...challengerFixtures];

      // Only matches that have already kicked off belong in history.
      const today = new Date().toISOString().split("T")[0];
      const past = all.filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.date) && f.date < today);

      const { data: rows } = past.length > 0
        ? await supabase.from("matches").select("id, post_id").in("post_id", past.map((f) => f.postId))
        : { data: [] };
      const byPostId = new Map((rows ?? []).map((r) => [r.post_id, r.id]));

      const { data: payments } = past.length > 0
        ? await supabase.from("player_payments").select("booking_id").eq("player_id", user!.id).eq("status", "paid").in("booking_id", past.map((f) => f.postId))
        : { data: [] };
      const paidIds = new Set((payments ?? []).map((p) => p.booking_id));

      const withRows: HistoryFixture[] = past
        .map((f) => ({
          ...f,
          matchRowId: byPostId.get(f.postId) ?? null,
          paymentStatus: (paidIds.has(f.postId) ? "paid" : "unpaid") as "paid" | "unpaid",
        }))
        .sort((a, b) => b.date.localeCompare(a.date));

      setFixtures(withRows);
      setLoading(false);
    }
    load();
  }, [user]);

  return (
    <div className="flex flex-col min-h-screen px-4 pt-12 pb-8">
      <div className="flex items-center gap-3 mb-6">
        <a href="/my-team">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </a>
        <div>
          <h1 className="text-xl font-bold">Match History</h1>
          <p className="text-xs text-text-secondary">Past fixtures for your team</p>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" /></div>
      ) : fixtures.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <div className="w-16 h-16 rounded-full bg-surface-2 border border-border flex items-center justify-center">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          </div>
          <p className="font-semibold">No match history yet</p>
          <p className="text-sm text-text-secondary max-w-[240px]">Played fixtures will show up here once a confirmed match date has passed.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {fixtures.map((f) => (
            <div key={f.postId} className="bg-surface-2 border border-border rounded-2xl p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-semibold text-sm">vs {f.opponent}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-text-secondary">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                    {fmtDate(f.date)} · {f.time}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-text-secondary">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    {f.pitch}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  <span className="text-[10px] font-semibold bg-surface border border-border text-text-secondary px-2 py-0.5 rounded-full">Completed</span>
                  {f.paymentStatus === "paid"
                    ? <span className="text-[10px] font-semibold bg-green-500/10 text-green-400 border border-green-500/30 px-2 py-0.5 rounded-full">Paid ✓</span>
                    : <span className="text-[10px] font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded-full">Unpaid</span>
                  }
                </div>
              </div>
              {f.matchRowId && (
                <a href={`/my-team/match/${f.matchRowId}`} className="block w-full mt-3 py-2 rounded-xl border border-border text-xs font-semibold text-text-secondary text-center">
                  View Details
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
