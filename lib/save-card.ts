"use client";

// The write that finishes saving a card, in one place.
//
// A SetupIntent succeeding is not the end of saving a card — the payment
// method still has to land on the profile, or off-session settlement has
// nothing to charge. Two different screens have to be able to do that: the
// profile form, immediately, and ResumePaymentBanner, on the next page load,
// after 3D Secure cost the payer their tab. Duplicating it would mean a card
// recovered by the banner was saved slightly differently from one saved
// normally.
//
// The Stripe customer is NOT written here — /api/create-setup-intent puts it on
// the profile when it creates it, so it is already there by the time a card
// comes back, including on a recovery where the browser has forgotten
// everything the form knew.

import { authedPost } from "@/lib/authed-fetch";
import { supabase } from "@/lib/supabase";

export type SavedCard = { brand: string | null; last4: string | null };

export async function persistSavedCard(userId: string, paymentMethodId: string): Promise<SavedCard> {
  let brand: string | null = null, last4: string | null = null;
  try {
    const res = await authedPost("/api/payment-method", { paymentMethodId });
    const d = await res.json();
    brand = d.brand ?? null; last4 = d.last4 ?? null;
  } catch {
    // brand/last4 are cosmetic — the card is still saved and still chargeable.
  }

  await supabase.from("profiles").update({
    stripe_payment_method_id: paymentMethodId,
    card_brand: brand,
    card_last4: last4,
  }).eq("id", userId);

  return { brand, last4 };
}

// The payment method id off a SetupIntent, which Stripe gives back as either
// the id or the expanded object depending on how the intent was retrieved.
export function paymentMethodIdOf(pm: unknown): string | null {
  if (typeof pm === "string") return pm;
  if (pm && typeof pm === "object" && "id" in pm) return (pm as { id: string }).id;
  return null;
}
