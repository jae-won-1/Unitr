"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// "Save this card for next time?" — offered once, after a player's first
// successful card payment on any surface (match fee, team credit top-up,
// ringer spot, direct pitch booking).
//
// Saving writes stripe_customer_id + stripe_payment_method_id to the profile
// (supabase_card_on_file.sql), which is what every surface already reads to
// offer instant pay, and what /api/settle-match charges off-session at roster
// lock. Nothing here is required for the payment itself — it has already
// succeeded by the time this is shown, so every failure path below is
// swallowed rather than surfaced.
//
// PRECONDITION: the PaymentIntent must have been created with a `customer`
// and setup_future_usage: "off_session". Without both, Stripe never attaches
// the payment method to a customer and the saved card can't be charged later.
// All four intent routes do this — see /api/create-payment-intent,
// /api/create-credits-intent and /api/ringer/create-intent.

// Copy the card Stripe attached during `paymentIntentId` onto the profile.
// Resolves regardless of outcome; callers continue on either way.
export async function saveCardFromIntent(userId: string, paymentIntentId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/payment-intent-method?paymentIntentId=${encodeURIComponent(paymentIntentId)}`);
    const data = await res.json();
    if (!data.paymentMethodId || !data.customerId) return false;
    await supabase.from("profiles").update({
      stripe_customer_id: data.customerId,
      stripe_payment_method_id: data.paymentMethodId,
      card_brand: data.brand ?? null,
      card_last4: data.last4 ?? null,
    }).eq("id", userId);
    return true;
  } catch {
    return false;
  }
}

// ── The prompt itself ─────────────────────────────────────────────────────
// Renders above everything: it appears on top of payment popups that are
// themselves z-[70]/z-[80], and the nav chrome floor is z-40.
export function SaveCardPrompt({ onSave, onSkip, saving, title, blurb }: {
  onSave: () => void; onSkip: () => void; saving: boolean;
  title?: string; blurb?: string;
}) {
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-scrim px-5">
      <div className="w-full max-w-sm bg-surface border border-border rounded-2xl p-6 text-center">
        <div className="w-14 h-14 rounded-full bg-accent/20 border-2 border-accent flex items-center justify-center mx-auto mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2" strokeLinecap="round">
            <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
          </svg>
        </div>
        <p className="text-lg font-bold mb-2">{title ?? "Payment confirmed"}</p>
        <p className="text-sm text-text-secondary mb-6">
          {blurb ?? "Save this card so your next payment is instant — no need to enter your details again."}
        </p>
        <div className="flex gap-2">
          <button onClick={onSkip} disabled={saving}
            className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold text-text-secondary disabled:opacity-50">
            No thanks
          </button>
          <button onClick={onSave} disabled={saving}
            className="flex-1 py-3 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-50">
            {saving ? "Saving…" : "Save card"}
          </button>
        </div>
        <p className="text-[10px] text-text-secondary mt-3">You can remove it any time from your profile.</p>
      </div>
    </div>
  );
}

// ── Drop-in wiring for a payment surface ──────────────────────────────────
// Usage:
//   const saveCard = useSaveCardOffer(userId);
//   ...pass saveCard.customerId when creating the PaymentIntent...
//   // after a manual-card payment succeeds:
//   saveCard.offer(paymentIntent.id, () => { /* carry on as before */ });
//   // and render, above the surface's own markup:
//   {saveCard.prompt}
//
// `offer` runs `next` straight away for anyone who already has a card saved,
// so the caller's success path is the same shape whether or not a prompt
// appears — no branching at the call site.
export function useSaveCardOffer(userId: string | undefined, opts?: { title?: string; blurb?: string }) {
  // undefined until the profile lookup lands. Treated as "already has one"
  // by `offer` so a prompt can never flash before we know the answer.
  const [hasSavedCard, setHasSavedCard] = useState<boolean | undefined>(undefined);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ intentId: string; next: () => void } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) { setHasSavedCard(undefined); setCustomerId(null); return; }
    let live = true;
    supabase.from("profiles")
      .select("stripe_customer_id, stripe_payment_method_id")
      .eq("id", userId).maybeSingle()
      .then(({ data }) => {
        if (!live) return;
        setCustomerId((data?.stripe_customer_id as string | null) ?? null);
        setHasSavedCard(Boolean(data?.stripe_customer_id && data?.stripe_payment_method_id));
      });
    return () => { live = false; };
  }, [userId]);

  const offer = useCallback((paymentIntentId: string | null | undefined, next: () => void) => {
    if (!userId || !paymentIntentId || hasSavedCard !== false) { next(); return; }
    setPending({ intentId: paymentIntentId, next });
  }, [userId, hasSavedCard]);

  const handleSave = async () => {
    if (!pending || !userId) return;
    setSaving(true);
    const ok = await saveCardFromIntent(userId, pending.intentId);
    if (ok) setHasSavedCard(true);
    setSaving(false);
    const { next } = pending;
    setPending(null);
    next();
  };

  const handleSkip = () => {
    if (!pending) return;
    const { next } = pending;
    setPending(null);
    next();
  };

  const prompt = pending
    ? <SaveCardPrompt onSave={handleSave} onSkip={handleSkip} saving={saving} title={opts?.title} blurb={opts?.blurb} />
    : null;

  return { offer, prompt, customerId, hasSavedCard };
}
