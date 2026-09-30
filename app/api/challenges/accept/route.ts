import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";
import { seedAvailabilityFromPoll } from "@/lib/event-availability";
import { getCallerId, isTeamLeader, forbidden, unauthorized } from "@/lib/api-auth";
import { feeOn } from "@/lib/uniter-fee";
import { payVenue } from "@/lib/venue-payout";
import { securedBookingPence } from "@/lib/secured-booking";

// Accept a match post: the challenger's captain (or a co-captain) takes one of
// the poster's pitch options, and both teams pay their half of the pitch out of
// team credit. The whole step runs here, server-side, because it moves money.
//
// It used to run in the browser (ChallengePanel), calling split_pitch_fee,
// reimburse_secured_pitch and release_hold directly. Those functions trusted
// their arguments, and match_posts / challenges / matches were writable by
// anyone — so a forged post and match could charge any team, or move one
// team's credit into another's. Now nothing about the charge comes from the
// request except which post and which of its pitch options: the teams, the
// fee and the mode are read from the database, and the post is claimed with a
// conditional update so a second accept of the same post finds it gone.
// supabase_challenge_lockdown.sql then makes the functions service-role only.
//
// Behaviour is the same as the browser version:
//   • credit / individual posts — each team is debited its own half
//     (split_pitch_fee, poster absorbs the odd penny); any batch earmark the
//     poster placed is released;
//   • secured posts — the poster already paid the venue via /book, so the
//     challenger reimburses their half into the poster's credit;
//   • both squads get a pending "are you playing?" row, pre-filled from a poll
//     that proposed this exact date.
// The fee is read from `pitches` (or a verified secured booking), never from
// the post, and the venue is paid here too.
//
// Errors come back with a `code` the caller can act on:
//   SHORTFALL (with shortfallPence / halfPence) — the challenger's own team
//   is short; POSTER_SHORT — the poster is; TAKEN — someone got there first;
//   SLOT_TAKEN — that pitch option was booked in the meantime.

type PitchOption = { id: string; name: string; price: number; time?: string; [k: string]: unknown };

const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ code, error, ...extra }, { status });

