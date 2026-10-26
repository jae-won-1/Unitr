import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCallerId, isTeamCaptain, forbidden, unauthorized } from "@/lib/api-auth";

// The captain hands their team to one of its co-captains (lib/hand-over-team.ts).
//
// Captain only — not a co-captain, for the same reason appointing co-captains
// is captain only: it is the one power that stays with whoever was handed the
// team. The work is hand_over_team (supabase_account_deletion.sql), a single
// transaction granted to the service role alone; this route is where the
// caller is checked, so the function trusts the ids it is given.
export async function POST(req: NextRequest) {
  try {
    const callerId = await getCallerId(req);
    if (!callerId) return unauthorized();

    const { teamId, toPlayerId } = await req.json();
    if (!teamId || !toPlayerId) {
      return NextResponse.json({ error: "Missing teamId or toPlayerId" }, { status: 400 });
    }
    if (!(await isTeamCaptain(callerId, teamId))) {
      return forbidden("Only the captain can hand the team over.");
    }

    const { error } = await adminSupabase.rpc("hand_over_team", {
      p_team_id: teamId, p_from: callerId, p_to: toPlayerId,
    });
    if (error) {
      if (/hand_over_team|does not exist|schema cache/i.test(error.message)) {
        return NextResponse.json(
          { error: "Handing over isn't set up yet — run supabase_account_deletion.sql in Supabase." },
          { status: 503 });
      }
      // The function's own refusals are written for the captain to read.
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("hand-over error:", err);
    return NextResponse.json({ error: "Couldn't hand the team over." }, { status: 500 });
  }
}
