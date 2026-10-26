import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";

// A per-person limit on the routes that open a payment — PaymentIntents,
// SetupIntents, off-session charges. Without one, a script with a valid
// session could open thousands of intents (Stripe bills for card testing and
// can suspend the account for it) or hammer a saved card.
//
// The counter is hit_rate_limit() in supabase_launch_security.sql. If that
// hasn't been run, or the database can't be reached, the request is let
// through: refusing every payment is worse than an unlimited route for a
// while. The house "missing migrations degrade" rule.

/** 20 payment starts per person per 10 minutes — far above what anyone
 *  paying for real does, low enough to make card testing pointless. */
const WINDOW_SECONDS = 600;
const MAX_HITS = 20;

/** Null to go ahead, or the 429 to return. `bucket` names the route family. */
export async function paymentRateLimit(callerId: string, bucket = "payments"): Promise<NextResponse | null> {
  const { data, error } = await adminSupabase.rpc("hit_rate_limit", {
    p_key: `${bucket}:${callerId}`,
    p_window_seconds: WINDOW_SECONDS,
    p_max: MAX_HITS,
  });
  if (error || data !== false) return null;
  return NextResponse.json(
    { error: "Too many payment attempts. Wait a few minutes and try again." },
    { status: 429 },
  );
}
