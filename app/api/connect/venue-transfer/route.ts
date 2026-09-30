import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCallerId, isAdmin, forbidden, unauthorized } from "@/lib/api-auth";
import { payVenue, payoutCeilingPence, type VenuePayout } from "@/lib/venue-payout";

// Pay a venue its pitch fee. The transfer itself lives in lib/venue-payout.ts;
// this route is the authorisation in front of it.
//
// It is the single most dangerous endpoint in the app: stripe.transfers.create
// moves money OUT of Uniter's Stripe balance to an external connected account.
// Unauthenticated, with the amount taken from the request body, it is a
// cash-out tap that anyone with the URL can open — harmless on a test key,
// not harmless on a live one. Three things gate it now:
//
//   1. a valid session — no anonymous payouts;
//   2. an admin caller;
//   3. an amount capped by what that booking/tournament actually costs, read
//      from the database rather than believed from the body.
//
// Since 1 Oct it is staff-only: every payout the apps make now happens inside
// the server route that took the money (/api/book/pitch,
// /api/challenges/accept, /api/tournaments/join), for an amount that route
// worked out. A booker could otherwise raise their own booking's price and
// have the platform pay the venue that much. This stays for reconciling a
// failed transfer by hand.

export async function POST(req: NextRequest) {
  try {
    const callerId = await getCallerId(req);
    if (!callerId) return unauthorized();

    const { pitchId, bookingId, matchId, teamId, openMatchId, amountPence } = await req.json();
    if (!pitchId || !amountPence || amountPence < 1) {
      return NextResponse.json({ error: "Missing pitchId or amount" }, { status: 400 });
    }
    const payout: VenuePayout = {
      pitchId, bookingId, matchId, teamId, openMatchId,
      amountPence: Math.round(amountPence),
    };

    if (!(await isAdmin(callerId))) {
      return forbidden("Venue payouts are made by Uniter.");
    }

    // Cap before paying: the body says what to send, the database says what it
    // could possibly be worth, and the smaller number wins.
    const ceiling = await payoutCeilingPence(payout);
    if (ceiling === null) {
      return NextResponse.json({ error: "That booking doesn't belong to this pitch." }, { status: 400 });
    }
    if (payout.amountPence > ceiling) {
      console.error(
        `venue-transfer: ${callerId} asked for ${payout.amountPence}p against a ${ceiling}p fee — refused`,
      );
      return NextResponse.json({ error: "Amount is more than this booking costs." }, { status: 400 });
    }

    const { status, body } = await payVenue(payout);
    return NextResponse.json(body, { status });
  } catch (err) {
    console.error("Connect venue-transfer error:", err);
    return NextResponse.json({ error: "Venue transfer failed" }, { status: 500 });
  }
}
