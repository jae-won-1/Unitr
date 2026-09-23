import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCallerId, isAdmin, forbidden, unauthorized } from "@/lib/api-auth";
import { isKickoffPast } from "@/lib/match-dates";

// Remove ONE team from one of Uniter's own hosted events, and give it its
// buy-in back.
//
// The narrow sibling of /api/events/take-down: that one cancels the whole
// event, this one turns a single entry back into a non-entry. Same two halves
// and the same reasoning behind them — an entry that is being undone cannot
// keep the money, and refund_event_buyin reads what the team ACTUALLY paid off
// the ledger (an invitation discount is applied at join and never written back
// to the listing) and is idempotent, so a repeated kick cannot pay twice.
//
// Same refusals too. Only Uniter staff, only an event with organiser_admin_id
// — a team's or a venue's event is their fixture and their money — and never
// after kickoff, because football that happened cannot be refunded.
//
// Undoing the entry is more than deleting the row. Entering wrote four other
// things (/api/tournaments/join step 7 and 8, plus whatever the captain has
// since issued), and each of them is a question asked of a squad that is no
// longer playing: the availability answers, the pending replenishments, any
// settle request the captain issued, and the fixtures the team was drawn into.
// They are cleaned up below, best-effort — the money is the part that must not
// be left half-done, so a failure there is reported and a failure in the tidying
// is logged.
export async function POST(req: NextRequest) {
  try {
    const callerId = await getCallerId(req);
    if (!callerId) return unauthorized();
    if (!(await isAdmin(callerId))) return forbidden("Only Uniter staff can remove a team from an event.");

    const { openMatchId, teamId, reason } = await req.json();
    if (!openMatchId || !teamId) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    // teamId is interpolated into a PostgREST `or` filter below, where a stray
    // comma or dot would be read as filter syntax rather than as a value.
    if (!/^[0-9a-f-]{36}$/i.test(String(teamId))) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const { data: event, error: readErr } = await adminSupabase
      .from("open_matches")
      .select("id, title, match_type, status, match_date, start_time, max_teams, booking_id, organiser_team_id, organiser_admin_id")
      .eq("id", openMatchId)
      .maybeSingle();

    // 42703: supabase_admin_hosting.sql hasn't been run, so no event can be
    // admin-hosted yet and there is nothing here to manage.
    if (readErr?.code === "42703") {
      return NextResponse.json({ error: "Run supabase_admin_hosting.sql in Supabase first." }, { status: 409 });
    }
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    if (!event.organiser_admin_id) {
      return forbidden("That event is hosted by a team or a venue — only its organiser can remove a team.");
    }
    if (event.organiser_team_id && event.organiser_team_id === teamId) {
      return forbidden("That team is hosting this event.");
    }
    if (isKickoffPast(event.match_date, event.start_time)) {
      return NextResponse.json({ error: "This event has already kicked off." }, { status: 409 });
    }

    // The reason is what the team's captain is told, so it is required — an
    // entry vanishing with the money back and no explanation reads as a bug.
    const note = typeof reason === "string" ? reason.trim() : "";
    if (!note) {
      return NextResponse.json({ error: "Give a reason — the team's captain is told what it was." }, { status: 400 });
    }

    const { data: entry } = await adminSupabase
      .from("open_match_teams")
      .select("id, team_id, team_name")
      .eq("open_match_id", openMatchId)
      .eq("team_id", teamId)
      .maybeSingle();
    if (!entry) return NextResponse.json({ error: "That team isn't entered in this event." }, { status: 404 });

    // ── Give the buy-in back ──
    // Before the entry row goes, so a failure here leaves the team still
    // entered and the kick retryable, rather than out of the event and out of
    // pocket.
    const { data: amount, error: refErr } = await adminSupabase.rpc("refund_event_buyin", {
      p_team_id: teamId,
      p_open_match_id: openMatchId,
      p_actor_id: callerId,
    });
    if (refErr) {
      // 42883: the function isn't there (migration not run). Nothing has moved
      // yet, so refuse outright rather than removing a team whose money we
      // can't return.
      if (refErr.code === "42883") {
        return NextResponse.json(
          { error: "Run supabase_event_takedown.sql in Supabase first — it holds the buy-in refund." },
          { status: 409 },
        );
      }
      console.error("refund_event_buyin failed:", refErr.message);
      return NextResponse.json(
        { error: "Couldn't refund that team's buy-in, so they haven't been removed — check the credit ledger." },
        { status: 500 },
      );
    }
    const refundedPence = Number(amount ?? 0);

    // ── Take the entry out ──
    const { error: delErr } = await adminSupabase
      .from("open_match_teams").delete().eq("id", entry.id);
    if (delErr) {
      // The refund above is idempotent, so a retry nets to zero rather than
      // paying twice — saying "try again" is safe.
      console.error("kick-team delete failed:", delErr.message);
      return NextResponse.json(
        { error: "Buy-in refunded, but the entry couldn't be removed — try again." },
        { status: 500 },
      );
    }

    // ── Unask everything the entry asked ──
    // All best-effort: the team is out and paid back, which is the part that
    // matters, and a database missing a migration must not fail that.

    // The squad's availability answers for this event (keyed off open_match_id
    // — a tournament has no matches row).
    const { error: confErr } = await adminSupabase
      .from("match_confirmations").delete()
      .eq("open_match_id", openMatchId).eq("team_id", teamId);
    if (confErr) console.error("kick-team confirmations cleanup:", confErr.message);

    // The schedule. A fixture this team was drawn into is now a game with one
    // side, and a referee drawn from its squad is no longer at the event. The
    // organiser regenerates the schedule after a change like this; these two
    // writes stop the stale half being read as fact in the meantime.
    const { error: fxErr } = await adminSupabase
      .from("tournament_matches").delete()
      .eq("open_match_id", openMatchId)
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`);
    if (fxErr) console.error("kick-team fixtures cleanup:", fxErr.message);

    const { data: squad } = await adminSupabase
      .from("team_members").select("player_id").eq("team_id", teamId).eq("status", "approved");
    const { data: teamRow } = await adminSupabase
      .from("teams").select("captain_id, name").eq("id", teamId).maybeSingle();
    const squadIds = [
      ...new Set([...(squad ?? []).map((m) => m.player_id as string), teamRow?.captain_id as string].filter(Boolean)),
    ];
    if (squadIds.length > 0) {
      const { error: refWipeErr } = await adminSupabase
        .from("tournament_matches")
        .update({ referee_player_id: null, referee_name: null, referee_team_name: null })
        .eq("open_match_id", openMatchId)
        .in("referee_player_id", squadIds);
      if (refWipeErr) console.error("kick-team referee cleanup:", refWipeErr.message);
    }

    // The money the squad was going to be asked for. The pending replenishments
    // /api/tournaments/join pre-created, and any settle request the captain has
    // since issued — both are shares of a buy-in that has just gone back.
    // Anything already paid is left alone: that money is in the team's credit
    // and stays there.
    if (event.booking_id) {
      const { error: payErr } = await adminSupabase
        .from("player_payments").delete()
        .eq("booking_id", event.booking_id).eq("team_id", teamId)
        .eq("status", "pending").eq("purpose", "replenish");
      if (payErr) console.error("kick-team replenishment cleanup:", payErr.message);
    }
    const { error: dueErr } = await adminSupabase
      .from("payment_collection_status").delete()
      .eq("open_match_id", openMatchId).eq("team_id", teamId).eq("received", false);
    if (dueErr) console.error("kick-team dues cleanup:", dueErr.message);

    // A pending invitation is an offer this team is no longer wanted to take.
    await adminSupabase.from("tournament_invitations")
      .update({ status: "cancelled" })
      .eq("open_match_id", openMatchId).eq("team_id", teamId).eq("status", "pending");

    // ── The spot is open again ──
    // 'full' was written by the join that took the last place; there is now a
    // place free, and a listing left at 'full' is off the feed and refuses
    // entry.
    if (event.status === "full") {
      const { count } = await adminSupabase
        .from("open_match_teams")
        .select("team_id", { count: "exact", head: true })
        .eq("open_match_id", openMatchId);
      if ((count ?? 0) < (event.max_teams ?? 0)) {
        await adminSupabase.from("open_matches").update({ status: "open" }).eq("id", openMatchId);
      }
    }

    // ── Tell the team ──
    // Best-effort: a failed bell notification must not fail a removal that has
    // already moved money.
    if (teamRow?.captain_id) {
      const label = event.match_type === "league" ? "league" : event.match_type === "match" ? "match" : "tournament";
      const { error: notifErr } = await adminSupabase.from("notifications").insert({
        user_id: teamRow.captain_id,
        type: "event_entry_removed",
        title: `Your team was removed from ${event.title ?? "an event"}`,
        body: `Uniter removed ${entry.team_name || teamRow.name || "your team"} from the ${label} on ${event.match_date}`
          + `${event.start_time ? ` at ${event.start_time}` : ""}. Reason: ${note}`
          + `${refundedPence > 0 ? ` Your £${(refundedPence / 100).toFixed(2)} buy-in is back in your team credit.` : ""}`,
        link: "/calendar",
      });
      if (notifErr) console.error("kick-team notification failed:", notifErr.message);
    }

    return NextResponse.json({
      success: true,
      refundedPence,
      teamName: entry.team_name || teamRow?.name || "That team",
    });
  } catch (err) {
    console.error("Kick team error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
