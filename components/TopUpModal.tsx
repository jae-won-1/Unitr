"use client";

import { useEffect, useState } from "react";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { supabase } from "@/lib/supabase";
import { stripePromise } from "@/lib/stripe-client";

const PRESETS_POUNDS = [10, 20, 50, 100];

// ── Card entry (inside <Elements>) ────────────────────────────
function TopUpCheckoutForm({ amount, teamId, userId, currentPence, onSuccess, onBack }: {
  amount: number; teamId: string; userId: string; currentPence: number;
  onSuccess: (newBalancePence: number) => void; onBack: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const handlePay = async () => {
    if (!stripe || !elements) return;
    setPaying(true);
    setPayError(null);
    const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (error) { setPayError(error.message ?? "Payment failed."); setPaying(false); return; }
    if (paymentIntent?.status !== "succeeded") {
      setPayError("Payment did not complete. Please try again.");
      setPaying(false);
      return;
    }
    const { data: newBalancePence } = await supabase.rpc("add_credit", {
      p_team_id: teamId,
      p_amount_pence: Math.round(amount * 100),
      p_player_id: userId,
    });
    onSuccess(typeof newBalancePence === "number" ? newBalancePence : currentPence + Math.round(amount * 100));
  };

  return (
    <div className="space-y-4">
      <div className="bg-surface-2 border border-border rounded-xl px-4 py-3 text-xs space-y-1.5">
        <div className="flex justify-between text-text-secondary"><span>Adding to team credits</span><span className="font-bold text-text-primary">£{amount.toFixed(2)}</span></div>
        <div className="flex justify-between text-text-secondary"><span>New balance</span><span className="font-bold text-accent">£{(currentPence / 100 + amount).toFixed(2)}</span></div>
      </div>
      <div className="bg-surface-2 border border-border rounded-xl p-4">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">Card Details</p>
        <PaymentElement options={{ layout: "tabs", paymentMethodOrder: ["card"] }} />
      </div>
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl px-4 py-3">
        <p className="text-[11px] text-blue-300 font-semibold mb-0.5">Test Mode</p>
        <p className="text-[11px] text-blue-200">Use <span className="font-mono font-bold">4242 4242 4242 4242</span> · any future expiry · any CVC</p>
      </div>
      {payError && <p className="text-xs text-red-400 text-center">{payError}</p>}
      <button onClick={handlePay} disabled={!stripe || paying}
        className="w-full py-3.5 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50">
        {paying ? "Processing…" : `Pay £${amount.toFixed(2)}`}
      </button>
      <button onClick={onBack} disabled={paying} className="w-full py-2 text-xs text-text-secondary disabled:opacity-50">← Back</button>
    </div>
  );
}

// ── Top up team credit ─────────────────────────────────────────
// Self-contained popup: pick an amount, pay via Stripe, credit the team.
// suggestedPence prefills the amount (e.g. a booking shortfall) rounded up
// to the nearest pound so the top-up covers it exactly.
export default function TopUpModal({ teamId, userId, currentPence, suggestedPence, onClose, onSuccess }: {
  teamId: string; userId: string; currentPence: number; suggestedPence?: number;
  onClose: () => void; onSuccess: (newBalancePence: number) => void;
}) {
  const suggestedPounds = suggestedPence && suggestedPence > 0 ? Math.ceil(suggestedPence / 100) : null;
  const [selectedAmount, setSelectedAmount] = useState<number | null>(suggestedPounds);
  const [customInput, setCustomInput] = useState("");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loadingSecret, setLoadingSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null); // new balance pence, once paid

  const effectiveAmount = customInput ? parseFloat(customInput) : selectedAmount;

  const handleContinue = async () => {
    if (!effectiveAmount || effectiveAmount < 1) return;
    setError(null);
    setLoadingSecret(true);
    try {
      const res = await fetch("/api/create-credits-intent", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountPence: Math.round(effectiveAmount * 100), teamId }),
      });
      const data = await res.json();
      if (data.clientSecret) setClientSecret(data.clientSecret);
      else setError(data.error ?? "Could not start payment.");
    } catch {
      setError("Could not reach the payment service.");
    }
    setLoadingSecret(false);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-[#141414] border border-border rounded-2xl p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {done !== null ? (
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center mx-auto mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <p className="text-lg font-bold mb-1">Top up complete</p>
            <p className="text-sm text-text-secondary mb-5">£{effectiveAmount?.toFixed(2)} added to your team balance.</p>
            <button onClick={() => onSuccess(done)} className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm">Continue</button>
          </div>
        ) : (
          <>
            <p className="text-lg font-bold mb-1">Top up team credit</p>
            <p className="text-xs text-text-secondary mb-4">
              {suggestedPounds ? `Add at least £${suggestedPounds} to cover this booking.` : "Add funds to your team's balance."}
            </p>

            {!clientSecret ? (
              <>
                <div className="grid grid-cols-4 gap-2 mb-3">
                  {PRESETS_POUNDS.map((amt) => (
                    <button key={amt} onClick={() => { setSelectedAmount(amt); setCustomInput(""); }}
                      className={`py-3 rounded-xl border text-sm font-bold transition-colors ${selectedAmount === amt && !customInput ? "bg-accent text-black border-accent" : "bg-surface-2 border-border text-text-primary"}`}>
                      £{amt}
                    </button>
                  ))}
                </div>
                <input type="number" min={1} step={1} value={customInput}
                  onChange={(e) => { setCustomInput(e.target.value); setSelectedAmount(null); }}
                  placeholder="Custom amount (£)"
                  className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/50 mb-4" />

                {effectiveAmount && effectiveAmount >= 1 && (
                  <div className="bg-surface-2 border border-border rounded-xl px-3 py-2.5 mb-4 text-xs space-y-1">
                    <div className="flex justify-between text-text-secondary"><span>Adding</span><span className="font-semibold text-text-primary">£{effectiveAmount.toFixed(2)}</span></div>
                    <div className="flex justify-between text-text-secondary"><span>New balance</span><span className="font-semibold text-accent">£{(currentPence / 100 + effectiveAmount).toFixed(2)}</span></div>
                  </div>
                )}

                {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

                <div className="flex gap-3">
                  <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold text-text-secondary">Cancel</button>
                  <button onClick={handleContinue} disabled={!effectiveAmount || effectiveAmount < 1 || loadingSecret}
                    className="flex-1 py-3 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50">
                    {loadingSecret ? "Loading…" : effectiveAmount && effectiveAmount >= 1 ? `Continue to pay £${effectiveAmount.toFixed(2)}` : "Enter an amount"}
                  </button>
                </div>
              </>
            ) : (
              <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "night", variables: { colorPrimary: "#00E676", colorBackground: "#1a1a1a", colorText: "#ffffff", borderRadius: "12px" } } }}>
                <TopUpCheckoutForm
                  amount={effectiveAmount as number}
                  teamId={teamId}
                  userId={userId}
                  currentPence={currentPence}
                  onSuccess={(newBalancePence) => setDone(newBalancePence)}
                  onBack={() => setClientSecret(null)}
                />
              </Elements>
            )}
          </>
        )}
      </div>
    </div>
  );
}
