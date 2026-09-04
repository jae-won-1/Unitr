"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmtKickoff, isKickoffPast } from "@/lib/match-dates";
import { type MatchPost, type PitchOption } from "@/components/ChallengePanel";
import { loadLeadership } from "@/lib/team-leadership";
import { takeDownPost } from "@/lib/take-down-post";

// A captain's own open match post. It is status rather than feed content —
// "is anyone biting?" — so it sits above the Matches feed on the home screen
// and at the top of the Play tab, never in the list of games to join.

// Every still-open post this captain owns. Challenges are accepted the moment
// a team confirms (see ChallengePanel), so an open post has had no takers yet —
// there is no pending-challenge queue to count.
// Takes the acting user — a co-captain sees (and can take down) the team's
// posts, which are filed under the captain's id whoever pressed Post.
export function useMyPosts(userId?: string) {
  const [posts, setPosts] = useState<MatchPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const led = await loadLeadership(userId);
      const captainId = led?.canManage ? led.captainId : userId;
      const { data } = await supabase
        .from("match_posts")
        .select("*")
        .eq("captain_id", captainId)
        .eq("status", "open")
        .order("created_at", { ascending: false });
      if (cancelled) return;
      setPosts((data ?? []).map((row) => ({
        id: row.id,
        team_id: row.team_id,
        captain_id: row.captain_id,
        team: row.team_name,
        location: row.team_location ?? "",
        date: fmtKickoff(row.match_date, row.match_time),
        match_date: row.match_date,
        match_time: row.match_time,
        pitchOptions: (row.pitch_options ?? []) as PitchOption[],
        description: row.description ?? "",
        availabilityMatch: false,
        status: row.status,
        payment_mode: row.payment_mode ?? "credit",
        pitchSecured: Boolean(row.pitch_secured),
        securedBookingId: row.secured_booking_id ?? null,
      })).filter((p) => !isKickoffPast(p.match_date, p.match_time)));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const removePost = (id: string) => setPosts((prev) => prev.filter((p) => p.id !== id));
  return { posts, loading, removePost };
}

// ── My Post Card (captain's own posts) ────────────────────────
export default function MyPostCard({ post, onRemoved }: { post: MatchPost; onRemoved: (id: string) => void }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [takingDown, setTakingDown] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Goes through /api/posts/take-down like the admin's moderation list — the
  // route is what releases the credit earmark and hands a secured booking back,
  // and doing it in two places is how those two stop matching.
  const handleTakeDown = async () => {
    setTakingDown(true);
    setError(null);
    const err = await takeDownPost(post.id);
    setTakingDown(false);
    if (err) { setError(err); return; }
    setShowConfirm(false);
    onRemoved(post.id);
  };

  const initials = post.team.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="border border-indigo-500/40 bg-indigo-500/5 rounded-2xl p-4">
      <div className="flex items-center gap-1.5 mb-3">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" className="text-indigo-600">
          <path d="M12 2a5 5 0 0 0-5 5c0 3.5 5 11 5 11s5-7.5 5-11a5 5 0 0 0-5-5zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/>
        </svg>
        <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">Your Post</span>
      </div>

      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-accent-ink">{initials}</span>
          </div>
          <div>
            <p className="text-sm font-bold">{post.team}</p>
            <p className="text-xs text-text-secondary mt-0.5">{post.location || "Location TBC"}</p>
          </div>
        </div>
        {post.pitchSecured && (
          <span className="text-[10px] font-semibold bg-green-500/10 text-green-600 border border-green-500/30 px-2 py-0.5 rounded-full flex items-center gap-1 flex-shrink-0">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
            Pitch Secured
          </span>
        )}
      </div>

      <div className="flex items-center gap-1 text-xs text-text-secondary mb-3">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
        {post.date}
      </div>

      {post.pitchOptions.length > 0 && (
        <div className="bg-background rounded-xl px-3 py-2 mb-3">
          <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">Your Pitch Options</p>
          <div className="space-y-1">
            {post.pitchOptions.map((p, i) => (
              <div key={p.id} className="flex items-center gap-2 text-xs text-text-secondary">
                <span className="w-4 h-4 rounded-full bg-surface-2 border border-border flex items-center justify-center text-[9px] font-bold flex-shrink-0">{i + 1}</span>
                <span className="truncate">{p.name}</span>
                <span className="text-accent-ink font-medium flex-shrink-0">£{p.price}/hr</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-text-secondary mb-3">
        <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
        Waiting for a challenge…
      </div>
      <div className="flex gap-2">
        <button onClick={() => setShowConfirm(true)}
          className="flex-1 py-2.5 rounded-xl border border-red-500/30 text-red-600 text-sm font-semibold flex items-center justify-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          Take Down Post
        </button>
        <a href={`/play/edit/${post.id}`}
          className="flex-1 py-2.5 rounded-btn bg-accent text-white text-sm font-bold flex items-center justify-center gap-1.5">
          View Your Post
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </a>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim px-6">
          <div className="bg-surface border border-border shadow-card rounded-card p-6 w-full max-w-xs shadow-xl">
            <h3 className="text-base font-bold mb-1">Take Down This Post?</h3>
            <p className="text-sm text-text-secondary mb-5">
              Your post will no longer be visible to other teams. This cannot be undone.
            </p>
            {error && <p className="text-xs text-red-600 mb-3 -mt-3">{error}</p>}
            <div className="flex gap-3">
              <button onClick={() => setShowConfirm(false)} disabled={takingDown}
                className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold disabled:opacity-40">
                Cancel
              </button>
              <button onClick={handleTakeDown} disabled={takingDown}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2">
                {takingDown ? (
                  <><svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Removing…</>
                ) : "Yes, Take Down"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
