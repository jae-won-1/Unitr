import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCallerId } from "@/lib/api-auth";

// What the client is allowed to ask for. Note what is NOT here: playerId,
// customerId and paymentMethodId used to arrive in the body, so anyone who
// could read a profile row — which is everyone, profiles are world-readable —
// could charge a stranger's saved card any amount they liked. The caller is
// now identified from their session token and the card is looked up from
// their own profile.
type SettleItem = {
  amountPence: number;    // total to charge (pitch share + 5% fee)
  sharePence: number;     // the pitch share portion (refills team credit)
  feePence: number;       // the 5% Unitr fee portion
  teamId?: string | null; // set to refill this team's credit from the charge
  pcsId?: string | null;  // a due row — its amount overrides the one sent
  matchId?: string;
  openMatchId?: string;   // set instead of matchId for a tournament entry fee
  bookingId?: string | null;
};

type SettleResult = {
  playerId: string;
  ok: boolean;
  paymentIntentId?: string;
  creditedBalancePence?: number | null;  // team balance after the refill
  error?: string;
  noCard?: boolean;
  requiresAction?: boolean;
};

// Charge the caller's own saved card off-session and refill their team's credit.
//
// SCOPE: this route only ever charges the person calling it. Bulk roster-lock
// settlement across a squad would charge other people's cards and needs its
// own captain-authorised path with per-player consent — no caller does that
// today, so it is refused rather than left open.
export async function POST(req: NextRequest) {
  try {
    const callerId = await getCallerId(req);
    if (!callerId) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const { items } = (await req.json()) as { items: SettleItem[] };
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Nothing to settle" }, { status: 400 });
    }

    // The caller's card, from the database — never from the request.
    const { data: profile } = await adminSupabase
      .from("profiles")
      .select("stripe_customer_id, stripe_payment_method_id")
      .eq("id", callerId)
      .maybeSingle();

    const customerId = profile?.stripe_customer_id as string | undefined;
    const paymentMethodId = profile?.stripe_payment_method_id as string | undefined;
    if (!customerId || !paymentMethodId) {
      return NextResponse.json({
        results: items.map(() => ({ playerId: callerId, ok: false, noCard: true, error: "No saved card" })),
      });
    }

    const results: SettleResult[] = [];
    for (const it of items) {
      // Where the charge settles a recorded due, the amount comes from that
      // row rather than the body — and the row has to belong to the caller.
      let amountPence = Math.round(it.amountPence);
      let sharePence = Math.round(it.sharePence);
      const feePence = Math.round(it.feePence ?? 0);

      if (it.pcsId) {
        const { data: due } = await adminSupabase
          .from("payment_collection_status")
          .select("player_id, share_pence, credited_pence")
          .eq("id", it.pcsId)
          .maybeSingle();
        if (!due) {
          results.push({ playerId: callerId, ok: false, error: "That charge no longer exists." });
          continue;
        }
        if (due.player_id !== callerId) {
          results.push({ playerId: callerId, ok: false, error: "That charge belongs to another player." });
          continue;
        }
        const outstanding = (due.share_pence as number) - ((due.credited_pence as number) ?? 0);
        if (outstanding <= 0) {
          results.push({ playerId: callerId, ok: false, error: "That charge is already settled." });
          continue;
        }
        amountPence = outstanding + feePence;
        sharePence = outstanding;
      }

      if (!Number.isFinite(amountPence) || amountPence < 100) {
        results.push({ playerId: callerId, ok: false, error: "Amount must be at least £1.00." });
        continue;
      }

      try {
        const pi = await stripe.paymentIntents.create({
          amount: amountPence,
          currency: "gbp",
          customer: customerId,
          payment_method: paymentMethodId,
          off_session: true,
          confirm: true,
          metadata: {
            type: "match_settlement",
            playerId: callerId,
            matchId: it.matchId ?? "",
            openMatchId: it.openMatchId ?? "",
            bookingId: it.bookingId ?? "",
            teamId: it.teamId ?? "",
            pitchShare: sharePence,
            unitrFee: feePence,
          },
          description: `Unitr match settlement — £${(sharePence / 100).toFixed(2)} pitch + £${(feePence / 100).toFixed(2)} fee`,
        });

        if (pi.status === "succeeded") {
          // Refill the team's credit here, on the server that watched the
          // charge succeed. Keyed on the PaymentIntent id, so a retried
          // request credits only once.
          let creditedBalancePence: number | null = null;
          if (it.teamId) {
            const { data, error } = await adminSupabase.rpc("credit_from_payment", {
              p_team_id: it.teamId,
              p_amount_pence: sharePence,
              p_player_id: callerId,
              p_payment_intent_id: pi.id,
            });
            if (error) {
              // Charged but not credited. Say so rather than reporting success —
              // the payment is real and needs reconciling by hand.
              console.error(`settle-match: credit failed for ${pi.id}:`, error.message);
              results.push({
                playerId: callerId, ok: false, paymentIntentId: pi.id,
                error: "Payment taken but credit could not be applied — contact support.",
              });
              continue;
            }
            creditedBalancePence = typeof data === "number" ? data : null;
          }
          results.push({ playerId: callerId, ok: true, paymentIntentId: pi.id, creditedBalancePence });
        } else {
          // e.g. requires_action — can't complete off-session.
          results.push({ playerId: callerId, ok: false, requiresAction: true, error: `Card needs authentication (${pi.status})` });
        }
      } catch (err) {
        const e = err as { code?: string; message?: string };
        results.push({
          playerId: callerId,
          ok: false,
          requiresAction: e.code === "authentication_required",
          error: e.message ?? "Card declined",
        });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    console.error("Stripe settle-match error:", err);
    return NextResponse.json({ error: "Settlement failed" }, { status: 500 });
  }
}
