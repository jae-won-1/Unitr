import { stripe } from "@/lib/stripe";
import { adminSupabase } from "@/lib/supabase-admin";

// One Stripe customer per player, resolved in one place.
//
// Every intent route needs the payer's customer: `setup_future_usage:
// "off_session"` only attaches the card to a customer, and off-session
// settlement later charges `profiles.stripe_customer_id` +
// `stripe_payment_method_id` as a pair. Three of the four routes used to mint a
// customer when the profile had none and then throw the id away — the intent
// carried it, the profile never learned it. So a player who paid four times had
// four Stripe customers, each holding one card, and the profile pointed at none
// of them until the post-payment "save this card" prompt happened to write one.
// A saved card then failed off-session with "no such payment method for this
// customer", because the pair came from two different attempts.
//
// Writing the id at creation time — the way /api/create-setup-intent already
// did — makes the next call reuse it, so a player accumulates one customer no
// matter how many payments they abandon.
export async function ensureStripeCustomer(
  userId: string,
  email?: string | null,
  name?: string | null,
): Promise<string> {
  const { data } = await adminSupabase
    .from("profiles").select("stripe_customer_id").eq("id", userId).maybeSingle();
  const existing = (data?.stripe_customer_id as string | null) ?? null;
  if (existing) return existing;

  const created = await stripe.customers.create({
    email: email ?? undefined,
    name: name ?? undefined,
    metadata: { app: "uniter", playerId: userId },
  });

  // Persisted before the intent is created, so an abandoned payment still
  // leaves a reusable customer rather than an orphan per attempt.
  await adminSupabase.from("profiles")
    .update({ stripe_customer_id: created.id }).eq("id", userId);

  return created.id;
}
