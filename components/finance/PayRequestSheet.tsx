"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import BottomSheet from "@/components/BottomSheet";
import TestModeNote from "@/components/TestModeNote";
import { useSaveCardTickbox } from "@/components/SaveCardPrompt";
import { stripePromise, cardElementOptions } from "@/lib/stripe-client";
import { confirmCardPayment } from "@/lib/confirm-payment";
import {
  confirmRequestPayment, failed, pounds, startRequestPayment,
  type FinanceRequest, type PaymentStart,
} from "@/lib/team-finance";

// A member paying their share of one payment request by card.
//
// The server decides everything about the charge — the share is what this
// member's row still owes, the fee is added on top, and the money goes to the
// team's linked account (/api/finance/pay-intent). This sheet only collects
// the card and confirms it, through confirmCardPayment like every other card
// surface, so 3D Secure on a phone is recovered the same way.

function CardForm({ start, title, saveCardSlot, onPaid }: {
  start: PaymentStart; title: string; saveCardSlot: ReactNode;
  onPaid: (paymentIntentId: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pay = async () => {
    if (!stripe || !elements) return;
    setPaying(true);
    setError(null);
    const { error: payError, paymentIntent } = await confirmCardPayment({
      stripe, elements, clientSecret: start.clientSecret,
      // "credit": finishing the payment is all that is left — the webhook
      // records it off the intent, so a resumed payment needs nothing more.
      kind: "credit", amountPence: start.totalPence, label: title,
    });
    if (payError) { setError(payError.message ?? "Payment failed."); setPaying(false); return; }
    if (paymentIntent?.status === "succeeded" || paymentIntent?.status === "processing") {
      onPaid(paymentIntent.id);
    } else {
      setError("Payment did not complete. Please try again.");
      setPaying(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-panel border border-border rounded-btn px-4 py-3 text-xs space-y-1.5">
        <div className="flex justify-between text-text-secondary">
          <span>{title}</span><span className="font-semibold text-text-primary">{pounds(start.sharePence)}</span>
        </div>
        {start.feePence > 0 && (
          <div className="flex justify-between text-text-secondary">
            <span>Service fee</span><span className="font-semibold text-text-primary">{pounds(start.feePence)}</span>
          </div>
        )}
        <div className="flex justify-between pt-1.5 border-t border-border">
          <span className="font-bold text-text-primary">Total</span>
          <span className="font-bold text-text-primary">{pounds(start.totalPence)}</span>
        </div>
      </div>
      <p className="text-[11px] text-text-secondary leading-snug">
        Your team receives {pounds(start.sharePence)}, paid into its own bank account.
      </p>
      <div className="bg-surface border border-border rounded-btn p-4">
        <PaymentElement options={cardElementOptions} />
      </div>
      {saveCardSlot}
      <TestModeNote />
      {error && <p className="text-xs text-red-600 text-center">{error}</p>}
      <button onClick={pay} disabled={!stripe || paying}
        className="w-full py-3.5 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-50">
        {paying ? "Processing…" : `Pay ${pounds(start.totalPence)}`}
      </button>
    </div>
  );
}

export default function PayRequestSheet({ request, userId, onClose, onPaid }: {
  request: FinanceRequest;
  userId: string;
  onClose: () => void;
  /** The payment went through — reload whatever shows what is owed. */
  onPaid: () => void;
}) {
  const [start, setStart] = useState<PaymentStart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const saveCard = useSaveCardTickbox(userId);

  useEffect(() => {
    let live = true;
    startRequestPayment(request.id).then((res) => {
      if (!live) return;
      if (failed(res)) setError(res.error);
      else setStart(res);
    });
    return () => { live = false; };
  }, [request.id]);

  const finish = async (paymentIntentId: string) => {
    // Tick the row now rather than waiting on the webhook, then keep the card
    // if they asked to. Neither may undo a payment that has already happened.
    await confirmRequestPayment(paymentIntentId);
    await saveCard.commit(paymentIntentId);
    setPaid(true);
    onPaid();
  };

  return (
    <BottomSheet title={paid ? "Paid" : "Pay"} subtitle={request.title} onClose={onClose}>
      {paid ? (
        <div className="flex flex-col items-center text-center gap-4 py-4">
          <div className="w-16 h-16 rounded-full bg-success-bg border-2 border-success-border flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <p className="text-sm text-text-secondary">
            {start ? `${pounds(start.sharePence)} has gone to your team.` : "Your payment went through."}
          </p>
          <button onClick={onClose} className="w-full py-3 rounded-btn bg-accent text-white font-bold text-sm">Done</button>
        </div>
      ) : error ? (
        <div className="space-y-4 py-2">
          <p className="text-sm text-text-primary">{error}</p>
          <button onClick={onClose} className="w-full py-3 rounded-btn border border-border font-bold text-sm">Close</button>
        </div>
      ) : !start ? (
        <div className="py-10 flex justify-center">
          <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        </div>
      ) : (
        <Elements stripe={stripePromise} options={{ clientSecret: start.clientSecret, appearance: { theme: "stripe", variables: { colorPrimary: "#008000", borderRadius: "12px" } } }}>
          <CardForm start={start} title={request.title} saveCardSlot={saveCard.checkbox} onPaid={finish} />
        </Elements>
      )}
    </BottomSheet>
  );
}
