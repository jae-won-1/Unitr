"use client";

import { useCallback, useEffect, useState } from "react";
import { authedPost } from "@/lib/authed-fetch";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { stripePromise } from "@/lib/stripe-client";
import { isUpcomingDate, sortKey, toDateKey } from "@/lib/match-dates";
import DateDial, { countByDate } from "@/components/DateDial";
import SignUpGate, { GateTarget } from "@/components/SignUpGate";
import { useSaveCardOffer } from "@/components/SaveCardPrompt";
import TestModeNote from "@/components/TestModeNote";
import { loadLeadership } from "@/lib/team-leadership";

// Browse-and-join feed for one-off guest spots ("ringers"). Deliberately the
// shortest path in the app: see the price, see the match, pay, you're in the
// squad — no team, no availability poll, no credit balance involved.

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

function fmtDate(raw: string) {
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

// ── Checkout ──────────────────────────────────────────────────
function RingerCheckoutForm({ post, onPaid, onCancel }: {
  post: RingerPost;
  onPaid: (paymentIntentId: string) => Promise<void>;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePay = async () => {
    if (!stripe || !elements) return;
    setPaying(true);
    setError(null);
    const { error: payError, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (payError) { setError(payError.message ?? "Payment failed."); setPaying(false); return; }
    if (paymentIntent?.status === "succeeded") {
      await onPaid(paymentIntent.id);
      return;
    }
    setError("Payment didn't complete. Please try again.");
    setPaying(false);
  };

  return (
    <div className="space-y-4">
      <div className="bg-surface border border-border rounded-btn p-4">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">Card Details</p>
        <PaymentElement options={{ layout: "tabs", paymentMethodOrder: ["card"] }} />
      </div>
      <TestModeNote />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} disabled={paying}
          className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold text-text-secondary disabled:opacity-50">
          Back
        </button>
        <button type="button" onClick={handlePay} disabled={paying || !stripe}
          className="flex-[2] py-3 rounded-btn bg-accent text-white text-sm font-bold disabled:opacity-50">
          {paying ? "Paying…" : `Pay £${(post.pricePence / 100).toFixed(2)} & Join`}
        </button>
      </div>
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────
function RingerCard({ post, onJoin }: { post: RingerPost; onJoin: (post: RingerPost) => void }) {
  return (
    <div className="bg-surface border border-border shadow-card rounded-card p-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-bold text-accent-ink">
            {post.teamName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{post.teamName}</p>
          <p className="text-xs text-text-secondary truncate">vs {post.opponentName}</p>
        </div>
        <span className="text-[10px] font-semibold bg-accent/10 text-accent-ink border border-accent/30 px-2 py-0.5 rounded-full flex-shrink-0">
          {post.spotsLeft} spot{post.spotsLeft === 1 ? "" : "s"} left
        </span>
      </div>

      <div className="space-y-1 mb-3">
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          {fmtDate(post.date)} · {post.time}
        </div>
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          {post.pitch}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <span className="text-[10px] text-text-secondary uppercase tracking-wider font-semibold mr-0.5">Needs</span>
        {post.positions.length === 0 ? (
          <span className="text-[10px] font-semibold bg-surface border border-border text-text-secondary px-2 py-0.5 rounded-full">Any position</span>
        ) : post.positions.map((p) => (
          <span key={p} className="text-[10px] font-semibold bg-surface border border-border text-text-primary px-2 py-0.5 rounded-full">{p}</span>
        ))}
      </div>

      {post.notes && <p className="text-xs text-text-secondary mb-3 line-clamp-2">{post.notes}</p>}

      <div className="flex items-center justify-between">
        <div>
          <span className="text-lg font-bold text-accent-ink">£{(post.pricePence / 100).toFixed(2)}</span>
          <span className="text-[11px] text-text-secondary ml-1.5">one-off, all in</span>
        </div>
        {post.joined ? (
          <span className="px-4 py-2 rounded-xl bg-green-500/10 border border-green-500/30 text-green-600 text-sm font-bold">You&apos;re in ✓</span>
        ) : (
          <button type="button" onClick={() => onJoin(post)}
            className="px-5 py-2 rounded-btn bg-accent text-white text-sm font-bold">
            Join for £{(post.pricePence / 100).toFixed(2)}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Feed ──────────────────────────────────────────────────────
export default function RingerFeed({ showIntro = true, showDateDial = false, dateKey: dateKeyProp, onDateCounts }: {
  showIntro?: boolean;
  showDateDial?: boolean;
  // When a parent shows this feed alongside others (GameFeed's "All"), one dial
  // up there drives every list, so the date arrives from outside and the feed's
  // own dial stays hidden. Passing this at all takes control — `null` is a real
  // value meaning "no date picked", so absence is the uncontrolled signal.
  dateKey?: string | null;
  // Lets that shared dial count fill-in games too, instead of understating the
  // days that only have one. Pass a stable function — a raw useState setter is.
  onDateCounts?: (counts: Map<string, number>) => void;
} = {}) {
  const { user } = useAuth();
  const { posts, loading, unavailable, reload } = useRingerPosts(user?.id);
  const [ownDateKey, setOwnDateKey] = useState<string | null>(null);
  const controlled = dateKeyProp !== undefined;
  const dateKey = controlled ? dateKeyProp : ownDateKey;
  const [target, setTarget] = useState<RingerPost | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<RingerPost | null>(null);
  const [gate, setGate] = useState<GateTarget | null>(null);
  const saveCard = useSaveCardOffer(user?.id);

  const closeModal = () => {
    setTarget(null);
    setClientSecret(null);
    setError(null);
    setDone(null);
    setStarting(false);
  };

  const startJoin = async (post: RingerPost) => {
    // A guest can browse the feed but there is nobody to put in the squad and
    // nobody to charge, so ask for an account instead of opening a checkout
    // that can only fail.
    if (!user) {
      setGate({
        title: `${post.teamName} vs ${post.opponentName}`,
        subtitle: `${fmtDate(post.date)} · ${post.time} · ${post.pitch}`,
        unlocks: `claim this spot for £${(post.pricePence / 100).toFixed(2)}`,
      });
      return;
    }
    setTarget(post);
    setError(null);
    setStarting(true);
    try {
      const res = await authedPost("/api/ringer/create-intent", { requestId: post.id });
      const data = await res.json();
      if (data.clientSecret) setClientSecret(data.clientSecret);
      else setError(data.error ?? "Couldn't start the payment.");
    } catch {
      setError("Couldn't reach the payment service.");
    }
    setStarting(false);
  };

  const confirmJoin = async (paymentIntentId: string) => {
    if (!target || !user) return;
    try {
      const res = await authedPost("/api/ringer/join", { requestId: target.id, paymentIntentId });
      const data = await res.json();
      if (!data.ok) { setError(data.error ?? "Payment went through but the join failed."); return; }
      if (data.squadWarning) setError(data.squadWarning);
      // Offer to keep the card before the confirmation screen — a ringer with
      // no team has no other surface that would ever ask them.
      saveCard.offer(paymentIntentId, () => {
        setDone(target);
        setClientSecret(null);
      });
      await reload();
    } catch {
      // The charge succeeded — say so plainly rather than inviting a re-pay.
      setError("You've been charged but we couldn't confirm your spot. Contact the team before paying again.");
    }
  };

  const counts = countByDate(posts, (p) => p.date);
  const visible = dateKey ? posts.filter((p) => toDateKey(p.date) === dateKey) : posts;

  // `counts` is a fresh Map every render, so this keys off `posts` instead —
  // listing it in the deps would loop.
  useEffect(() => { onDateCounts?.(countByDate(posts, (p) => p.date)); }, [posts, onDateCounts]);

  return (
    <div className="space-y-4">
      {showIntro && (
        <div className="bg-accent/10 border border-accent/30 rounded-xl p-4">
          <p className="text-sm font-semibold text-accent-ink mb-1">Fill in for a Match</p>
          <p className="text-xs text-text-secondary leading-relaxed">
            No team, or no game this week? Join someone else&apos;s match as a one-off guest.
            Flat £5, pay by card, and you&apos;re straight into the squad.
          </p>
        </div>
      )}

      {showDateDial && !controlled && !loading && <DateDial value={ownDateKey} onChange={setOwnDateKey} counts={counts} />}

      {loading ? (
        <div className="flex justify-center py-8"><div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>
      ) : visible.length === 0 ? (
        <div className="bg-surface border border-border shadow-card rounded-card p-6 text-center">
          <p className="text-sm text-text-secondary">
            {posts.length > 0
              ? "No spots open on this day."
              : "No teams are looking for players right now."}
          </p>
          <p className="text-xs text-text-secondary mt-1">
            {posts.length > 0
              ? "Try another date, or pick All to see everything."
              : unavailable
              ? "Ringer requests aren't set up yet — run supabase_ringers.sql."
              : "Check back soon — captains post here when they're short."}
          </p>
        </div>
      ) : (
        visible.map((p) => <RingerCard key={p.id} post={p} onJoin={startJoin} />)
      )}

      <SignUpGate target={gate} onClose={() => setGate(null)} />

      {target && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim" onClick={closeModal}>
          <div className="w-full max-w-md bg-surface border-t border-border rounded-t-2xl p-5 max-h-[85dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <p className="font-bold text-base">{done ? "You're in" : "Join as Ringer"}</p>
              <button type="button" onClick={closeModal}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>

            <div className="bg-surface border border-border rounded-btn p-4 mb-4">
              <p className="text-sm font-semibold mb-1">{target.teamName} vs {target.opponentName}</p>
              <p className="text-xs text-text-secondary">{fmtDate(target.date)} · {target.time}</p>
              <p className="text-xs text-text-secondary">{target.pitch}</p>
              <p className="text-xs text-text-secondary mt-1">
                Position: {target.positions.length === 0 ? "Any" : target.positions.join(", ")}
              </p>
              <div className="border-t border-border mt-3 pt-3 flex items-center justify-between">
                <span className="text-xs text-text-secondary">Ringer fee</span>
                <span className="text-base font-bold text-accent-ink">£{(target.pricePence / 100).toFixed(2)}</span>
              </div>
            </div>

            {done ? (
              <div className="space-y-4">
                <p className="text-sm text-text-secondary">
                  You&apos;re in the matchday squad for {done.teamName}. The captain can now see you in their lineup.
                  Nothing else to pay — the team&apos;s pitch fee isn&apos;t split with you.
                </p>
                {error && <p className="text-xs text-yellow-600">{error}</p>}
                <button type="button" onClick={closeModal}
                  className="w-full py-3 rounded-btn bg-accent text-white text-sm font-bold">Done</button>
              </div>
            ) : starting ? (
              <div className="py-8 text-center"><div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" /></div>
            ) : clientSecret ? (
              <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "night", variables: { colorPrimary: "#0E7A3C", colorBackground: "#1a1a1a", colorText: "#ffffff", borderRadius: "12px" } } }}>
                <RingerCheckoutForm post={target} onPaid={confirmJoin} onCancel={closeModal} />
              </Elements>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-red-600">{error ?? "Couldn't start the payment."}</p>
                <button type="button" onClick={closeModal}
                  className="w-full py-3 rounded-xl border border-border text-sm font-semibold text-text-secondary">Close</button>
              </div>
            )}
          </div>
        </div>
      )}

      {saveCard.prompt}
    </div>
  );
}
