"use client";

// Picks up a card payment the app never heard the end of, and finishes it.
//
// Mounted app-wide in the root layout, so it runs on whatever page the payer
// lands on after their banking app hands them back — including a cold start
// after the browser evicted the tab, which is the case that used to lose the
// payment entirely.
//
// It reads the remembered client secret, asks Stripe what actually happened,
// and does the one useful thing for each answer. Nothing renders unless there
// is a payment to talk about, so the cost on a normal page load is a single
// localStorage read.

import { useCallback, useEffect, useState } from "react";
import type { SetupIntent } from "@stripe/stripe-js";
import { stripePromise } from "@/lib/stripe-client";
import {
  clearPendingPayment,
  readPendingPayment,
  type PendingPayment,
} from "@/lib/pending-payment";
import { paymentMethodIdOf, persistSavedCard } from "@/lib/save-card";
import { useAuth } from "@/contexts/AuthContext";

type View =
  | { state: "hidden" }
  | { state: "resume"; entry: PendingPayment }        // authentication still owed
  | { state: "working" }
  | { state: "done"; entry: PendingPayment }          // paid, credit on its way
  | { state: "orphaned"; entry: PendingPayment }      // paid, but its follow-up write never ran
  | { state: "cardSaved" }                            // a card, saved and recorded
  | { state: "failed"; message: string };

function money(pence: number) {
  return `£${(pence / 100).toFixed(2)}`;
}

