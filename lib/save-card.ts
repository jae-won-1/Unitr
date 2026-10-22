"use client";

// The step that finishes saving a card, in one place.
//
// A SetupIntent succeeding is not the end of saving a card — the payment
// method still has to land on the profile, or off-session settlement has
// nothing to charge. Two different screens have to be able to do that: the
// profile form, immediately, and ResumePaymentBanner, on the next page load,
// after 3D Secure cost the payer their tab. Duplicating it would mean a card
// recovered by the banner was saved slightly differently from one saved
// normally.
//
// The profile write itself happens on the server (/api/payment-method,
// /api/payment-intent-method), which first checks the card is on the caller's
// own Stripe customer. The browser used to write the card columns directly,
// which let anyone copy a stranger's card onto their own profile and spend it;
// supabase_card_and_credit_lockdown.sql now refuses that write. Clearing a card
// (Remove card on /profile) is still a client write — the database allows a
// card column to be set to null, never to a value.
//
// The `userId` parameters are kept so callers on both apps stay unchanged; the
// server takes the player from the session, never from here.

import { authedPost } from "@/lib/authed-fetch";
import { STRIPE_TEST_MODE } from "@/lib/stripe-mode";

export type SavedCard = { brand: string | null; last4: string | null };

export async function persistSavedCard(_userId: string, paymentMethodId: string): Promise<SavedCard> {
  try {
    // In test mode the route reads the card back and writes nothing — a test
    // card would replace this player's live one (lib/stripe-mode.ts).
    const res = await authedPost("/api/payment-method", { paymentMethodId });
    const d = await res.json();
    if (!res.ok) console.error("persistSavedCard:", d.error ?? res.status);
    return { brand: d.brand ?? null, last4: d.last4 ?? null };
  } catch (err) {
    console.error("persistSavedCard:", err);
    return { brand: null, last4: null };
  }
}

// The payment method id off a SetupIntent, which Stripe gives back as either
// the id or the expanded object depending on how the intent was retrieved.
export function paymentMethodIdOf(pm: unknown): string | null {
  if (typeof pm === "string") return pm;
  if (pm && typeof pm === "object" && "id" in pm) return (pm as { id: string }).id;
  return null;
}

// Moved here from components/SaveCardPrompt.tsx so the mobile app can save the
// card off an intent it has just paid, the same way the web does.
// Copy the card Stripe attached during `paymentIntentId` onto the profile.
// Resolves regardless of outcome; callers continue on either way.
export async function saveCardFromIntent(_userId: string, paymentIntentId: string): Promise<boolean> {
  // Never in test mode — see persistSavedCard above and lib/stripe-mode.ts.
  if (STRIPE_TEST_MODE) return false;
  try {
    const res = await authedPost("/api/payment-intent-method", { paymentIntentId });
    const data = await res.json();
    return res.ok && data.saved === true;
  } catch {
    return false;
  }
}