async function availablePence(teamId: string): Promise<{ available: number; balance: number }> {
  const { data } = await adminSupabase
    .from("team_credits").select("balance_pence, reserved_pence").eq("team_id", teamId).maybeSingle();
  const balance = (data?.balance_pence as number | undefined) ?? 0;
  return { balance, available: balance - ((data?.reserved_pence as number | undefined) ?? 0) };
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getCallerId(req);
    if (!userId) return unauthorized();

    const { postId, pitchOptionId, teamId } = await req.json();
    if (!postId || !pitchOptionId || !teamId) {
      return NextResponse.json({ error: "Missing postId, pitchOptionId or teamId" }, { status: 400 });
    }
    if (!(await isTeamLeader(userId, teamId))) {
      return forbidden("Only the captain or a co-captain can accept a match for the team.");
    }

    const { data: post } = await adminSupabase
      .from("match_posts")
      .select("id, team_id, captain_id, team_name, status, payment_mode, pitch_options, match_date, match_time, secured_booking_id")
      .eq("id", postId).maybeSingle();
    if (!post) return fail(404, "NOT_FOUND", "That match post no longer exists.");
    if (post.status !== "open") return fail(409, "TAKEN", "Another team took this match just before you.");
    if (post.team_id === teamId) return fail(400, "OWN_POST", "You can't challenge your own team's post.");

    const { data: team } = await adminSupabase
      .from("teams").select("id, name, captain_id").eq("id", teamId).maybeSingle();
    if (!team) return fail(404, "NOT_FOUND", "Team not found.");

    const pitch = ((post.pitch_options ?? []) as PitchOption[]).find((p) => p.id === pitchOptionId);
    if (!pitch) return fail(400, "BAD_PITCH", "That pitch isn't one of this post's options.");

    const isSecured = post.payment_mode === "secured";

    // The fee comes from the database, never from the post: pitch_options is
    // written by the posting captain, and a price there was believed until
    // 1 Oct — a post could list a pitch at 1p (the venue short-changed) or,
    // secured, at £500 (the challenger reimbursing half of a fee nobody paid).
    //   • ordinary post — the pitch's list price for the hour;
    //   • secured post — what the poster's booking actually cost, and only if
    //     that booking is real and was paid through Uniter
    //     (lib/secured-booking.ts).
    let feePence: number;
    const { data: pitchRow } = pitch.id
      ? await adminSupabase.from("pitches").select("price_per_hour").eq("id", pitch.id).maybeSingle()
      : { data: null };
    if (!pitchRow) return fail(400, "BAD_PITCH", "That pitch isn't bookable any more.");
    const listPence = Math.round(Number(pitchRow.price_per_hour) * 100);
    if (isSecured) {
      const secured = await securedBookingPence(post.secured_booking_id, post.team_id as string, {
        pitchId: pitch.id, date: post.match_date as string,
      });
      if (secured === null) {
        return fail(409, "BAD_SECURED", "This post's pitch booking can't be verified, so it can't be accepted.");
      }
      feePence = secured;
    } else {
      feePence = listPence;
    }
    const posterHalfPence = Math.ceil(feePence / 2); // poster absorbs the odd penny
    const challengerHalfPence = feePence - posterHalfPence;
    const pitchTime = (pitch.time as string | undefined) ?? post.match_time;

    // Checked up front for a clear message; the ledger functions check again
    // under a row lock, which is what actually guarantees it.
    const chal = await availablePence(teamId);
    if (chal.available < challengerHalfPence) {
      return fail(409, "SHORTFALL", "Your team doesn't have enough in its account for your half of the pitch.", {
        shortfallPence: challengerHalfPence - chal.available,
        halfPence: challengerHalfPence,
        balancePence: chal.balance,
      });
    }
    if (!isSecured) {
      const poster = await availablePence(post.team_id);
      if (poster.available < posterHalfPence) {
        return fail(409, "POSTER_SHORT",
          `The posting team no longer has enough credit to cover their half of this pitch (£${(posterHalfPence / 100).toFixed(2)} needed). This match can't be confirmed right now.`);
      }
      // Double-booking: the slot may have gone since the panel opened. A
      // secured post already owns its slot, so there's nothing to race.
      if (pitch.id) {
        const { data: clash } = await adminSupabase
          .from("pitch_bookings").select("id")
          .eq("pitch_id", pitch.id).eq("match_date", post.match_date).eq("start_time", pitchTime)
          .neq("status", "cancelled").maybeSingle();
        if (clash) return fail(409, "SLOT_TAKEN", `${pitch.name} was just booked by another team. Select a different pitch option.`);
      }
    }

    // Claim the post. Conditional on it still being open, so two captains
    // accepting at once can't both get it — the loser changes nothing.
    const { data: claimed } = await adminSupabase
      .from("match_posts").update({ status: "matched" })
      .eq("id", post.id).eq("status", "open").select("id");
    if (!claimed || claimed.length === 0) return fail(409, "TAKEN", "Another team took this match just before you.");

    // Everything written from here is undone if the charge fails.
    const undo: (() => PromiseLike<unknown>)[] = [
      () => adminSupabase.from("match_posts").update({ status: "open" }).eq("id", post.id),
    ];
    const rollback = async () => { for (const u of undo.reverse()) await u(); };

    const { data: challenge } = await adminSupabase.from("challenges").insert({
      post_id: post.id,
      challenger_team_id: team.id,
      challenger_team_name: team.name,
      // The team's captain, whoever pressed the button — every "our fixtures"
      // query keys off this id.
      challenger_captain_id: team.captain_id ?? userId,
      selected_pitch: pitch,
      status: "accepted",
    }).select("id").single();
    if (challenge) undo.push(() => adminSupabase.from("challenges").delete().eq("id", challenge.id));

    // The booking row the venue portal's calendar shows. A secured post already
    // has one (the original /book reservation) — update its split instead.
    let pitchBookingId: string | null = null;
    if (isSecured && post.secured_booking_id) {
      const perPlayerPence = Math.round(feePence / 22);
      await adminSupabase.from("pitch_bookings").update({
        booker_name: `${post.team_name} vs ${team.name}`,
        player_count: 22,
        per_player_pence: perPlayerPence,
        unitr_fee_pence: feeOn(perPlayerPence),
      }).eq("id", post.secured_booking_id);
      pitchBookingId = post.secured_booking_id;
    } else if (pitch.id) {
      const perPlayerPence = Math.round(feePence / 22);
      const startTime = pitchTime || "12:00";
      const [h, m] = startTime.split(":").map(Number);
      const endTime = `${String(Math.min((h || 12) + 1, 23)).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}`;
      const { data: bookingRow, error: bookingErr } = await adminSupabase.from("pitch_bookings").insert({
        pitch_id: pitch.id,
        post_id: post.id,
        booked_by: userId,
        match_date: post.match_date,
        start_time: startTime,
        end_time: endTime,
        booker_name: `${post.team_name} vs ${team.name}`,
        booking_type: "platform",
        total_price_pence: feePence,
        player_count: 22,
        per_player_pence: perPlayerPence,
        unitr_fee_pence: feeOn(perPlayerPence),
        status: "confirmed",
      }).select("id").single();
      if (bookingErr) console.error("pitch_bookings insert failed:", bookingErr.message);
      else if (bookingRow) {
        pitchBookingId = bookingRow.id;
        undo.push(() => adminSupabase.from("pitch_bookings").delete().eq("id", bookingRow.id));
      }
    }

    const { data: matchRecord, error: matchErr } = await adminSupabase.from("matches").insert({
      post_id: post.id,
      posting_team_id: post.team_id,
      challenging_team_id: team.id,
      confirmed_pitch: pitch,
      match_date: post.match_date,
      match_time: pitchTime,
    }).select("id").single();
    if (matchErr || !matchRecord) {
      await rollback();
      return NextResponse.json({ error: "Couldn't create the match. Nothing was charged." }, { status: 500 });
    }
    // Confirmations cascade with the match row (match_id … on delete cascade).
    undo.push(() => adminSupabase.from("matches").delete().eq("id", matchRecord.id));

    // The charge. The functions lock both credit rows and re-check the balance,
    // so a race with another spend fails here rather than overdrawing.
    const { error: chargeErr } = isSecured
      ? await adminSupabase.rpc("reimburse_secured_pitch", {
          p_match_id: matchRecord.id, p_posting_team: post.team_id, p_challenging_team: team.id, p_fee_pence: feePence,
        })
      : await adminSupabase.rpc("split_pitch_fee", {
          p_match_id: matchRecord.id, p_posting_team: post.team_id, p_challenging_team: team.id, p_fee_pence: feePence,
        });
    if (chargeErr) {
      await rollback();
      const short = /INSUFFICIENT_CREDIT/.test(chargeErr.message);
      console.error("challenge charge failed:", chargeErr.message);
      return short
        ? fail(409, "SHORTFALL", "Your team's balance changed — there isn't enough for your half of the pitch now.", {
            shortfallPence: challengerHalfPence, halfPence: challengerHalfPence,
          })
        : NextResponse.json({ error: "The payment couldn't be taken. Nothing was charged." }, { status: 500 });
    }

    // ── Charged. Nothing below may fail the request: the money has moved. ──

    if (!isSecured) {
      // The pitch is paid the moment both halves leave team credit; say so, or
      // the venue portal shows the slot unpaid forever.
      if (pitchBookingId) await adminSupabase.from("pitch_bookings").update({ payment_status: "paid" }).eq("id", pitchBookingId);
      // Release the poster's batch earmark, if credit mode placed one at post time.
      const { data: holdOwner } = await adminSupabase
        .from("match_posts").select("id, hold_pence")
        .eq("team_id", post.team_id).gt("hold_pence", 0).limit(1).maybeSingle();
      if (holdOwner?.hold_pence) {
        const { error: relErr } = await adminSupabase.rpc("release_hold", {
          p_team_id: post.team_id, p_amount_pence: holdOwner.hold_pence, p_post_id: holdOwner.id,
        });
        if (!relErr) await adminSupabase.from("match_posts").update({ hold_pence: 0 }).eq("id", holdOwner.id);
      }
    }

    // Pay the venue its fee for the new booking, here rather than from the
    // browser (/api/connect/venue-transfer is staff-only now). A secured post's
    // venue was paid when its booking was made. Best-effort: an unconnected
    // venue is recorded as a failed transfer and must not undo the match.
    if (!isSecured && pitch.id) {
      await payVenue({ pitchId: pitch.id, bookingId: pitchBookingId, matchId: matchRecord.id, teamId: post.team_id, amountPence: feePence })
        .catch((e) => console.error("challenge venue payout failed:", e));
    }

    // The poster's other open posts are withdrawn — one fixture at a time.
    await adminSupabase.from("match_posts")
      .update({ status: "cancelled" }).eq("team_id", post.team_id).eq("status", "open").neq("id", post.id);

    // "Are you playing?" for both squads (approved members + both captains),
    // pre-filled from a poll that proposed this exact date.
    const { data: members } = await adminSupabase
      .from("team_members").select("player_id, team_id")
      .in("team_id", [post.team_id, team.id]).eq("status", "approved");
    const allPlayers = [
      ...((members ?? []) as { player_id: string; team_id: string }[]),
      { player_id: post.captain_id as string, team_id: post.team_id as string },
      { player_id: (team.captain_id as string | null) ?? userId, team_id: team.id as string },
    ].filter((p, i, arr) => p.player_id && arr.findIndex((x) => x.player_id === p.player_id) === i);
    if (allPlayers.length > 0) {
      await adminSupabase.from("match_confirmations").insert(
        allPlayers.map((p) => ({ match_id: matchRecord.id, player_id: p.player_id, team_id: p.team_id, status: "pending" })),
      );
      for (const squadTeamId of [post.team_id as string, team.id as string]) {
        await seedAvailabilityFromPoll(adminSupabase, {
          teamId: squadTeamId,
          target: { matchId: matchRecord.id },
          date: post.match_date,
          time: pitchTime,
          playerIds: allPlayers.filter((p) => p.team_id === squadTeamId).map((p) => p.player_id),
        });
      }
    }

    return NextResponse.json({
      matchId: matchRecord.id,
      pitchBookingId,
      feePence,
      halfPence: challengerHalfPence,
      postingTeamId: post.team_id,
      pitchId: pitch.id ?? null,
    });
  } catch (err) {
    console.error("challenge accept error:", err);
    return NextResponse.json({ error: "Something went wrong accepting the match." }, { status: 500 });
  }
}
