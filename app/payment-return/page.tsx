"use client";

// Where Stripe sends the payer when authenticating had to leave the page.
//
// Every confirm in the app is `redirect: "if_required"`, so most payments never
// come through here — a 3D Secure challenge that can render in place does, and
// the payer never leaves. This exists for the ones that can't: some banks
// insist on a top-level redirect, and without a return_url Stripe would error
// rather than take the payment at all.
//
// The intent's status is read from Stripe rather than trusted from the URL: the
// query string is attacker-controllable and says nothing about whether money
// moved. Credit itself is granted by the webhook, so this page only reports.

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { stripePromise } from "@/lib/stripe-client";
import { clearPendingPayment } from "@/lib/pending-payment";

type Result =
  | { state: "checking" }
  | { state: "paid" }
  | { state: "processing" }
  | { state: "unfinished" }
  | { state: "failed"; message: string };

function PaymentReturn() {
  const params = useSearchParams();
  const [result, setResult] = useState<Result>({ state: "checking" });

  useEffect(() => {
    const clientSecret = params.get("payment_intent_client_secret");
    if (!clientSecret) {
      setResult({ state: "failed", message: "We couldn't find that payment." });
      return;
    }
    let live = true;
    (async () => {
      const stripe = await stripePromise;
      if (!stripe || !live) return;
      const { paymentIntent, error } = await stripe.retrievePaymentIntent(clientSecret);
      if (!live) return;
      if (error || !paymentIntent) {
        setResult({ state: "failed", message: error?.message ?? "We couldn't check that payment." });
        return;
      }
      switch (paymentIntent.status) {
        case "succeeded":
          clearPendingPayment();
          setResult({ state: "paid" });
          break;
        case "processing":
          clearPendingPayment();
          setResult({ state: "processing" });
          break;
        case "requires_action":
        case "requires_confirmation":
          // Leave the remembered entry alone — ResumePaymentBanner offers to
          // pick this up again from wherever the payer goes next.
          setResult({ state: "unfinished" });
          break;
        default:
          clearPendingPayment();
          setResult({ state: "failed", message: "That payment didn't go through — your card wasn't charged." });
      }
    })();
    return () => { live = false; };
  }, [params]);

  const copy = {
    checking: { title: "Checking your payment…", body: "One moment." },
    paid: { title: "Payment complete", body: "Your team balance updates in a moment." },
    processing: { title: "Payment received", body: "Your bank is still settling it. Your balance updates shortly — you can close this." },
    unfinished: { title: "Not finished yet", body: "Your bank hasn't approved this payment. You haven't been charged; head back and we'll pick it up where you left off." },
    failed: { title: "Payment didn't complete", body: result.state === "failed" ? result.message : "" },
  }[result.state];

  return (
    <div className="px-6 pt-24 pb-24 max-w-sm mx-auto text-center">
      {result.state === "checking" ? (
        <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto mb-5" />
      ) : (
        <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5 border ${
          result.state === "paid" || result.state === "processing"
            ? "bg-success-bg border-success-border"
            : "bg-surface-2 border-border"
        }`}>
          {result.state === "paid" || result.state === "processing" ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-text-secondary"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.01"/></svg>
          )}
        </div>
      )}
      <p className="text-lg font-bold mb-1">{copy.title}</p>
      <p className="text-sm text-text-secondary mb-7">{copy.body}</p>
      <a href="/" className="inline-block px-8 py-3 rounded-btn bg-accent text-white font-bold text-sm">
        Back to Unitr
      </a>
    </div>
  );
}

export default function PaymentReturnPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-24"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>}>
      <PaymentReturn />
    </Suspense>
  );
}
