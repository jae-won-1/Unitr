import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCallerId, isAdmin, isTeamLeader, forbidden, unauthorized } from "@/lib/api-auth";

// Take a match post off the feed.
//
// Two people can do this, and the route is deliberately the only place either
// of them does it:
//
//  - the team that posted it (captain or co-captain), pressing "Take Down
//    Post" on their own card;
//  - a Unitr admin moderating the feed from /admin/posts, who is removing
//    someone else's post and has to say why.
//
// It lives server-side because the second case is an authorisation question
// the browser cannot answer — RLS on match_posts is `using (true)`, so "is
// this caller staff?" has to be asked of a verified session token, not of a
// flag the client sends. The first case moved here too rather than staying a
// direct client update: taking a post down has a money side (a credit earmark
// to release, a secured booking to hand back), and having one code path do it
// is what stops the two drifting apart.

export async function POST(req: NextRequest) {
  try {
    const callerId = await getCallerId(req);
    if (!callerId) return unauthorized();

    const { postId, reason } = await req.json();
    if (!postId) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

    const { data: post } = await adminSupabase
      .from("match_posts")
      .select("id, team_id, captain_id, status, hold_pence, secured_booking_id, team_name, match_date, match_time")
      .eq("id", postId)
      .maybeSingle();

    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

    // Already down — the desired end state, so say yes rather than erroring at
    // someone who double-tapped or is looking at a stale feed.
    if (post.status === "cancelled") return NextResponse.json({ success: true, alreadyDown: true });

    // A post that found an opponent is no longer a post: there is a match, a
    // squad and split money behind it. Cancelling that is a different job with
    // refunds attached, and this route will not pretend to do it.
    if (post.status !== "open") {
      return NextResponse.json({ error: "That post has already been matched." }, { status: 409 });
    }

    const staff = await isAdmin(callerId);
    const owns = await isTeamLeader(callerId, post.team_id as string);
    if (!staff && !owns) return forbidden("That post belongs to another team.");

    // An admin removing another team's post must leave a reason — it is the
    // only thing the captain will have to go on. The team's own take-down
    // needs none; nobody has to justify a decision to themselves.
    const moderated = staff && !owns;
    const note = typeof reason === "string" ? reason.trim() : "";
    if (moderated && !note) {
      return NextResponse.json({ error: "Give a reason — the captain is told what it was." }, { status: 400 });
    }

    const takenDown = {
      status: "cancelled",
      taken_down_by: callerId,
      taken_down_at: new Date().toISOString(),
      taken_down_reason: note || null,
    };
    const { error: updErr } = await adminSupabase.from("match_posts").update(takenDown).eq("id", postId);
    if (updErr) {
      // 42703: supabase_post_takedown.sql hasn't been run. The take-down is
      // the status flip; the provenance columns are the extra. Degrade to the
      // flip rather than leaving an abusive post up over a missing migration.
      if (updErr.code !== "42703") throw updErr;
      const { error: plainErr } = await adminSupabase
        .from("match_posts").update({ status: "cancelled" }).eq("id", postId);
      if (plainErr) throw plainErr;
    }

    // ── Release the credit earmark, if this post is carrying it ──
    // A batch of posts (one date's alt-time pitches, or several dates) places
    // ONE earmark on a single owner post; the siblings carry hold_pence = 0.
    // So the earmark is only released when nothing of the batch is left to
    // match. While a sibling is still open the money stays reserved, and the
    // cancelled row keeps hold_pence so ChallengePanel's "find this team's
    // hold owner" lookup still finds it when that sibling matches.
    if ((post.hold_pence ?? 0) > 0) {
      const { count } = await adminSupabase
        .from("match_posts")
        .select("id", { count: "exact", head: true })
        .eq("team_id", post.team_id)
        .eq("status", "open");

      if ((count ?? 0) === 0) {
        const { error: relErr } = await adminSupabase.rpc("release_hold", {
          p_team_id: post.team_id,
          p_amount_pence: post.hold_pence,
          p_post_id: post.id,
        });
        // Clear it in the same breath, so the earmark can't be released twice.
        if (!relErr) await adminSupabase.from("match_posts").update({ hold_pence: 0 }).eq("id", postId);
        else console.error("release_hold failed:", relErr.message);
      }
    }

    // A secured post's pitch is still booked and still paid for — only the
    // advert is gone. Unlink it so the booking can be posted again.
    if (post.secured_booking_id) {
      await adminSupabase.from("pitch_bookings").update({ post_id: null }).eq("id", post.secured_booking_id);
    }

    // ── Tell the captain ──
    // Their post disappearing from their own home screen with no explanation
    // reads as a bug. Best-effort: a failed bell notification must not fail
    // the take-down itself.
    if (moderated && post.captain_id) {
      const { error: notifErr } = await adminSupabase.from("notifications").insert({
        user_id: post.captain_id,
        type: "post_taken_down",
        title: "Your match post was taken down",
        body: `Unitr staff removed ${post.team_name ?? "your team"}'s post for ${post.match_date}`
          + `${post.match_time ? ` at ${post.match_time}` : ""}. Reason: ${note}`,
        link: "/",
      });
      if (notifErr) console.error("Take-down notification failed:", notifErr.message);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Take down post error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
