import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";
import { stripe } from "@/lib/stripe";
import { getCaller, isTeamLeader, forbidden, unauthorized } from "@/lib/api-auth";
import { ensureStripeCustomer } from "@/lib/stripe-customer";
import { feeOn } from "@/lib/uniter-fee";
import { isKickoffPast } from "@/lib/match-dates";
import { pitchFormatFor } from "@/lib/formations";
import { dayNameOf, loadPitchDay } from "@/lib/pitch-day";
import { payVenue } from "@/lib/venue-payout";

// Book a pitch outright — one hour, no opponent. Book a Pitch on the web
// (BookPitchPanel) and on the phone both come here.
//
// This used to happen in the browser: the page inserted the pitch_bookings row
// itself, price included, then asked /api/book/pay-credit to debit "what the
// booking costs" — a figure the same browser had just written. Card payments
// charged an amount the page chose and then marked the booking paid. So a
// booking could be made at any price, including none. Now the request names
// only the pitch, the date, the hour and how to pay; the price is read from
// `pitches`, the slot is checked free with the same rule the grid draws
// (lib/pitch-day.ts), and the booking row is written here, after the money.
//
// Four methods:
//   credit     — a captain or co-captain pays from the team's account;
//   saved_card — the caller's card on file is charged off-session;
//   intent     — mint a PaymentIntent for the card form / PaymentSheet to
//                confirm (nothing is booked yet);
//   card       — that intent has been confirmed; verify it and book.
//
// `autoPost` (with a teamId) turns the new booking straight into a secured
// match post, as "Lock in a pitch first" on Post a Match expects. `hours` +
// `tournamentTitle` (credit only) book a tournament's multi-hour block.
//
// Errors carry a `code`: SLOT_TAKEN, SHORTFALL (with shortfallPence),
// REQUIRES_ACTION (the saved card needs the payer — use the card form).
//
// Paying the venue (Stripe Connect, test mode) happens here too, best-effort,
// capped by a booking row this route wrote.

type Method = "credit" | "saved_card" | "intent" | "card";

const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ code, error, ...extra }, { status });

type Team = { id: string; name: string; location: string | null; format: string | null; captain_id: string };
type Pitch = { id: string; name: string; address: string | null; price_per_hour: number; formats: string[] | null };

// Every hour of the block has to be free (a tournament books several).
async function slotIsFree(pitchId: string, date: string, time: string, hours = 1): Promise<boolean> {
  const day = await loadPitchDay(adminSupabase, [pitchId], date);
  const start = Number(time.slice(0, 2));
  for (let h = start; h < start + hours; h++) {
    const t = `${String(h).padStart(2, "0")}:00`;
    if (!(day[pitchId] ?? []).some((s) => s.time === t && s.status === "available")) return false;
  }
  return true;
}

