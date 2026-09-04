"use client";

// Feed moderation — every match post teams have put up, and the take-down.
//
// This is the admin's view of the same rows the home feed shows, minus the
// feed's two filters: it keeps posts whose kickoff has already passed (a post
// that shouldn't be up is worth removing even on its last day) and it shows the
// ones already taken down, so a decision can be looked back at. Tournaments are
// not here — an admin hosts those from the Hub, and a venue's or team's event is
// cancelled on the event itself.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmtKickoff, isKickoffPast, sortKey } from "@/lib/match-dates";
import { takeDownPost } from "@/lib/take-down-post";

type PitchOption = { name?: string; price?: number; format?: string };

type Post = {
  id: string;
  teamName: string;
  location: string;
  matchDate: string;
  matchTime: string;
  description: string;
  pitchOptions: PitchOption[];
  status: string;
  pitchSecured: boolean;
  takenDownReason: string | null;
};

function cheapestOption(options: PitchOption[]): PitchOption | null {
  const priced = options.filter((p) => typeof p.price === "number");
  if (priced.length === 0) return null;
  return priced.reduce((a, b) => ((b.price ?? 0) < (a.price ?? 0) ? b : a));
}

// ── One post, plus the take-down it can be given ──────────────────────
// The reason is mandatory server-side, so the button stays disabled until
// something is typed rather than letting the request bounce back a 400.
function PostRow({ post, onRemoved }: { post: Post; onRemoved: (id: string, reason: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const down = post.status === "cancelled";
  const pitch = cheapestOption(post.pitchOptions);
  const past = isKickoffPast(post.matchDate, post.matchTime);

  const handle = async () => {
    setBusy(true);
    setError(null);
    const note = reason.trim();
    const err = await takeDownPost(post.id, note);
    setBusy(false);
    if (err) { setError(err); return; }
    onRemoved(post.id, note);
  };

  return (
    <div className={`bg-surface-2 border border-border rounded-2xl p-4 ${down ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-sm truncate">{post.teamName}</p>
          <p className="text-xs text-text-secondary truncate mt-0.5">
            {[post.location || "Location TBC", pitch?.format, pitch?.name].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {down ? (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-surface text-text-secondary border-border">Taken down</span>
          ) : past ? (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-surface text-text-secondary border-border">Kickoff passed</span>
          ) : (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-accent/10 text-accent border-accent/30">Live</span>
          )}
          {post.pitchSecured && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-surface text-text-secondary border-border">Pitch secured</span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mt-2">
        <p className="text-xs text-text-secondary">{fmtKickoff(post.matchDate, post.matchTime)}</p>
        {pitch?.price != null && (
          <p className="text-xs font-semibold tabular-nums">
            £{pitch.price.toFixed(2)}<span className="text-text-secondary font-normal"> pitch</span>
          </p>
        )}
      </div>

      {post.description && (
        <p className="text-xs text-text-secondary mt-2 border-t border-border pt-2 break-words">{post.description}</p>
      )}

      {down ? (
        post.takenDownReason ? (
          <p className="text-[11px] text-text-secondary mt-2 border-t border-border pt-2 break-words">
            <span className="font-semibold">Reason:</span> {post.takenDownReason}
          </p>
        ) : null
      ) : !confirming ? (
        <button onClick={() => setConfirming(true)}
          className="w-full mt-3 py-2 rounded-xl border border-red-500/30 text-red-600 text-xs font-semibold">
          Take down post
        </button>
      ) : (
        <div className="mt-3 border-t border-border pt-3 space-y-2">
          <p className="text-[11px] text-text-secondary">
            The post leaves every team&apos;s feed and the captain is told what you type here. This can&apos;t be undone.
          </p>
          <input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus
            placeholder="Reason — e.g. duplicate post, wrong pitch"
            className="w-full bg-background border border-border rounded-xl px-3 py-2 text-xs outline-none focus:border-accent/50 placeholder:text-text-secondary" />
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setConfirming(false); setError(null); }} disabled={busy}
              className="flex-1 py-2 rounded-xl border border-border text-xs font-semibold disabled:opacity-40">Cancel</button>
            <button onClick={handle} disabled={busy || !reason.trim()}
              className="flex-1 py-2 rounded-xl bg-red-500 text-white text-xs font-bold disabled:opacity-40">
              {busy ? "Taking down…" : "Take down"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, posts, empty, onRemoved }: {
  title: string;
  posts: Post[];
  empty: string;
  onRemoved: (id: string, reason: string) => void;
}) {
  return (
    <section>
      <h3 className="font-bold mb-2">{title}</h3>
      {posts.length === 0 ? (
        <div className="bg-surface-2 border border-border rounded-2xl p-5 text-center">
          <p className="text-sm text-text-secondary">{empty}</p>
        </div>
      ) : (
        <div className="space-y-2">{posts.map((p) => <PostRow key={p.id} post={p} onRemoved={onRemoved} />)}</div>
      )}
    </section>
  );
}

export default function AdminPostsPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from("match_posts")
        .select("*")
        .in("status", ["open", "cancelled"])
        .order("created_at", { ascending: false })
        .limit(200);

      setPosts((data ?? []).map((r) => ({
        id: r.id,
        teamName: r.team_name ?? "Unnamed team",
        location: r.team_location ?? "",
        matchDate: r.match_date,
        matchTime: r.match_time,
        description: r.description ?? "",
        pitchOptions: (r.pitch_options ?? []) as PitchOption[],
        status: r.status,
        pitchSecured: Boolean(r.pitch_secured),
        // Null until supabase_post_takedown.sql is run — the row simply has no
        // provenance to show, which is what a post taken down before the
        // migration looks like too.
        takenDownReason: r.taken_down_reason ?? null,
      })));
      setLoading(false);
    }
    load();
  }, []);

  // A take-down doesn't drop the row — it moves it into the section below, so
  // the decision stays visible instead of vanishing the moment it's made.
  const markDown = (id: string, reason: string) =>
    setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, status: "cancelled", takenDownReason: reason || p.takenDownReason } : p)));

  if (loading) return <div className="flex justify-center py-10"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;

  const live = posts
    .filter((p) => p.status === "open")
    .sort((a, b) => sortKey(a.matchDate, a.matchTime).localeCompare(sortKey(b.matchDate, b.matchTime)));
  const removed = posts.filter((p) => p.status === "cancelled");

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-surface-2 border border-border rounded-2xl p-4">
        <p className="text-xs text-text-secondary">
          Every match post teams have put on the feed. Taking one down removes it for
          everyone and tells the captain why — it does not touch a match that has
          already been agreed.
        </p>
      </div>

      {/* Both sections always render so the page keeps a fixed shape. */}
      <Section title={`Live posts (${live.length})`} posts={live}
        empty="No open match posts right now." onRemoved={markDown} />
      <Section title="Taken down" posts={removed}
        empty="Nothing has been taken down." onRemoved={markDown} />
    </div>
  );
}
