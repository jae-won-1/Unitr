import { supabase } from "@/lib/supabase";

// The signed-in player's own saved card — the only way a browser or phone
// reads it. The card columns on profiles (stripe_customer_id,
// stripe_payment_method_id, card_brand, card_last4) are not readable from a
// client session at all since supabase_launch_security.sql: profiles is
// world-readable, and everyone's card brand and last four digits were on it.
// my_saved_card() returns the caller's own, and nobody else's.
//
// Before that migration the function doesn't exist, so this falls back to
// reading the columns directly — the house "missing migrations degrade" rule.

export type OwnCard = {
  customerId: string | null;
  paymentMethodId: string | null;
  brand: string | null;
  last4: string | null;
};

type Row = {
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  card_brand: string | null;
  card_last4: string | null;
};

const toCard = (r: Row | null | undefined): OwnCard | null =>
  r ? { customerId: r.stripe_customer_id, paymentMethodId: r.stripe_payment_method_id, brand: r.card_brand, last4: r.card_last4 } : null;

/** The caller's card details, or null when they have no profile row. A
 *  profile with no saved card comes back with paymentMethodId null. */
export async function loadOwnCard(userId: string): Promise<OwnCard | null> {
  const { data, error } = await supabase.rpc("my_saved_card");
  if (!error) {
    const row = (Array.isArray(data) ? data[0] : data) as Row | null | undefined;
    return toCard(row);
  }
  const { data: legacy } = await supabase.from("profiles")
    .select("stripe_customer_id, stripe_payment_method_id, card_brand, card_last4")
    .eq("id", userId).maybeSingle();
  return toCard(legacy as Row | null);
}
