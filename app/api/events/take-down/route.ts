import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCallerId, isAdmin, forbidden, unauthorized } from "@/lib/api-auth";

// Take one of Unitr's own hosted events off the feed.
//
// The sibling of /api/posts/take-down, for the other kind of thing that sits on
// the feed: an open_matches row an admin posted (a tournament, a league, or a
// hosted friendly — /admin/create writes all three). It only ever touches those.
// A team's or a venue's event is somebody else's fixture, and cancelling one is
// their decision and their money; this route refuses them outright rather than
// half-doing it.
//
// Taking an event down is two things, and both have to happen here:
//
//   1. The status flip to 'cancelled'. Every feed and calendar query already
//      filters that out (GameFeed, lib/tournament-fixtures.ts), and
//      /api/tournaments/join refuses a cancelled listing, so the flip is what
//      actually removes the event.
//   2. The buy-ins going back. A team that entered paid out of its credit pot,
//      and an event that isn't happening cannot keep the money. refund_event_buyin
//      reads what each team really paid off the ledger (an invitation discount is
//      applied at join and never written back to the listing, so the list price is
//      not that number) and is idempotent, so a retried or repeated take-down
//      cannot pay a team twice.
export async function POST(req: NextRequest) {
  try {
    const callerId = await getCallerId(req);
    if (!callerId) return unauthorized();
    if (!(await isAdmin(callerId))) return forbidden("Only Unitr staff can take an event down.");

    const { openMatchId, reason } = await req.json();
    if (!openMatchId) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

    const { data: event, error: readErr } = await adminSupabase
      .from("open_matches")
      .select("id, title, match_type, status, match_date, start_time, organiser_admin_id")
      .eq("id", openMatchId)
      .maybeSingle();

    // 42703: supabase_admin_hosting.sql hasn't been run, so no event can be
    // admin-hosted yet and there is nothing here to take down.
    if (readErr?.code === "42703") {
      return NextResponse.json({ error: "Run supabase_admin_hosting.sql in Supabase first." }, { status: 409 });
    }
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    if (!event.organiser_admin_id) {
      return forbidden("That event is hosted by a team or a venue — only its organiser can cancel it.");
    }

    // Already down — the desired end state. Say yes rather than erroring at
    // someone who double-tapped or is looking at a stale page. The refunds
    // below still run: the flip and the money are separate writes, and a
    // take-down that fell over between them has to be finishable.
    const alreadyDown = event.status === "cancelled";

    // The reason is what every entered team is told, so it is required even
    // when nobody has entered yet — the event is still on somebody's screen.
    const note = typeof reason === "string" ? reason.trim() : "";
    if (!note && !alreadyDown) {
      return NextResponse.json({ error: "Give a reason — every entered team is told what it was." }, { status: 400 });
    }

    if (!alreadyDown) {
      const takenDown = {
        status: "cancelled",
        taken_down_by: callerId,
        taken_down_at: new Date().toISOString(),
        taken_down_reason: note,
      };
      const { error: updErr } = await adminSupabase.from("open_matches").update(takenDown).eq("id", openMatchId);
      if (updErr) {
        // 42703: supabase_event_takedown.sql hasn't been run. The take-down is
        // the status flip; the provenance columns are the extra. Degrade to the
        // flip rather than leaving an event up over a missing migration.
        if (updErr.code !== "42703") throw updErr;
        const { error: plainErr } = await adminSupabase
          .from("open_matches").update({ status: "cancelled" }).eq("id", openMatchId);
        if (plainErr) throw plainErr;
      }
    }

    // ── Give the buy-ins back ──
    const { data: entered } = await adminSupabase
      .from("open_match_teams")
      .select("team_id, team_name")
      .eq("open_match_id", openMatchId);

    let refundedPence = 0;
    let refundedTeams = 0;
    let refundError: string | null = null;
    const refundByTeam = new Map<string, number>();

    for (const entry of entered ?? []) {
      const { data: amount, error: refErr } = await adminSupabase.rpc("refund_event_buyin", {
        p_team_id: entry.team_id,
        p_open_match_id: openMatchId,
        p_actor_id: callerId,
      });
      if (refErr) {
        // 42883: the function isn't there (migration not run). The event is
        // already down, which is the urgent half — report the money as still
        // owed instead of pretending it moved.
        refundError = refErr.code === "42883"
          ? "Event taken down, but buy-ins weren't refunded — run supabase_event_takedown.sql in Supabase."
          : "Event taken down, but at least one buy-in couldn't be refunded — check the credit ledger.";
        console.error("refund_event_buyin failed:", refErr.message);
        continue;
      }
      const pence = Number(amount ?? 0);
      refundByTeam.set(entry.team_id as string, pence);
      if (pence > 0) { refundedPence += pence; refundedTeams += 1; }
    }

    // A pending invitation is an offer to buy into an event that no longer
    // exists. Leave accepted and declined ones alone — those are history.
    await adminSupabase.from("tournament_invitations")
      .update({ status: "cancelled" })
      .eq("open_match_id", openMatchId)
      .eq("status", "pending");

    // ── Tell the teams that were in it ──
    // Best-effort: a failed bell notification must not fail a take-down that
    // has already moved money.
    const teamIds = (entered ?? []).map((e) => e.team_id as string);
    if (!alreadyDown && teamIds.length > 0) {
      const { data: teamRows } = await adminSupabase
        .from("teams").select("id, captain_id").in("id", teamIds);
      const label = event.match_type === "league" ? "league" : event.match_type === "match" ? "match" : "tournament";
      const notifs = (teamRows ?? [])
        .filter((r) => r.captain_id)
        .map((r) => {
          const back = refundByTeam.get(r.id as string) ?? 0;
          return {
            user_id: r.captain_id,
            type: "event_cancelled",
            title: `${event.title ?? "An event"} was cancelled`,
            body: `Unitr cancelled the ${label} on ${event.match_date}`
              + `${event.start_time ? ` at ${event.start_time}` : ""}. Reason: ${note}`
              + `${back > 0 ? ` Your £${(back / 100).toFixed(2)} buy-in is back in your team credit.` : ""}`,
            link: "/calendar",
          };
        });
      if (notifs.length) {
        const { error: notifErr } = await adminSupabase.from("notifications").insert(notifs);
        if (notifErr) console.error("Event take-down notification failed:", notifErr.message);
      }
    }

    return NextResponse.json({
      success: true,
      alreadyDown,
      refundedPence,
      refundedTeams,
      ...(refundError ? { warning: refundError } : {}),
    });
  } catch (err) {
    console.error("Take down event error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
