"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { authedPost } from "@/lib/authed-fetch";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { useAuth } from "@/contexts/AuthContext";
import { stripePromise, cardElementOptions } from "@/lib/stripe-client";
import { toDateKey } from "@/lib/match-dates";
import DateDial, { countByDate } from "@/components/DateDial";
import SignUpGate, { GateTarget } from "@/components/SignUpGate";
import { useSaveCardTickbox } from "@/components/SaveCardPrompt";
import TestModeNote from "@/components/TestModeNote";
import { confirmCardPayment } from "@/lib/confirm-payment";
import { useRingerPosts, fmtRingerDate as fmtDate, type RingerPost } from "@/lib/ringer-feed";
import { categoryForGender, matchesGenderFilter, wrongCategoryReason, type GenderFilter } from "@/lib/gender";
import { defaultGenderFilter, useViewerGender } from "@/lib/viewer-gender";
import { GenderBadge, GenderFilterChips } from "@/components/GenderControls";

// Browse-and-join feed for one-off guest spots ("ringers"). Deliberately the
// shortest path in the app: see the price, see the match, pay, you're in the
// squad — no team, no availability poll, no credit balance involved.
//
// The data layer (useRingerPosts, RingerPost, the date formatter) lives in
// lib/ringer-feed.ts so the mobile app can share it — this file re-exports
// them so nothing that imported from here had to change. Only the checkout
// (Stripe Elements below) is web-only.
export { useRingerPosts, type RingerPost };

// ── Checkout ──────────────────────────────────────────────────
function RingerCheckoutForm({ post, clientSecret, saveCardSlot, onPaid, onCancel }: {
  post: RingerPost;
  clientSecret: string;
  saveCardSlot?: ReactNode;
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
    // "booking": the signup row is written after this resolves, so a recovered
    // charge is not a recovered spot in the game.
    const { error: payError, paymentIntent } = await confirmCardPayment({
      stripe, elements, clientSecret, kind: "booking",
      amountPence: post.pricePence ?? 500, label: "Ringer spot",
    });
    if (payError) { setError(payError.message ?? "Payment failed."); setPaying(false); return; }
    if (paymentIntent?.status === "succeeded" || paymentIntent?.status === "processing") {
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
        <PaymentElement options={cardElementOptions} />
      </div>
      {saveCardSlot}
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
// `blockedReason` greys the Join button for a player whose own answer is the
// other gender — a women's team short of players is asking for women. Greyed
// rather than hidden, per the house convention; /api/ringer/create-intent
// refuses it too, before anybody is charged.
function RingerCard({ post, onJoin, blockedReason }: {
  post: RingerPost;
  onJoin: (post: RingerPost) => void;
  blockedReason: string | null;
}) {
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
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="text-[10px] font-semibold bg-accent/10 text-accent-ink border border-accent/30 px-2 py-0.5 rounded-full">
            {post.spotsLeft} spot{post.spotsLeft === 1 ? "" : "s"} left
          </span>
          <GenderBadge category={post.genderCategory} />
        </div>
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
        ) : blockedReason ? (
          <span className="px-4 py-2 rounded-btn bg-surface-2 text-text-secondary text-sm font-bold opacity-70 cursor-not-allowed">
            {blockedReason}
          </span>
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
export default function RingerFeed({ showIntro = true, showDateDial = false, dateKey: dateKeyProp, onDateCounts, genderFilter: genderFilterProp }: {
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
  // Same idea as dateKey: GameFeed's Men's/Women's/All control drives every
  // list. Absent, the feed shows its own, opening on the viewer's gender.
  genderFilter?: GenderFilter;
} = {}) {
  const { user } = useAuth();
  const { posts: allPosts, loading, unavailable, reload } = useRingerPosts(user?.id);
  const { viewer: viewerGender, loading: genderLoading } = useViewerGender(user?.id);
  const [ownGenderFilter, setOwnGenderFilter] = useState<GenderFilter | null>(null);
  const genderControlled = genderFilterProp !== undefined;
  const genderFilter: GenderFilter = genderControlled
    ? genderFilterProp
    : ownGenderFilter ?? defaultGenderFilter(viewerGender);
  // Memoised: the date-count effect below keys off this array, and a fresh one
  // every render would loop it through the parent's state.
  const posts = useMemo(
    () => allPosts.filter((p) => matchesGenderFilter(p.genderCategory, genderFilter)),
    [allPosts, genderFilter],
  );
  const ownCategory = categoryForGender(viewerGender.gender);
  const blockedReasonFor = (p: RingerPost) =>
    ownCategory && ownCategory !== p.genderCategory ? wrongCategoryReason(p.genderCategory, "players") : null;
  const [ownDateKey, setOwnDateKey] = useState<string | null>(null);
  const controlled = dateKeyProp !== undefined;
  const dateKey = controlled ? dateKeyProp : ownDateKey;
  const [target, setTarget] = useState<RingerPost | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<RingerPost | null>(null);
  const [gate, setGate] = useState<GateTarget | null>(null);
  const saveCard = useSaveCardTickbox(user?.id);

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
      // Keep the card if they asked for it on the way in — a ringer with no
      // team has no other surface that would ever offer.
      await saveCard.commit(paymentIntentId);
      setDone(target);
      setClientSecret(null);
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

      {!genderControlled && !genderLoading && (
        <GenderFilterChips value={genderFilter} onChange={setOwnGenderFilter} />
      )}

      {showDateDial && !controlled && !loading && <DateDial value={ownDateKey} onChange={setOwnDateKey} counts={counts} />}

      {loading ? (
        <div className="flex justify-center py-8"><div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>
      ) : visible.length === 0 ? (
        <div className="bg-surface border border-border shadow-card rounded-card p-6 text-center">
          <p className="text-sm text-text-secondary">
            {posts.length > 0
              ? "No spots open on this day."
              : allPosts.length > 0
              ? `No ${genderFilter === "female" ? "women's" : "men's"} teams are looking for players right now.`
              : "No teams are looking for players right now."}
          </p>
          <p className="text-xs text-text-secondary mt-1">
            {posts.length > 0 || allPosts.length > 0
              ? "Try another date, or pick All to see everything."
              : unavailable
              ? "Ringer requests aren't set up yet — run supabase_ringers.sql."
              : "Check back soon — captains post here when they're short."}
          </p>
        </div>
      ) : (
        visible.map((p) => <RingerCard key={p.id} post={p} onJoin={startJoin} blockedReason={blockedReasonFor(p)} />)
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
                <RingerCheckoutForm post={target} clientSecret={clientSecret} saveCardSlot={saveCard.checkbox} onPaid={confirmJoin} onCancel={closeModal} />
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

    </div>
  );
}
