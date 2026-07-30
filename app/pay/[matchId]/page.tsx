"use client";

import { useState, useEffect } from "react";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { stripePromise } from "@/lib/stripe-client";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

type MatchInfo = {
  opponent: string;
  date: string;
  time: string;
  pitchName: string;
  pitchPrice: number;
  playerCount: number;
  mode: "credit" | "individual";
  // Exact amounts for THIS player, in pence.
  sharePence: number;   // pitch share (credit mode → refills team credit)
  feePence: number;     // 5% Unitr fee
  totalPence: number;   // charged to card
  paymentId: string | null;   // pre-created player_payments row (credit mode)
  bookingId: string | null;   // pitch_bookings row
};

type SavedCard = { customerId: string; paymentMethodId: string; brand: string | null; last4: string | null };

// Shared success side-effects for either payment path (saved card or manual entry).
async function recordPaymentSuccess(matchInfo: MatchInfo, matchId: string, userId: string, paymentIntentId: string) {
  if (matchInfo.mode === "credit" && matchInfo.paymentId) {
    await supabase.from("player_payments")
      .update({ status: "paid", stripe_payment_intent_id: paymentIntentId, paid_at: new Date().toISOString() })
      .eq("id", matchInfo.paymentId);
    await supabase.rpc("apply_replenishment", { p_payment_id: matchInfo.paymentId });
  } else {
    await supabase.from("player_payments").upsert({
      booking_id: matchInfo.bookingId ?? matchId,
      player_id: userId,
      amount_pence: matchInfo.sharePence,
      unitr_fee_pence: matchInfo.feePence,
      total_pence: matchInfo.totalPence,
      status: "paid",
      purpose: "individual",
      stripe_payment_intent_id: paymentIntentId,
    }, { onConflict: "booking_id,player_id" });
  }
}

// ── Pay instantly with the card already saved on the profile ──────────────────
function PaySavedCard({
  matchInfo, matchId, savedCard, onSuccess, onUseDifferentCard,
}: {
  matchInfo: MatchInfo; matchId: string; savedCard: SavedCard;
  onSuccess: (paymentIntentId: string) => void;
  onUseDifferentCard: () => void;
}) {
  const { user } = useAuth();
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const share = matchInfo.sharePence / 100;
  const unitrFee = matchInfo.feePence / 100;
  const total = matchInfo.totalPence / 100;

  const handlePay = async () => {
    if (!user) return;
    setPaying(true);
    setPayError(null);
    try {
      const res = await fetch("/api/settle-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{
            playerId: user.id,
            customerId: savedCard.customerId,
            paymentMethodId: savedCard.paymentMethodId,
            amountPence: matchInfo.totalPence,
            sharePence: matchInfo.sharePence,
            feePence: matchInfo.feePence,
            matchId,
            bookingId: matchInfo.bookingId,
          }],
        }),
      });
      const data = await res.json();
      const result = data.results?.[0];
      if (result?.ok) {
        await recordPaymentSuccess(matchInfo, matchId, user.id, result.paymentIntentId);
        onSuccess(result.paymentIntentId);
        return;
      }
      setPayError(result?.error ?? "Payment failed with your saved card.");
    } catch {
      setPayError("Could not reach the payment service.");
    }
    setPaying(false);
  };

  return (
    <div className="space-y-4">
      <div className="bg-surface-2 border border-border rounded-2xl p-4 space-y-2">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">Payment Breakdown</p>
        <div className="flex justify-between text-xs">
          <span className="text-text-secondary">Pitch hire (1hr)</span>
          <span className="font-semibold">£{matchInfo.pitchPrice.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-text-secondary">
            {matchInfo.mode === "credit" ? "Your share (refills team credit)" : `Split across ${matchInfo.playerCount} players`}
          </span>
          <span className="font-semibold">£{share.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-text-secondary">Unitr platform fee (5%)</span>
          <span className="font-semibold">£{unitrFee.toFixed(2)}</span>
        </div>
        <div className="flex justify-between border-t border-border pt-2 mt-1">
          <span className="text-sm font-bold">Your total</span>
          <span className="text-sm font-bold text-accent">£{total.toFixed(2)}</span>
        </div>
      </div>

      <div className="bg-surface-2 border border-border rounded-2xl p-4">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">Card Details</p>
        <div className="flex items-center gap-3 bg-background border border-border rounded-xl px-3 py-2.5">
          <div className="w-9 h-9 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold capitalize">{savedCard.brand ?? "Card"} •••• {savedCard.last4 ?? "????"}</p>
            <p className="text-[11px] text-accent">Saved card · no need to re-enter details</p>
          </div>
          <button onClick={onUseDifferentCard} className="text-xs text-text-secondary font-medium flex-shrink-0">Change</button>
        </div>
      </div>

      {payError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
          <p className="text-xs text-red-400">{payError}</p>
        </div>
      )}

      <button
        onClick={handlePay}
        disabled={paying}
        className="w-full py-3.5 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50"
      >
        {paying ? "Processing…" : `Pay £${total.toFixed(2)}`}
      </button>

      <p className="text-[10px] text-text-secondary text-center">
        Secured by Stripe · Your saved card will be charged £{total.toFixed(2)}
      </p>
    </div>
  );
}