export async function POST(req: NextRequest) {
  try {
    const caller = await getCaller(req);
    if (!caller) return unauthorized();
    const callerId = caller.id;

    const body = await req.json();
    const method = body.method as Method;
    const pitchId = String(body.pitchId ?? "");
    const date = String(body.date ?? "");
    const time = String(body.time ?? "");
    const teamId = body.teamId ? String(body.teamId) : null;
    const autoPost = Boolean(body.autoPost);
    // A tournament's block: several hours, from the team's account, under the
    // tournament's name (/play/create-tournament). Everything else is one hour.
    const hours = body.hours === undefined ? 1 : Number(body.hours);
    const tournamentTitle = typeof body.tournamentTitle === "string" ? body.tournamentTitle.trim().slice(0, 120) : "";

    if (!["credit", "saved_card", "intent", "card"].includes(method)) {
      return NextResponse.json({ error: "Unknown payment method" }, { status: 400 });
    }
    if (!pitchId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:00$/.test(time)) {
      return NextResponse.json({ error: "Pick a pitch, a date and an hour." }, { status: 400 });
    }
    if (isKickoffPast(date, time)) {
      return NextResponse.json({ error: "That hour has already started." }, { status: 400 });
    }
    // Spending the team's money, or posting for it, is its leaders' call.
    if (teamId && !(await isTeamLeader(callerId, teamId))) {
      return forbidden("Only the captain or a co-captain can book for the team.");
    }
    if (!Number.isInteger(hours) || hours < 1 || hours > 12 || Number(time.slice(0, 2)) + hours > 23) {
      return NextResponse.json({ error: "That block doesn't fit in the day." }, { status: 400 });
    }
    if (hours > 1 && (method !== "credit" || autoPost)) {
      return NextResponse.json({ error: "A multi-hour block is paid from the team's account." }, { status: 400 });
    }
    if ((method === "credit" || autoPost) && !teamId) {
      return NextResponse.json({ error: "Only a team's captain can pay from its account or post a match." }, { status: 400 });
    }

    // Real venue-registered pitches only — a pitch no venue owns has nobody to
    // honour the booking.
    const { data: pitchRow } = await adminSupabase
      .from("pitches").select("id, name, address, price_per_hour, formats, venue_owner_id")
      .eq("id", pitchId).maybeSingle();
    if (!pitchRow || !pitchRow.venue_owner_id) {
      return NextResponse.json({ error: "That pitch isn't bookable." }, { status: 404 });
    }
    const pitch = pitchRow as Pitch;
    const pitchFeePence = Math.round(Number(pitch.price_per_hour) * 100) * hours;
    const uniterFeePence = feeOn(pitchFeePence);
    const totalPence = pitchFeePence + uniterFeePence;
    if (!(pitchFeePence > 0)) {
      return NextResponse.json({ error: "That pitch has no price set." }, { status: 409 });
    }

    // ── card: the intent this route minted has been confirmed ──
    // Idempotent on the intent: a retry after a dropped response finds the
    // booking it already made rather than making a second one.
    let intentId: string | null = null;
    if (method === "card") {
      intentId = String(body.paymentIntentId ?? "");
      if (!intentId.startsWith("pi_")) return NextResponse.json({ error: "Missing payment" }, { status: 400 });
      const { data: already } = await adminSupabase
        .from("pitch_bookings").select("id, post_id").eq("stripe_payment_intent_id", intentId).maybeSingle();
      if (already) return NextResponse.json({ ok: true, bookingId: already.id, posted: Boolean(already.post_id) });

      const pi = await stripe.paymentIntents.retrieve(intentId);
      const m = pi.metadata ?? {};
      if (m.type !== "pitch_booking" || m.playerId !== callerId || m.pitchId !== pitchId || m.date !== date || m.time !== time) {
        return forbidden("That payment wasn't for this booking.");
      }
      if (pi.status !== "succeeded" && pi.status !== "processing") {
        return NextResponse.json({ error: "The payment hasn't gone through." }, { status: 402 });
      }
      if (pi.amount < totalPence) {
        return NextResponse.json({ error: "That payment doesn't cover this booking." }, { status: 402 });
      }
      if (!(await slotIsFree(pitchId, date, time))) {
        // Paid for an hour someone else took while the card form was open:
        // hand the money straight back.
        await stripe.refunds.create({ payment_intent: intentId }).catch((e) =>
          console.error(`book/pitch: refund failed for ${intentId}:`, e));
        return fail(409, "SLOT_TAKEN", "Someone booked that hour while you were paying. Your payment has been refunded.", { refunded: true });
      }
    } else if (!(await slotIsFree(pitchId, date, time, hours))) {
      return fail(409, "SLOT_TAKEN", "That hour has just been booked. Pick another.");
    }

    // ── intent: open a card payment for the right amount; book nothing ──
    if (method === "intent") {
      const customer = await ensureStripeCustomer(callerId, caller.email);
      const pi = await stripe.paymentIntents.create({
        amount: totalPence,
        currency: "gbp",
        customer,
        setup_future_usage: "off_session",
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        metadata: {
          type: "pitch_booking", playerId: callerId, pitchId, date, time,
          pitchShare: pitchFeePence, uniterFee: uniterFeePence,
        },
        description: `Uniter pitch booking — ${pitch.name}, ${date} ${time}`,
      });
      return NextResponse.json({ clientSecret: pi.client_secret, amountPence: totalPence });
    }

    // ── credit: checked up front for a clear answer; debited after the row ──
    if (method === "credit") {
      const { data: credit } = await adminSupabase
        .from("team_credits").select("balance_pence, reserved_pence").eq("team_id", teamId!).maybeSingle();
      const available = (credit?.balance_pence ?? 0) - (credit?.reserved_pence ?? 0);
      if (available < totalPence) {
        return fail(409, "SHORTFALL", "Your team's account doesn't cover this booking.", {
          shortfallPence: totalPence - available, needPence: totalPence, availablePence: available,
        });
      }
    }

    // ── saved_card: charge the card on file, off-session ──
    if (method === "saved_card") {
      const { data: profile } = await adminSupabase
        .from("profiles").select("stripe_customer_id, stripe_payment_method_id").eq("id", callerId).maybeSingle();
      if (!profile?.stripe_customer_id || !profile?.stripe_payment_method_id) {
        return NextResponse.json({ error: "No saved card." }, { status: 400 });
      }
      try {
        const pi = await stripe.paymentIntents.create({
          amount: totalPence,
          currency: "gbp",
          customer: profile.stripe_customer_id,
          payment_method: profile.stripe_payment_method_id,
          off_session: true,
          confirm: true,
          metadata: {
            type: "pitch_booking", playerId: callerId, pitchId, date, time,
            pitchShare: pitchFeePence, uniterFee: uniterFeePence,
          },
          description: `Uniter pitch booking — ${pitch.name}, ${date} ${time}`,
        });
        if (pi.status !== "succeeded") {
          return fail(402, "REQUIRES_ACTION", "Your bank wants to confirm this payment — enter the card instead.");
        }
        intentId = pi.id;
      } catch (err) {
        const e = err as { code?: string; message?: string };
        if (e.code === "authentication_required") {
          return fail(402, "REQUIRES_ACTION", "Your bank wants to confirm this payment — enter the card instead.");
        }
        return NextResponse.json({ error: e.message ?? "Your saved card was declined." }, { status: 402 });
      }
    }

    // ── The booking row ──
    let bookerName = "Session booking";
    let team: Team | null = null;
    if (teamId) {
      const { data } = await adminSupabase
        .from("teams").select("id, name, location, format, captain_id").eq("id", teamId).maybeSingle();
      team = (data as Team | null) ?? null;
      if (team?.name) bookerName = team.name;
    } else {
      const { data } = await adminSupabase.from("profiles").select("full_name").eq("id", callerId).maybeSingle();
      if (data?.full_name) bookerName = data.full_name as string;
    }

    const paidByCard = method === "card" || method === "saved_card";
    const { data: booking, error: bookingErr } = await adminSupabase.from("pitch_bookings").insert({
      pitch_id: pitchId,
      booked_by: callerId,
      match_date: date,
      start_time: time,
      end_time: `${String(Number(time.slice(0, 2)) + hours).padStart(2, "0")}:00`,
      booker_name: tournamentTitle ? `Tournament: ${tournamentTitle}` : bookerName,
      booking_type: tournamentTitle ? "open_match" : "platform",
      total_price_pence: pitchFeePence,
      player_count: 0,
      per_player_pence: 0,
      unitr_fee_pence: uniterFeePence,
      status: "confirmed",
      payment_status: paidByCard ? "paid" : "pending",
      stripe_payment_intent_id: intentId,
    }).select("id").single();

    if (bookingErr || !booking) {
      console.error("book/pitch: booking insert failed:", bookingErr?.message);
      if (paidByCard && intentId) {
        await stripe.refunds.create({ payment_intent: intentId }).catch((e) =>
          console.error(`book/pitch: refund failed for ${intentId}:`, e));
        return NextResponse.json({ error: "Couldn't complete the booking. Your payment has been refunded." }, { status: 500 });
      }
      return NextResponse.json({ error: "Couldn't complete the booking. Nothing was charged." }, { status: 500 });
    }

    let newBalancePence: number | null = null;
    if (method === "credit") {
      // A guarded read-modify-write, as /api/book/pay-credit does: only applied
      // if the balance is still what was read, so two debits can't both pass.
      const { data: credit } = await adminSupabase
        .from("team_credits").select("balance_pence, reserved_pence").eq("team_id", teamId!).maybeSingle();
      const available = (credit?.balance_pence ?? 0) - (credit?.reserved_pence ?? 0);
      const { data: updated } = credit && available >= totalPence
        ? await adminSupabase.from("team_credits")
            .update({ balance_pence: credit.balance_pence - totalPence, updated_at: new Date().toISOString() })
            .eq("team_id", teamId!).eq("balance_pence", credit.balance_pence)
            .select("balance_pence").maybeSingle()
        : { data: null };
      if (!updated) {
        // Never hold a slot without payment.
        await adminSupabase.from("pitch_bookings").update({ status: "cancelled", payment_status: "failed" }).eq("id", booking.id);
        return fail(409, "SHORTFALL", "Your team's account changed while booking — try again.", {
          shortfallPence: Math.max(0, totalPence - available), needPence: totalPence, availablePence: available,
        });
      }
      newBalancePence = updated.balance_pence as number;
      await adminSupabase.from("team_credit_transactions").insert({
        team_id: teamId, type: "booking_capture", amount_pence: -totalPence, booking_id: booking.id,
      });
      await adminSupabase.from("pitch_bookings").update({ payment_status: "paid" }).eq("id", booking.id);
    } else {
      // The per-payment row finance and reporting read.
      await adminSupabase.from("player_payments").insert({
        booking_id: booking.id,
        player_id: callerId,
        amount_pence: pitchFeePence,
        unitr_fee_pence: uniterFeePence,
        total_pence: totalPence,
        status: "paid",
        purpose: "individual",
        stripe_payment_intent_id: intentId,
      });
    }

    // Pay the venue its fee. Best-effort: an unconnected venue is recorded as a
    // failed transfer and must not undo a paid booking.
    await payVenue({ pitchId, bookingId: booking.id, teamId, amountPence: pitchFeePence })
      .catch((e) => console.error("book/pitch: venue payout failed:", e));

    // "Lock in a pitch first": the booking becomes a secured match post any
    // team can take straight away, filed under the team's captain.
    let posted = false;
    if (autoPost && team) {
      const { data: post } = await adminSupabase.from("match_posts").insert({
        team_id: team.id,
        captain_id: team.captain_id ?? callerId,
        team_name: team.name,
        team_location: team.location ?? "",
        match_date: date,
        match_time: time,
        day_name: dayNameOf(date),
        pitch_options: [{
          id: pitch.id,
          name: pitch.name,
          address: pitch.address,
          price: pitch.price_per_hour,
          format: pitchFormatFor(pitch.formats ?? [], team.format),
          distance: "",
          time,
        }],
        description: null,
        status: "open",
        payment_mode: "secured",
        hold_pence: 0,
        pitch_secured: true,
        secured_booking_id: booking.id,
      }).select("id").single();
      if (post) {
        await adminSupabase.from("pitch_bookings").update({ post_id: post.id }).eq("id", booking.id);
        posted = true;
      }
    }

    return NextResponse.json({ ok: true, bookingId: booking.id, posted, newBalancePence, paymentIntentId: intentId });
  } catch (err) {
    console.error("book/pitch error:", err);
    return NextResponse.json({ error: "Couldn't complete the booking." }, { status: 500 });
  }
}