export default function ResumePaymentBanner() {
  const { user } = useAuth();
  const [view, setView] = useState<View>({ state: "hidden" });

  // A saved card that lost its tab mid-challenge. Unlike a "booking" payment,
  // this one's follow-up write can be replayed in full: the SetupIntent carries
  // the payment method, and putting it on the profile is all that was left. So
  // the banner finishes the job instead of reporting a half-done one.
  const finishCard = useCallback(async (intent: SetupIntent | undefined): Promise<View> => {
    const pmId = paymentMethodIdOf(intent?.payment_method);
    if (!user || !pmId) {
      // Signed out, or Stripe gave us no card. Leave the entry so the next
      // signed-in load can still record it, and say nothing meanwhile.
      return { state: "hidden" };
    }
    await persistSavedCard(user.id, pmId);
    clearPendingPayment();
    return { state: "cardSaved" };
  }, [user]);

  // Turn a PaymentIntent status into what the payer should be told.
  const settle = useCallback((entry: PendingPayment, status: string | undefined): View => {
    switch (status) {
      case "succeeded":
      case "processing":
        clearPendingPayment();
        // A settled card is finished by finishCard, which has to await the
        // profile write — both callers handle it before reaching here.
        if (entry.kind === "card") return { state: "hidden" };
        // A "booking" payment had a write to make after the charge that never
        // ran. Saying "all done" would be a lie the payer only discovers when
        // the booking isn't there.
        return entry.kind === "booking"
          ? { state: "orphaned", entry }
          : { state: "done", entry };
      case "requires_action":
      case "requires_confirmation":
        return { state: "resume", entry };
      case "requires_payment_method":
        clearPendingPayment();
        return {
          state: "failed",
          message: entry.kind === "card"
            ? "That card wasn't saved — nothing has been charged."
            : "That payment didn't go through — your card wasn't charged.",
        };
      case "canceled":
        clearPendingPayment();
        return { state: "hidden" };
      default:
        clearPendingPayment();
        return { state: "hidden" };
    }
  }, []);

  useEffect(() => {
    const entry = readPendingPayment();
    if (!entry) return;
    let live = true;
    (async () => {
      const stripe = await stripePromise;
      if (!stripe || !live) return;

      if (entry.kind === "card") {
        const { setupIntent, error: setupError } = await stripe.retrieveSetupIntent(entry.clientSecret);
        if (!live) return;
        if (setupError || !setupIntent) { clearPendingPayment(); return; }
        if (setupIntent.status === "succeeded") {
          const next = await finishCard(setupIntent);
          if (live) setView(next);
          return;
        }
        setView(settle(entry, setupIntent.status));
        return;
      }

      const { paymentIntent, error } = await stripe.retrievePaymentIntent(entry.clientSecret);
      if (!live) return;
      if (error || !paymentIntent) {
        // A secret Stripe won't recognise (wrong account, too old) is not worth
        // showing anyone — drop it rather than nagging about a ghost.
        clearPendingPayment();
        return;
      }
      setView(settle(entry, paymentIntent.status));
    })();
    return () => { live = false; };
  }, [settle, finishCard]);

  // Re-open the challenge the payer walked away from. handleNextAction picks up
  // exactly where confirmPayment left off, so no card details are asked for
  // again — the card is already attached to the intent.
  const resume = async (entry: PendingPayment) => {
    setView({ state: "working" });
    const stripe = await stripePromise;
    if (!stripe) { setView({ state: "resume", entry }); return; }
    // handleNextAction drives a SetupIntent's challenge exactly as it drives a
    // PaymentIntent's, so saving a card resumes through the same call.
    const { paymentIntent, setupIntent, error } = await stripe.handleNextAction({ clientSecret: entry.clientSecret });
    if (error) {
      setView({ state: "failed", message: error.message ?? "Couldn't finish that payment." });
      return;
    }
    if (entry.kind === "card") {
      if (setupIntent?.status === "succeeded") { setView(await finishCard(setupIntent)); return; }
      setView(settle(entry, setupIntent?.status));
      return;
    }
    setView(settle(entry, paymentIntent?.status));
  };

  const dismiss = () => { clearPendingPayment(); setView({ state: "hidden" }); };

  if (view.state === "hidden") return null;

  // Above the BottomNav (z-40), below every sheet and modal (z-[60]) — the
  // house floor, so a payment sheet still covers this rather than fighting it.
  const shell = "fixed left-0 right-0 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-50 px-4";

  if (view.state === "working") {
    return (
      <div className={shell}>
        <div className="max-w-lg mx-auto bg-surface border border-border shadow-card rounded-2xl px-4 py-3 flex items-center gap-3">
          <div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin flex-shrink-0" />
          <p className="text-xs text-text-secondary">Finishing your payment…</p>
        </div>
      </div>
    );
  }

  if (view.state === "cardSaved") {
    return (
      <div className={shell}>
        <div className="max-w-lg mx-auto bg-surface border border-success-border shadow-card rounded-2xl px-4 py-3 flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-success-bg border border-success-border flex items-center justify-center flex-shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold">Card saved</p>
            <p className="text-[11px] text-text-secondary">It&apos;s on your profile, ready for auto-settlement.</p>
          </div>
          <button onClick={() => setView({ state: "hidden" })} className="text-xs font-semibold text-text-secondary px-2 flex-shrink-0">Close</button>
        </div>
      </div>
    );
  }

  if (view.state === "resume") {
    const isCard = view.entry.kind === "card";
    return (
      <div className={shell}>
        <div className="max-w-lg mx-auto bg-surface border border-accent/40 shadow-card rounded-2xl px-4 py-3">
          <p className="text-sm font-bold">
            {isCard ? "Finish saving your card" : `Finish your ${money(view.entry.amountPence)} payment`}
          </p>
          <p className="text-[11px] text-text-secondary mt-0.5 leading-snug">
            {isCard
              ? "Your bank still needs to approve it. Nothing has been charged."
              : `${view.entry.label} — your bank still needs to approve it. You haven't been charged yet.`}
          </p>
          <div className="flex gap-2 mt-3">
            <button onClick={dismiss}
              className="flex-1 py-2 rounded-xl border border-border text-xs font-semibold text-text-secondary">
              Not now
            </button>
            <button onClick={() => resume(view.entry)}
              className="flex-1 py-2 rounded-btn bg-accent text-white text-xs font-bold">
              {isCard ? "Finish saving" : "Finish payment"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (view.state === "done") {
    return (
      <div className={shell}>
        <div className="max-w-lg mx-auto bg-surface border border-success-border shadow-card rounded-2xl px-4 py-3 flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-success-bg border border-success-border flex items-center justify-center flex-shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold">{money(view.entry.amountPence)} payment completed</p>
            <p className="text-[11px] text-text-secondary">Your team balance updates in a moment.</p>
          </div>
          <button onClick={() => setView({ state: "hidden" })} className="text-xs font-semibold text-text-secondary px-2 flex-shrink-0">Close</button>
        </div>
      </div>
    );
  }

  if (view.state === "orphaned") {
    return (
      <div className={shell}>
        <div className="max-w-lg mx-auto bg-surface border border-amber-500/40 shadow-card rounded-2xl px-4 py-3">
          <p className="text-xs font-bold">{money(view.entry.amountPence)} payment went through</p>
          <p className="text-[11px] text-text-secondary mt-0.5 leading-snug">
            {view.entry.label} — but the app lost track before it was confirmed. Check your Calendar,
            and if it isn&apos;t there, message us and we&apos;ll refund it.
          </p>
          <button onClick={() => setView({ state: "hidden" })}
            className="w-full mt-3 py-2 rounded-xl border border-border text-xs font-semibold text-text-secondary">
            Got it
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={shell}>
      <div className="max-w-lg mx-auto bg-surface border border-red-500/40 shadow-card rounded-2xl px-4 py-3 flex items-center gap-3">
        <p className="text-[11px] text-text-secondary flex-1">{view.message}</p>
        <button onClick={() => setView({ state: "hidden" })} className="text-xs font-semibold text-text-secondary px-2 flex-shrink-0">Close</button>
      </div>
    </div>
  );
}
