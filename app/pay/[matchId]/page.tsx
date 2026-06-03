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
};

// ── Stripe checkout form (inner — must live inside <Elements>) ────────────────
function CheckoutForm({
  matchInfo,
  clientSecret,
  matchId,
  onSuccess,
}: {
  matchInfo: MatchInfo;
  clientSecret: string;
  matchId: string;
  onSuccess: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const { user } = useAuth();
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const perPlayer = (matchInfo.pitchPrice / matchInfo.playerCount);
  const unitrFee = perPlayer * 0.05;
  const total = perPlayer + unitrFee;

  const handlePay = async () => {
    if (!stripe || !elements) return;
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
      // Record payment in player_payments
      if (user) {
        await supabase.from("player_payments").upsert({
          booking_id: matchId,
          player_id: user.id,
          amount_pence: Math.round(total * 100),
          status: "paid",
          stripe_payment_intent_id: paymentIntent.id,
        }, { onConflict: "booking_id,player_id" });
      }
      onSuccess();
    } else {
      setPayError("Payment did not complete. Please try again.");
      setPaying(false);
    }
  };

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
          <span className="text-text-secondary">Split across {matchInfo.playerCount} players</span>
          <span className="font-semibold">£{perPlayer.toFixed(2)}/player</span>
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

// ── Payment success screen ────────────────────────────────────────────────────
function PaymentSuccess({ matchInfo }: { matchInfo: MatchInfo }) {
  const total = (matchInfo.pitchPrice / matchInfo.playerCount * 1.05);
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      <div className="w-20 h-20 rounded-full bg-accent/20 border-2 border-accent/40 flex items-center justify-center mb-5">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2.5" strokeLinecap="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <p className="text-xl font-bold mb-2">Payment Confirmed!</p>
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    if (!user) return;
    async function load() {
      // Fetch match post
      const { data: post } = await supabase
        .from("match_posts")
        .select("team_name, match_date, match_time, pitch_options, captain_id")
        .eq("id", params.matchId)
        .maybeSingle();

      if (!post) { setMatchInfo(null); return; }

      const isPoster = post.captain_id === user!.id;

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

      // Count players from match_confirmations (includes captains + approved members)
      let playerCount = 22;
      const { data: matchRecord } = await supabase
        .from("matches").select("id").eq("post_id", params.matchId).maybeSingle();
      if (matchRecord) {
        const { count } = await supabase
          .from("match_confirmations")
          .select("id", { count: "exact", head: true })
          .eq("match_id", matchRecord.id);
        if (count && count > 0) playerCount = count;
      }

      const info: MatchInfo = {
        opponent,
        date: post.match_date,
        time: post.match_time,
        pitchName,
        pitchPrice,
        playerCount,
      };
      setMatchInfo(info);

      // Create payment intent
      try {
        const res = await fetch("/api/create-payment-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pitchPricePerHour: pitchPrice,
            playerCount,
            bookingId: params.matchId,
            playerId: user!.id,
          }),
        });
        const data = await res.json();
        if (data.clientSecret) {
          setClientSecret(data.clientSecret);
        } else {
          setLoadError("Could not set up payment. Check Stripe keys in .env.local");
        }
      } catch {
        setLoadError("Failed to connect to payment service.");
      }
    }
    load();
  }, [user, params.matchId]);

  // Loading
  if (matchInfo === undefined || (matchInfo !== null && !clientSecret && !loadError)) {
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

  // Stripe init error
  if (loadError) {
    return (
      <div className="flex flex-col min-h-screen pt-12 pb-20 px-4">
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

  // Paid
  if (paid) {
    return (
      <div className="flex flex-col min-h-screen pt-12 pb-20 px-4">
        <PaymentSuccess matchInfo={matchInfo} />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen pt-12 pb-20 px-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <a href={`/my-team/match/${params.matchId}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </a>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Pay Your Share</h1>
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

      {/* Stripe Elements */}
      {clientSecret && (
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
            clientSecret={clientSecret}
            matchId={params.matchId}
            onSuccess={() => setPaid(true)}
          />
        </Elements>
      )}
    </div>
  );
}
