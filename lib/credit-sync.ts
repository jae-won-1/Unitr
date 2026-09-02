import { supabase } from "@/lib/supabase";

// Team credit is applied by the Stripe webhook (/api/webhooks/stripe), not by
// the browser — so after confirmPayment() resolves, the new balance arrives a
// moment later rather than immediately. Poll until it moves.
//
// Returns the new balance, or null if it hasn't landed yet. Null is NOT a
// failure: Stripe retries a webhook until it's acknowledged, so the credit is
// still coming. Callers should say "on its way", never "it failed" — the
// player has already been charged at this point.
export async function waitForCredit(
  teamId: string,
  balanceBeforePence: number,
  timeoutMs = 15000,
): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  let delay = 400;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    const { data } = await supabase
      .from("team_credits")
      .select("balance_pence")
      .eq("team_id", teamId)
      .maybeSingle();
    if (typeof data?.balance_pence === "number" && data.balance_pence > balanceBeforePence) {
      return data.balance_pence;
    }
    delay = Math.min(Math.round(delay * 1.5), 2000);  // back off, don't hammer
  }
  return null;
}
