"use client";

import { useCallback, useEffect, useState } from "react";
import { authedGet } from "@/lib/authed-fetch";
import { supabase } from "@/lib/supabase";

// "Save this card for future payments" — a tick box in the card form, on
// every surface that takes one (match fee, team credit top-up, ringer spot,
// direct pitch booking).
//
// It used to be a popup AFTER the charge, and that is why the option went
// missing from the payment tab: the popup only rendered for a player with no
// card on file yet, so anyone whose profile already held a customer id never
// saw it, and there was no other way to save a card while paying. Asking
// before the charge also means the payer decides while they are looking at
// the card, not while they are looking at a success screen.
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
    const res = await authedGet(`/api/payment-intent-method?paymentIntentId=${encodeURIComponent(paymentIntentId)}`);
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

// ── The tick box ──────────────────────────────────────────────────────────
// Asked BEFORE paying, in the card form itself, rather than as a popup after
// the charge. The popup only ever appeared for a player with no card saved yet,
// and it appeared on top of a success screen — so on the surfaces where it was
// suppressed there was no way to save a card at all, which is how "save this
// card" went missing from the payment tab.
//
// Unticked by default: this is consent to store a card, so it has to be the
// payer's own act, not something they have to notice and undo.
export function useSaveCardTickbox(userId: string | undefined, opts?: { label?: string }) {
  // undefined until the profile lookup lands.
  const [hasSavedCard, setHasSavedCard] = useState<boolean | undefined>(undefined);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

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

  // Shown to anyone who hasn't already got a card on file. While the lookup is
  // still in flight it renders anyway — a first-time payer is the common case,
  // and hiding it until the answer lands is how it gets missed.
  // Deliberately loud: it replaces Stripe's own mandate line, which we suppress
  // (terms.card: "never" in lib/stripe-client.ts), so this is now the ONLY place
  // the payer is told their card may be kept. It has to carry that meaning and
  // be impossible to miss — hence the filled panel rather than a grey footnote.
  const checkbox = userId && hasSavedCard !== true ? (
    <label
      className={`flex items-start gap-3 p-4 rounded-btn border-2 cursor-pointer select-none transition-colors ${
        checked ? "border-accent bg-accent/10" : "border-border bg-surface-2"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => setChecked(e.target.checked)}
        className="mt-0.5 w-5 h-5 flex-shrink-0 accent-accent cursor-pointer"
      />
      <span className="min-w-0">
        <span className="block text-sm font-bold text-text-primary">
          {opts?.label ?? "Save this card for future payments"}
        </span>
        <span className="block text-xs text-text-secondary leading-snug mt-1">
          Pay in one tap next time, and let Uniter charge your share of match fees
          automatically. You can remove the card any time from your profile.
        </span>
      </span>
    </label>
  ) : null;

  // Called once the payment has succeeded — the card is copied off the intent
  // that just paid, so there is no second authentication. Never throws: the
  // payment is already done and a failure here must not look like one.
  const commit = useCallback(async (paymentIntentId: string | null | undefined): Promise<boolean> => {
    if (!checked || !userId || !paymentIntentId || hasSavedCard === true) return false;
    const ok = await saveCardFromIntent(userId, paymentIntentId);
    if (ok) setHasSavedCard(true);
    return ok;
  }, [checked, userId, hasSavedCard]);

  return { checkbox, commit, checked, hasSavedCard, customerId };
}
