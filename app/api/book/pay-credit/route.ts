import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCallerId, isTeamCaptain, forbidden, unauthorized } from "@/lib/api-auth";

// Debit a team's credit for a DIRECT pitch booking (no opponent/match).
// This is the single-team counterpart to split_pitch_fee — a captain paying
// for a pitch out of the team pot. The caller passes the full amount including
// the 5% Unitr fee, so credit payments and card payments are treated equally.
//
// No SECURITY DEFINER RPC exists for this and we can't add one in this
// prototype (anon key only), so the debit is a guarded read-modify-write
// against the open-RLS team_credits table, with a re-check immediately before
// the write to shrink the double-spend window.
export async function POST(req: NextRequest) {
  try {
    // Spending the team pot is the captain's call, and only for their own
    // team — without this the teamId in the body was enough to empty anyone's.
    const callerId = await getCallerId(req);
    if (!callerId) return unauthorized();

    const { teamId, feePence, bookingId } = await req.json();
    if (!teamId || !feePence || feePence < 1) {
      return NextResponse.json({ error: "Missing teamId or fee" }, { status: 400 });
    }
    if (!(await isTeamCaptain(callerId, teamId))) {
      return forbidden("Only the captain can pay from team credit.");
    }
    const amount = Math.round(feePence);

    // The booking being paid for has to be one the caller made, and the debit
    // is capped at what that booking actually costs (fee + the 5% on top).
    if (bookingId) {
      const { data: booking } = await adminSupabase
        .from("pitch_bookings")
        .select("booked_by, total_price_pence, unitr_fee_pence")
        .eq("id", bookingId)
        .maybeSingle();
      if (!booking) {
        return NextResponse.json({ error: "Booking not found" }, { status: 404 });
      }
      if (booking.booked_by !== callerId) {
        return forbidden("That booking was made by someone else.");
      }
      const due = Math.round((booking.total_price_pence ?? 0) + (booking.unitr_fee_pence ?? 0));
      if (amount > due) {
        return NextResponse.json({ error: "Amount is more than this booking costs." }, { status: 400 });
      }
    }

    const { data: credit } = await adminSupabase
      .from("team_credits")
      .select("balance_pence, reserved_pence")
      .eq("team_id", teamId)
      .maybeSingle();
    if (!credit) {
      return NextResponse.json({ error: "No credit account for this team." }, { status: 409 });
    }

    const available = credit.balance_pence - (credit.reserved_pence ?? 0);
    if (available < amount) {
      return NextResponse.json(
        { error: "INSUFFICIENT_CREDIT", available, need: amount },
        { status: 409 }
      );
    }

    const { data: updated, error: upErr } = await adminSupabase
      .from("team_credits")
      .update({ balance_pence: credit.balance_pence - amount, updated_at: new Date().toISOString() })
      .eq("team_id", teamId)
      // Re-check available credit at write time (best-effort guard against a
      // concurrent debit): only apply if the balance is still what we read.
      .eq("balance_pence", credit.balance_pence)
      .select("balance_pence")
      .maybeSingle();
    if (upErr || !updated) {
      return NextResponse.json({ error: "Credit changed, please retry." }, { status: 409 });
    }

    // Audit row — signed ledger entry. No match/post for a direct booking;
    // booking_id lets the Team Credits log show which pitch this paid for.
    await adminSupabase.from("team_credit_transactions").insert({
      team_id: teamId,
      type: "booking_capture",
      amount_pence: -amount,
      booking_id: bookingId ?? null,
    });

    // Best-effort: stamp the booking so it reflects the credit payment.
    if (bookingId) {
      await adminSupabase.from("pitch_bookings")
        .update({ payment_status: "paid", status: "confirmed" })
        .eq("id", bookingId);
    }

    return NextResponse.json({ ok: true, newBalancePence: updated.balance_pence });
  } catch (err) {
    console.error("book/pay-credit error:", err);
    return NextResponse.json({ error: "Could not debit team credit" }, { status: 500 });
  }
}
