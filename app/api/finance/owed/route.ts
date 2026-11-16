import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCallerId, isTeamLeader, unauthorized } from "@/lib/api-auth";
import { financeOff, UUID } from "@/lib/team-finance-server";
import { NOTHING_OWED, type Owed } from "@/lib/team-finance";

export const dynamic = "force-dynamic";

// What the caller owes one team, by kind. The availability gate asks this
// (lib/availability-gate.ts): the joining fee and match fees stop a player
// voting Available; any other request never does (user, 10 Nov 2026).
//
// Answers only ever for the caller, and anything going wrong reads as "owes
// nothing" — the gate must not lock a squad out on a failed lookup.
export async function GET(req: NextRequest) {
  const off = financeOff();
  if (off) return off;

  const callerId = await getCallerId(req);
  if (!callerId) return unauthorized();

  const teamId = req.nextUrl.searchParams.get("teamId") ?? "";
  if (!UUID.test(teamId)) return NextResponse.json({ error: "Missing teamId" }, { status: 400 });

  const isLeader = await isTeamLeader(callerId, teamId);

  // A leader's badge counts requests anybody still owes on, so they need the
  // whole team's rows; a member only their own.
  const query = adminSupabase.from("payment_request_members")
    .select("request_id, player_id, amount_pence, paid_pence").eq("team_id", teamId);
  const { data: rows, error } = isLeader ? await query : await query.eq("player_id", callerId);
  if (error || !rows || rows.length === 0) {
    return NextResponse.json({ ...NOTHING_OWED, isLeader } satisfies Owed);
  }

  const { data: requests } = await adminSupabase.from("payment_requests")
    .select("id, kind").in("id", [...new Set(rows.map((r) => r.request_id as string))])
    .is("cancelled_at", null);
  const kindById = new Map((requests ?? []).map((r) => [r.id as string, r.kind as string]));

  const out: Owed = { ...NOTHING_OWED, isLeader };
  const open = new Set<string>();
  for (const r of rows) {
    const kind = kindById.get(r.request_id as string);
    if (!kind) continue;   // a cancelled request asks for nothing
    const owed = Math.max(0, (r.amount_pence as number) - (r.paid_pence as number));
    if (owed > 0) open.add(r.request_id as string);
    if (r.player_id !== callerId) continue;
    if (kind === "joining_fee") {
      out.feeDuePence += r.amount_pence as number;
      out.feePaidPence += r.paid_pence as number;
      out.feeOwedPence += owed;
    } else if (kind === "match_fee") {
      out.duesOwedPence += owed;
    } else {
      out.otherOwedPence += owed;
    }
  }
  out.openRequests = isLeader ? open.size : 0;
  return NextResponse.json(out);
}
