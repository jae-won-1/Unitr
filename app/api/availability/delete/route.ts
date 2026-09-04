import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCallerId, isTeamLeader, forbidden, unauthorized } from "@/lib/api-auth";

// Delete a team's live availability poll and every answer on it.
//
// The captain used to be identified by a captainId in the body, which the poll
// row was then compared against — a check anyone could pass by sending the
// captain's id, which is readable from any team row. The caller is taken from
// their session token now, so the comparison means something.
export async function DELETE(req: NextRequest) {
  try {
    const callerId = await getCallerId(req);
    if (!callerId) return unauthorized();

    const { requestId } = await req.json();
    if (!requestId) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const { data: poll } = await adminSupabase
      .from("availability_requests")
      .select("captain_id, team_id")
      .eq("id", requestId)
      .maybeSingle();

    if (!poll) return NextResponse.json({ error: "Poll not found" }, { status: 404 });
    // The poll is filed under the team's captain even when a co-captain
    // opened it, so the question is "do you run this team?", not "is this
    // row's id yours?".
    const mayDelete = poll.captain_id === callerId
      || (poll.team_id ? await isTeamLeader(callerId, poll.team_id as string) : false);
    if (!mayDelete) return forbidden("That poll belongs to another team.");

    await adminSupabase.from("availability_responses").delete().eq("request_id", requestId);
    await adminSupabase.from("availability_requests").delete().eq("id", requestId);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete availability error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
