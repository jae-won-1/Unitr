import { adminSupabase } from "@/lib/supabase-admin";
import { isTeamLeader } from "@/lib/api-auth";

// Server-only. Is this booking something a secured match post may rest on?
//
// A secured post makes whoever accepts it reimburse half of the booking's
// price into the poster's account, so "the pitch is paid for" has to be proved,
// not claimed. A booking qualifies when it is:
//   • not cancelled, and marked paid;
//   • made by one of the posting team's leaders;
//   • paid THROUGH UNITER — a Stripe payment (stripe_payment_intent_id, which
//     only the server can set: supabase_pitch_bookings_lockdown.sql) or a
//     debit on the team's ledger (team_credit_transactions, server-only since
//     supabase_payment_integrity.sql). A venue's own manual booking, or one on
//     a pitch the booker registered themselves, has neither;
//   • no dearer than the pitch's list price for its length.
//
// Returns the booking's price in pence, or null if it doesn't qualify.

type Booking = {
  id: string;
  pitch_id: string;
  booked_by: string;
  match_date: string;
  start_time: string;
  end_time: string | null;
  status: string | null;
  payment_status: string | null;
  total_price_pence: number;
  stripe_payment_intent_id: string | null;
};

const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5) || 0);

export async function securedBookingPence(
  bookingId: string | null | undefined,
  teamId: string,
  expect?: { pitchId?: string; date?: string },
): Promise<number | null> {
  if (!bookingId) return null;
  const { data } = await adminSupabase
    .from("pitch_bookings")
    .select("id, pitch_id, booked_by, match_date, start_time, end_time, status, payment_status, total_price_pence, stripe_payment_intent_id")
    .eq("id", bookingId)
    .maybeSingle();
  const b = data as Booking | null;
  if (!b) return null;
  if (expect?.pitchId && b.pitch_id !== expect.pitchId) return null;
  if (expect?.date && b.match_date !== expect.date) return null;
  if (b.status === "cancelled" || b.payment_status !== "paid") return null;
  if (!(b.total_price_pence > 0)) return null;
  if (!(await isTeamLeader(b.booked_by, teamId))) return null;

  if (!b.stripe_payment_intent_id) {
    const { data: debit } = await adminSupabase
      .from("team_credit_transactions")
      .select("id")
      .eq("booking_id", b.id)
      .eq("type", "booking_capture")
      .lt("amount_pence", 0)
      .limit(1)
      .maybeSingle();
    if (!debit) return null;
  }

  const { data: pitch } = await adminSupabase
    .from("pitches").select("price_per_hour").eq("id", b.pitch_id).maybeSingle();
  if (!pitch) return null;
  const hours = b.end_time ? Math.max(1, Math.ceil((mins(b.end_time) - mins(b.start_time)) / 60)) : 1;
  if (b.total_price_pence > Math.round(Number(pitch.price_per_hour) * 100) * hours) return null;

  return b.total_price_pence;
}
