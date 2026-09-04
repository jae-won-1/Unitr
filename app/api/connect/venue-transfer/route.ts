import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCallerId, isAdmin, isTeamMember, forbidden, unauthorized } from "@/lib/api-auth";
import { payVenue, payoutCeilingPence, type VenuePayout } from "@/lib/venue-payout";

// Pay a venue its pitch fee. The transfer itself lives in lib/venue-payout.ts;
// this route is the authorisation in front of it.
//
// It is the single most dangerous endpoint in the app: stripe.transfers.create
// moves money OUT of Unitr's Stripe balance to an external connected account.
// Unauthenticated, with the amount taken from the request body, it is a
// cash-out tap that anyone with the URL can open — harmless on a test key,
// not harmless on a live one. Three things gate it now:
//
//   1. a valid session — no anonymous payouts;
//   2. a caller with a stake in the fixture being paid for;
//   3. an amount capped by what that booking/tournament actually costs, read
//      from the database rather than believed from the body.
//
// The worst a determined caller can now do is pay a real venue money it was
// already owed, slightly early.

// Does this caller have a stake in the thing being paid for? Anyone who could
// legitimately trigger this payout in the UI passes one of these:
//   - the person who reserved the pitch (direct booking, tournament host);
//   - a member of the team being charged;
//   - a member of either side of the match (the challenger confirms, but the
//     fee and teamId belong to the posting team);
//   - an admin.
async function callerHasStake(userId: string, p: VenuePayout): Promise<boolean> {
  if (p.bookingId) {
    const { data } = await adminSupabase
      .from("pitch_bookings").select("booked_by").eq("id", p.bookingId).maybeSingle();
    if (data?.booked_by === userId) return true;
  }
  if (p.teamId && (await isTeamMember(userId, p.teamId))) return true;
  if (p.matchId) {
    const { data } = await adminSupabase
      .from("matches")
      .select("posting_team_id, challenging_team_id")
      .eq("id", p.matchId)
      .maybeSingle();
    for (const t of [data?.posting_team_id, data?.challenging_team_id]) {
      if (t && (await isTeamMember(userId, t as string))) return true;
    }
  }
  if (p.openMatchId) {
    const { data } = await adminSupabase
      .from("open_match_teams").select("team_id").eq("open_match_id", p.openMatchId);
    for (const row of data ?? []) {
      if (await isTeamMember(userId, row.team_id as string)) return true;
    }
  }
  return isAdmin(userId);
}

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

    if (!(await callerHasStake(callerId, payout))) {
      return forbidden("You're not part of this booking.");
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
