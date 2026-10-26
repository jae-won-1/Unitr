import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCallerId, isTeamLeader, forbidden, unauthorized } from "@/lib/api-auth";
import { isKickoffPast } from "@/lib/match-dates";
import { pitchFormatFor } from "@/lib/formations";
import { dayNameOf } from "@/lib/pitch-day";
import { securedBookingPence } from "@/lib/secured-booking";

// Turn a paid pitch booking into a secured match post — the Calendar's
// "Turn into Match Post" (FixtureDetailSheet).
//
// A secured post is money: whoever accepts it reimburses half the booking into
// the poster's account. So it is written only here (and by /api/book/pitch's
// autoPost), from a booking lib/secured-booking.ts has proved was paid through
// Uniter by the caller's team — and not in the past, not already posted —
// with the price that booking actually cost. supabase_pitch_bookings_lockdown.sql
// refuses secured posts written from a browser.
export async function POST(req: NextRequest) {
  try {
    const callerId = await getCallerId(req);
    if (!callerId) return unauthorized();

    const { bookingId, teamId, description } = await req.json();
    if (!bookingId || !teamId) return NextResponse.json({ error: "Missing booking or team" }, { status: 400 });
    if (!(await isTeamLeader(callerId, teamId))) {
      return forbidden("Only the captain or a co-captain can post a match for the team.");
    }

    const { data: booking } = await adminSupabase
      .from("pitch_bookings")
      .select("id, pitch_id, booked_by, match_date, start_time, status, payment_status, total_price_pence, post_id")
      .eq("id", bookingId).maybeSingle();
    if (!booking) return NextResponse.json({ error: "Couldn't find that booking." }, { status: 404 });
    if (!(await isTeamLeader(booking.booked_by as string, teamId))) {
      return forbidden("That booking wasn't made by your team.");
    }
    const pricePence = await securedBookingPence(booking.id as string, teamId);
    if (pricePence === null) {
      return NextResponse.json({ error: "Only a booking paid through Uniter can be posted." }, { status: 409 });
    }
    if (booking.post_id) return NextResponse.json({ error: "This booking is already posted." }, { status: 409 });
    const time = String(booking.start_time).slice(0, 5);
    if (isKickoffPast(booking.match_date as string, time)) {
      return NextResponse.json({ error: "That booking has already started." }, { status: 409 });
    }

    const [{ data: team }, { data: pitch }] = await Promise.all([
      adminSupabase.from("teams").select("id, name, location, format, captain_id").eq("id", teamId).maybeSingle(),
      adminSupabase.from("pitches").select("name, address, formats").eq("id", booking.pitch_id).maybeSingle(),
    ]);
    if (!team) return NextResponse.json({ error: "Team not found." }, { status: 404 });

    const { data: post, error: postErr } = await adminSupabase.from("match_posts").insert({
      team_id: team.id,
      captain_id: team.captain_id ?? callerId,
      team_name: team.name,
      team_location: team.location ?? "",
      match_date: booking.match_date,
      match_time: time,
      day_name: dayNameOf(booking.match_date as string),
      pitch_options: [{
        id: booking.pitch_id,
        name: pitch?.name ?? "Pitch",
        address: pitch?.address ?? "",
        price: pricePence / 100,
        format: pitchFormatFor(pitch?.formats as string[] | null, team.format as string | null),
        distance: "",
        time,
      }],
      description: typeof description === "string" && description.trim() ? description.trim().slice(0, 500) : null,
      status: "open",
      payment_mode: "secured",
      hold_pence: 0,
      pitch_secured: true,
      secured_booking_id: booking.id,
    }).select("id").single();
    if (postErr || !post) {
      console.error("book/post insert failed:", postErr?.message);
      return NextResponse.json({ error: "Couldn't post the match." }, { status: 500 });
    }

    await adminSupabase.from("pitch_bookings").update({ post_id: post.id }).eq("id", booking.id);
    return NextResponse.json({ ok: true, postId: post.id });
  } catch (err) {
    console.error("book/post error:", err);
    return NextResponse.json({ error: "Couldn't post the match." }, { status: 500 });
  }
}