// ── Stripe checkout form (inner — must live inside <Elements>) ────────────────
function CheckoutForm({
  matchInfo,
  matchId,
  showSavedCardOption,
  onSuccess,
}: {
  matchInfo: MatchInfo;
  matchId: string;
  showSavedCardOption: boolean;
  onSuccess: (paymentIntentId: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const { user } = useAuth();
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const share = matchInfo.sharePence / 100;
  const unitrFee = matchInfo.feePence / 100;
  const total = matchInfo.totalPence / 100;

  const handlePay = async () => {
    if (!stripe || !elements || !user) return;
    setPaying(true);
    setPayError(null);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });

    if (error) {
      setPayError(error.message ?? "Payment failed. Please try again.");
      setPaying(false);
      return;
    }

    if (paymentIntent?.status === "succeeded") {
      await recordPaymentSuccess(matchInfo, matchId, user.id, paymentIntent.id);
      onSuccess(paymentIntent.id);
    } else {
      setPayError("Payment did not complete. Please try again.");
      setPaying(false);
    }
  };

  const isCredit = matchInfo.mode === "credit";

  return (
    <div className="space-y-4">
      {/* Cost breakdown */}
      <div className="bg-surface-2 border border-border rounded-2xl p-4 space-y-2">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">Payment Breakdown</p>
        <div className="flex justify-between text-xs">
          <span className="text-text-secondary">Pitch hire (1hr)</span>
          <span className="font-semibold">£{matchInfo.pitchPrice.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-text-secondary">
            {isCredit ? "Your share (refills team credit)" : `Split across ${matchInfo.playerCount} players`}
          </span>
          <span className="font-semibold">£{share.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-text-secondary">Unitr platform fee (5%)</span>
          <span className="font-semibold">£{unitrFee.toFixed(2)}</span>
        </div>
        <div className="flex justify-between border-t border-border pt-2 mt-1">
          <span className="text-sm font-bold">Your total</span>
          <span className="text-sm font-bold text-accent">£{total.toFixed(2)}</span>
        </div>
      </div>

      {isCredit && (
        <div className="bg-accent/10 border border-accent/30 rounded-xl px-4 py-3">
          <p className="text-[11px] text-accent font-semibold mb-0.5">Replenishing team credit</p>
          <p className="text-[11px] text-text-secondary leading-relaxed">
            Your team secured the pitch using its credit balance. Your share goes back
            into the team pot so it stays topped up for the next match.
          </p>
        </div>
      )}

      {/* Stripe Elements card form */}
      <div className="bg-surface-2 border border-border rounded-2xl p-4">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">Card Details</p>
        <PaymentElement
          options={{
            layout: "tabs",
            paymentMethodOrder: ["card"],
          }}
        />
      </div>

      {!showSavedCardOption && (
        <div className="bg-accent/10 border border-accent/30 rounded-xl px-4 py-3">
          <p className="text-[11px] text-accent leading-relaxed">
            We&apos;ll ask if you want to save this card after payment, so next time you can skip this step.
          </p>
        </div>
      )}

      {/* Test card hint */}
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl px-4 py-3">
        <p className="text-[11px] text-blue-300 font-semibold mb-0.5">Test Mode</p>
        <p className="text-[11px] text-blue-200 leading-relaxed">
          Use card <span className="font-mono font-bold">4242 4242 4242 4242</span> · any future expiry · any 3-digit CVC
        </p>
      </div>

      {payError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
          <p className="text-xs text-red-400">{payError}</p>
        </div>
      )}

      <button
        onClick={handlePay}
        disabled={!stripe || paying}
        className="w-full py-3.5 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50"
      >
        {paying ? "Processing…" : `Pay £${total.toFixed(2)}`}
      </button>

      <p className="text-[10px] text-text-secondary text-center">
        Secured by Stripe · Your card will be charged £{total.toFixed(2)}
      </p>
    </div>
  );
}

// ── "Save this card for next time?" prompt shown after a manual payment ───────
function SaveCardPrompt({ onSave, onSkip, saving }: { onSave: () => void; onSkip: () => void; saving: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      <div className="w-16 h-16 rounded-full bg-accent/20 border-2 border-accent/40 flex items-center justify-center mb-5">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
      </div>
      <p className="text-lg font-bold mb-2">Payment Confirmed!</p>
      <p className="text-sm text-text-secondary mb-6 max-w-xs">
        Save this card so your next match payment is instant — no need to fill in card details again.
      </p>
      <div className="flex gap-2 w-full max-w-xs">
        <button onClick={onSkip} disabled={saving} className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold text-text-secondary disabled:opacity-50">
          No thanks
        </button>
        <button onClick={onSave} disabled={saving} className="flex-1 py-3 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50">
          {saving ? "Saving…" : "Save Card"}
        </button>
      </div>
    </div>
  );
}

// ── Payment success screen ────────────────────────────────────────────────────
function PaymentSuccess({ matchInfo }: { matchInfo: MatchInfo }) {
  const total = matchInfo.totalPence / 100;
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      <div className="w-20 h-20 rounded-full bg-accent/20 border-2 border-accent/40 flex items-center justify-center mb-5">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2.5" strokeLinecap="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <p className="text-xl font-bold mb-2">{matchInfo.mode === "credit" ? "Credit Replenished!" : "Payment Confirmed!"}</p>
      <p className="text-sm text-text-secondary mb-1">vs {matchInfo.opponent}</p>
      <p className="text-xs text-text-secondary mb-1">{matchInfo.date} · {matchInfo.time}</p>
      <p className="text-xs text-text-secondary mb-5">{matchInfo.pitchName}</p>
      <div className="bg-surface-2 border border-border rounded-2xl px-6 py-4 mb-6 w-full max-w-xs">
        <p className="text-xs text-text-secondary mb-1">Amount paid</p>
        <p className="text-2xl font-bold text-accent">£{total.toFixed(2)}</p>
        <p className="text-[10px] text-text-secondary mt-1">inc. 5% Unitr fee</p>
      </div>
      <a href="/my-team" className="px-8 py-3 rounded-xl bg-accent text-black font-bold text-sm">
        Back to My Team
      </a>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PayPage({ params }: { params: { matchId: string } }) {
  const { user } = useAuth();
  const [matchInfo, setMatchInfo] = useState<MatchInfo | null | undefined>(undefined);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [intentCustomerId, setIntentCustomerId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);

  const [savedCard, setSavedCard] = useState<SavedCard | null | undefined>(undefined);
  const [useManualEntry, setUseManualEntry] = useState(false);
  const [saveCardPrompt, setSaveCardPrompt] = useState<{ paymentIntentId: string } | null>(null);
  const [savingCard, setSavingCard] = useState(false);

  // Creates the Stripe Elements client secret for manual card entry. Lazy —
  // only called when there's no saved card, or the player picks "Change".
  const createClientSecret = async (info: MatchInfo, customerId: string | null) => {
    try {
      const res = await fetch("/api/create-payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountPence: info.totalPence,
          bookingId: info.bookingId ?? params.matchId,
          playerId: user!.id,
          customerId,
          email: user!.email,
        }),
      });
      const data = await res.json();
      if (data.clientSecret) {
        setClientSecret(data.clientSecret);
        setIntentCustomerId(data.customerId ?? null);
      } else {
        setLoadError("Could not set up payment. Check Stripe keys in .env.local");
      }
    } catch {
      setLoadError("Failed to connect to payment service.");
    }
  };

  useEffect(() => {
    if (!user) return;
    async function load() {
      // Fetch match post
      const { data: post } = await supabase
        .from("match_posts")
        .select("team_name, match_date, match_time, pitch_options, captain_id, payment_mode")
        .eq("id", params.matchId)
        .maybeSingle();

      if (!post) { setMatchInfo(null); return; }

      const isPoster = post.captain_id === user!.id;
      const mode: "credit" | "individual" = post.payment_mode === "individual" ? "individual" : "credit";

      // Get accepted challenge for opponent name + confirmed pitch
      const { data: challenge } = await supabase
        .from("challenges")
        .select("challenger_team_name, selected_pitch")
        .eq("post_id", params.matchId)
        .eq("status", "accepted")
        .maybeSingle();

      const selectedPitch = challenge?.selected_pitch as { name: string; price: number } | null;
      const pitchPrice = selectedPitch?.price ?? post.pitch_options?.[0]?.price ?? 80;
      const pitchName = selectedPitch?.name ?? post.pitch_options?.[0]?.name ?? "TBC";
      const opponent = isPoster
        ? (challenge?.challenger_team_name ?? "Unknown")
        : post.team_name;

      // Find the booking row for this match
      const { data: booking } = await supabase
        .from("pitch_bookings").select("id").eq("post_id", params.matchId).maybeSingle();
      const bookingId = booking?.id ?? null;

      // Count players (both teams) — used for the individual split display.
      // Ringers are excluded: they pay Unitr a flat fee instead of a share, so
      // counting them would understate what everyone else owes. (is_ringer
      // arrives with supabase_ringers.sql; selecting a missing column fails the
      // whole query, so fall back to the pre-ringer shape.)
      let playerCount = 22;
      const { data: matchRecord } = await supabase
        .from("matches").select("id").eq("post_id", params.matchId).maybeSingle();
      if (matchRecord) {
        const withRinger = await supabase
          .from("match_confirmations").select("id, is_ringer").eq("match_id", matchRecord.id);
        const confRows = (withRinger.data ?? (await supabase
          .from("match_confirmations").select("id").eq("match_id", matchRecord.id)).data
        ) as { id: string; is_ringer?: boolean }[] | null;
        const count = (confRows ?? []).filter((c) => !c.is_ringer).length;
        if (count > 0) playerCount = count;
      }

      // Look up any card already saved on this player's profile.
      const { data: profile } = await supabase
        .from("profiles")
        .select("stripe_customer_id, stripe_payment_method_id, card_brand, card_last4")
        .eq("id", user!.id)
        .maybeSingle();
      const hasSavedCard = !!(profile?.stripe_customer_id && profile?.stripe_payment_method_id);
      setSavedCard(hasSavedCard ? {
        customerId: profile!.stripe_customer_id as string,
        paymentMethodId: profile!.stripe_payment_method_id as string,
        brand: (profile!.card_brand as string | null) ?? null,
        last4: (profile!.card_last4 as string | null) ?? null,
      } : null);

      // Resolve THIS player's amounts.
      let sharePence: number, feePence: number, totalPence: number, paymentId: string | null = null;

      if (mode === "credit") {
        // The replenishment row was pre-created when the match was confirmed.
        if (!bookingId) { setLoadError("Booking not found for this match yet."); return; }
        const { data: pp } = await supabase
          .from("player_payments")
          .select("id, amount_pence, unitr_fee_pence, total_pence, status, applied")
          .eq("booking_id", bookingId)
          .eq("player_id", user!.id)
          .eq("purpose", "replenish")
          .maybeSingle();

        if (!pp) { setLoadError("No replenishment is due from you for this match."); return; }
        if (pp.status === "paid" || pp.applied) {
          // Already settled — show the success state.
          setMatchInfo({
            opponent, date: post.match_date, time: post.match_time, pitchName, pitchPrice, playerCount,
            mode, sharePence: pp.amount_pence, feePence: pp.unitr_fee_pence, totalPence: pp.total_pence,
            paymentId: pp.id, bookingId,
          });
          setPaid(true);
          return;
        }
        sharePence = pp.amount_pence;
        feePence = pp.unitr_fee_pence;
        totalPence = pp.total_pence;
        paymentId = pp.id;
      } else {
        // Individual mode: split the pitch fee across all players.
        sharePence = Math.round((pitchPrice * 100) / playerCount);
        feePence = Math.round(sharePence * 0.05);
        totalPence = sharePence + feePence;
      }

      const info: MatchInfo = {
        opponent, date: post.match_date, time: post.match_time, pitchName, pitchPrice, playerCount,
        mode, sharePence, feePence, totalPence, paymentId, bookingId,
      };
      setMatchInfo(info);

      // Only pre-create a Stripe Elements payment intent when there's no saved
      // card to pay with instantly — the saved-card path charges off-session.
      if (!hasSavedCard) {
        await createClientSecret(info, profile?.stripe_customer_id ?? null);
      }
    }
    load();
  }, [user, params.matchId]);

  const handleUseDifferentCard = () => {
    setUseManualEntry(true);
    if (matchInfo && !clientSecret) createClientSecret(matchInfo, savedCard?.customerId ?? null);
  };

  const handleSavedCardSuccess = (paymentIntentId: string) => {
    void paymentIntentId;
    setPaid(true);
  };

  const handleManualSuccess = (paymentIntentId: string) => {
    if (savedCard) {
      // Already had a saved card and chose to pay a different way — nothing new to save.
      setPaid(true);
    } else {
      setSaveCardPrompt({ paymentIntentId });
    }
  };

  const handleSaveCard = async () => {
    if (!saveCardPrompt || !user) return;
    setSavingCard(true);
    try {
      // The PaymentIntent was created with setup_future_usage: "off_session" and a
      // customer, so Stripe already attached the payment method — just look it up.
      const piRes = await fetch(`/api/payment-intent-method?paymentIntentId=${encodeURIComponent(saveCardPrompt.paymentIntentId)}`);
      const piData = await piRes.json();
      if (piData.paymentMethodId && intentCustomerId) {
        await supabase.from("profiles").update({
          stripe_customer_id: intentCustomerId,
          stripe_payment_method_id: piData.paymentMethodId,
          card_brand: piData.brand ?? null,
          card_last4: piData.last4 ?? null,
        }).eq("id", user.id);
      }
    } catch {
      // Non-fatal — the payment itself already succeeded.
    }
    setSavingCard(false);
    setSaveCardPrompt(null);
    setPaid(true);
  };

  const handleSkipSaveCard = () => {
    setSaveCardPrompt(null);
    setPaid(true);
  };

  const showManualEntry = useManualEntry || savedCard === null;
  const waitingOnClientSecret = showManualEntry && !clientSecret && !loadError;

  // Loading
  if (matchInfo === undefined || savedCard === undefined || (matchInfo !== null && !paid && !saveCardPrompt && waitingOnClientSecret)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  // Not found
  if (matchInfo === null) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 text-center px-4">
        <p className="text-text-secondary">Match not found.</p>
        <a href="/my-team" className="text-sm text-accent">Back to My Team</a>
      </div>
    );
  }

  // Stripe init / load error
  if (loadError && !paid) {
    return (
      <div className="flex flex-col min-h-screen pt-16 pb-20 px-4">
        <div className="flex items-center gap-3 mb-6">
          <a href={`/my-team/match/${params.matchId}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round">
              <path d="M19 12H5M12 5l-7 7 7 7"/>
            </svg>
          </a>
          <h1 className="text-xl font-bold">Payment</h1>
        </div>
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-5 text-center">
          <p className="text-sm font-semibold text-red-400 mb-2">Payment setup failed</p>
          <p className="text-xs text-text-secondary leading-relaxed">{loadError}</p>
          <p className="text-xs text-text-secondary mt-3 leading-relaxed">
            Add your Stripe test keys to <span className="font-mono text-accent">.env.local</span> and restart the dev server.
          </p>
          <a href="https://dashboard.stripe.com/test/apikeys" target="_blank" rel="noopener noreferrer"
            className="inline-block mt-4 px-4 py-2 rounded-xl bg-accent text-black font-bold text-xs">
            Get Test Keys →
          </a>
        </div>
      </div>
    );
  }

  // Save-card prompt (shown right after a successful manual payment)
  if (saveCardPrompt) {
    return (
      <div className="flex flex-col min-h-screen pt-16 pb-20 px-4">
        <SaveCardPrompt onSave={handleSaveCard} onSkip={handleSkipSaveCard} saving={savingCard} />
      </div>
    );
  }

  // Paid
  if (paid) {
    return (
      <div className="flex flex-col min-h-screen pt-16 pb-20 px-4">
        <PaymentSuccess matchInfo={matchInfo} />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen pt-16 pb-20 px-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <a href={`/my-team/match/${params.matchId}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </a>
        <div className="flex-1">
          <h1 className="text-xl font-bold">{matchInfo.mode === "credit" ? "Replenish Team Credit" : "Pay Your Share"}</h1>
          <p className="text-xs text-text-secondary">vs {matchInfo.opponent} · {matchInfo.date}</p>
        </div>
        <span className="text-[10px] font-semibold bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 px-2 py-1 rounded-full">
          Pending
        </span>
      </div>

      {/* Match info banner */}
      <div className="bg-surface-2 border border-border rounded-2xl px-4 py-3 flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-green-800 flex items-center justify-center flex-shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><path d="M2 12h20M12 2v20"/>
          </svg>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{matchInfo.pitchName}</p>
          <p className="text-xs text-text-secondary">{matchInfo.time} · {matchInfo.playerCount} players confirmed</p>
        </div>
      </div>

      {/* Saved-card instant pay path */}
      {savedCard && !showManualEntry && (
        <PaySavedCard
          matchInfo={matchInfo}
          matchId={params.matchId}
          savedCard={savedCard}
          onSuccess={handleSavedCardSuccess}
          onUseDifferentCard={handleUseDifferentCard}
        />
      )}

      {/* Manual card entry (no saved card, or player chose "Change") */}
      {showManualEntry && clientSecret && (
        <Elements
          stripe={stripePromise}
          options={{
            clientSecret,
            appearance: {
              theme: "night",
              variables: {
                colorPrimary: "#00E676",
                colorBackground: "#1a1a1a",
                colorText: "#ffffff",
                colorDanger: "#f87171",
                borderRadius: "12px",
                fontFamily: "system-ui, sans-serif",
              },
            },
          }}
        >
          <CheckoutForm
            matchInfo={matchInfo}
            matchId={params.matchId}
            showSavedCardOption={!!savedCard}
            onSuccess={handleManualSuccess}
          />
        </Elements>
      )}
    </div>
  );
}
