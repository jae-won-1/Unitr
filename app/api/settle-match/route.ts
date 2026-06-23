import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

type SettleItem = {
  playerId: string;
  customerId: string | null;
  paymentMethodId: string | null;
  amountPence: number;   // total to charge (pitch share + 5% fee)
  sharePence: number;    // the pitch share portion (refills team credit)
  feePence: number;      // the 5% Unitr fee portion
  matchId?: string;
  bookingId?: string | null;
};

type SettleResult = {
  playerId: string;
  ok: boolean;
  paymentIntentId?: string;
  error?: string;
  noCard?: boolean;
  requiresAction?: boolean;
};

// Roster-lock settlement: charge each actual participant's saved card off-session.
// Returns a per-player result so the client can refill credit for successes and
// fall back to the manual /pay screen for failures.
export async function POST(req: NextRequest) {
  try {
    const { items } = (await req.json()) as { items: SettleItem[] };
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "No participants to settle" }, { status: 400 });
    }

    const results: SettleResult[] = [];
    for (const it of items) {
      if (!it.customerId || !it.paymentMethodId) {
        results.push({ playerId: it.playerId, ok: false, noCard: true, error: "No saved card" });
        continue;
      }
      try {
        const pi = await stripe.paymentIntents.create({
          amount: Math.round(it.amountPence),
          currency: "gbp",
          customer: it.customerId,
          payment_method: it.paymentMethodId,
          off_session: true,
          confirm: true,
          metadata: {
            type: "match_settlement",
            playerId: it.playerId,
            matchId: it.matchId ?? "",
            bookingId: it.bookingId ?? "",
            pitchShare: it.sharePence,
            unitrFee: it.feePence,
          },
          description: `Unitr match settlement — £${(it.sharePence / 100).toFixed(2)} pitch + £${(it.feePence / 100).toFixed(2)} fee`,
        });

        if (pi.status === "succeeded") {
          results.push({ playerId: it.playerId, ok: true, paymentIntentId: pi.id });
        } else {
          // e.g. requires_action — can't complete off-session.
          results.push({ playerId: it.playerId, ok: false, requiresAction: true, error: `Card needs authentication (${pi.status})` });
        }
      } catch (err) {
        const e = err as { code?: string; message?: string };
        results.push({
          playerId: it.playerId,
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
