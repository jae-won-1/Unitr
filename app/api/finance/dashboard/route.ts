import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCallerId, isTeamLeader, isTeamMember, forbidden, unauthorized } from "@/lib/api-auth";
import {
  financeOff, loadFinanceAccount, loadNames, loadSquad, trackedBalancePence, UUID,
} from "@/lib/team-finance-server";
import type { FinanceDashboard, FinanceRequest, RequestMember } from "@/lib/team-finance";
import { withOptionalColumn } from "@/lib/optional-column";

export const dynamic = "force-dynamic";

// Everything the Team Finance screen shows, in one read.
//
// The tables are server-only, so this route is where "who may see what" is
// decided: a leader gets the whole squad's status, the tracked balance and the
// squad list; a member gets only the requests sent to them, with only their
// own row on each.

type MemberRow = {
  request_id: string;
  player_id: string;
  amount_pence: number;
  paid_pence: number;
  paid_via: "card" | "manual" | null;
  paid_at: string | null;
  reminded_at: string | null;
};

export async function GET(req: NextRequest) {
  const off = financeOff();
  if (off) return off;

  const callerId = await getCallerId(req);
  if (!callerId) return unauthorized();

  const teamId = req.nextUrl.searchParams.get("teamId") ?? "";
  if (!UUID.test(teamId)) return NextResponse.json({ error: "Missing teamId" }, { status: 400 });
  if (!(await isTeamMember(callerId, teamId))) return forbidden("You're not in that team.");
  const isLeader = await isTeamLeader(callerId, teamId);

  // captain_exempt comes from supabase_team_finance_captain_exempt.sql, which
  // may not have been run; without it nobody is exempt.
  const { data: requestRows, error: reqErr } = await withOptionalColumn<Record<string, unknown>[]>(
    "captain_exempt",
    (withExempt) => adminSupabase
      .from("payment_requests")
      .select(`id, kind, title, description, image_path, amount_pence, due_date, match_id, open_match_id, created_at${withExempt ? ", captain_exempt" : ""}`)
      .eq("team_id", teamId).is("cancelled_at", null)
      .order("created_at", { ascending: false }).limit(300)
      .returns<Record<string, unknown>[]>(),
  );

  if (reqErr) {
    // The house rule: a missing migration says so instead of crashing.
    const body: FinanceDashboard = {
      setupNeeded: "Team finance needs supabase_team_finance.sql run on this database.",
      isLeader,
      account: { linked: false, ready: false, linkedByMe: false, linkedByName: null },
      balancePence: null, requests: [], entries: [], squad: [],
    };
    return NextResponse.json(body);
  }

  const requestIds = (requestRows ?? []).map((r) => r.id as string);
  const { data: memberRows } = requestIds.length
    ? await adminSupabase.from("payment_request_members")
        .select("request_id, player_id, amount_pence, paid_pence, paid_via, paid_at, reminded_at")
        .in("request_id", requestIds)
    : { data: [] as MemberRow[] };

  const rows = (memberRows ?? []) as MemberRow[];
  const names = await loadNames([...new Set(rows.map((m) => m.player_id))]);

  const byRequest = new Map<string, RequestMember[]>();
  for (const m of rows) {
    const list = byRequest.get(m.request_id) ?? [];
    list.push({
      playerId: m.player_id,
      name: names.get(m.player_id) ?? "Player",
      amountPence: m.amount_pence,
      paidPence: m.paid_pence,
      paidVia: m.paid_via,
      paidAt: m.paid_at,
      remindedAt: m.reminded_at,
    });
    byRequest.set(m.request_id, list);
  }

  const owes = (m: RequestMember) => Math.max(0, m.amountPence - m.paidPence);

  const requests: FinanceRequest[] = [];
  for (const r of requestRows ?? []) {
    const all = (byRequest.get(r.id as string) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    const mine = all.find((m) => m.playerId === callerId) ?? null;
    // A member sees a request only if it was sent to them.
    if (!isLeader && !mine) continue;
    const counted = isLeader ? all : (mine ? [mine] : []);

    let imageUrl: string | null = null;
    if (r.image_path) {
      const { data: signed } = await adminSupabase.storage
        .from("payment-requests").createSignedUrl(r.image_path as string, 60 * 60);
      imageUrl = signed?.signedUrl ?? null;
    }

    requests.push({
      id: r.id as string,
      kind: r.kind as FinanceRequest["kind"],
      title: r.title as string,
      description: (r.description as string | null) ?? null,
      imageUrl,
      amountPence: r.amount_pence as number,
      dueDate: (r.due_date as string | null) ?? null,
      createdAt: r.created_at as string,
      matchId: (r.match_id as string | null) ?? null,
      openMatchId: (r.open_match_id as string | null) ?? null,
      captainExempt: r.captain_exempt === true,
      memberCount: counted.length,
      paidCount: counted.filter((m) => owes(m) === 0).length,
      outstandingPence: counted.reduce((sum, m) => sum + owes(m), 0),
      members: isLeader ? all : [],
      mine,
    });
  }

  const account = await loadFinanceAccount(teamId);
  const linkedByName = account
    ? (await loadNames([account.linked_by])).get(account.linked_by) ?? null
    : null;

  let balancePence: number | null = null;
  let entries: FinanceDashboard["entries"] = [];
  let squad: FinanceDashboard["squad"] = [];
  const entrySpend: Record<string, number> = {};
  if (isLeader) {
    const { data: spendRows } = await adminSupabase.from("team_finance_entries")
      .select("open_match_id, amount_pence")
      .eq("team_id", teamId).eq("kind", "spend").not("open_match_id", "is", null);
    for (const s of spendRows ?? []) {
      const id = s.open_match_id as string;
      entrySpend[id] = (entrySpend[id] ?? 0) - (s.amount_pence as number);
    }
    const [balance, { data: entryRows }, squadRows] = await Promise.all([
      trackedBalancePence(teamId),
      adminSupabase.from("team_finance_entries")
        .select("id, kind, amount_pence, note, created_at")
        .eq("team_id", teamId).order("created_at", { ascending: false }).limit(50),
      loadSquad(teamId),
    ]);
    balancePence = balance;
    entries = (entryRows ?? []).map((e) => ({
      id: e.id as string,
      kind: e.kind as FinanceDashboard["entries"][number]["kind"],
      amountPence: e.amount_pence as number,
      note: (e.note as string | null) ?? null,
      createdAt: e.created_at as string,
    }));
    squad = squadRows;
  }

  const body: FinanceDashboard = {
    isLeader,
    account: {
      linked: Boolean(account),
      ready: Boolean(account?.transfers_active),
      linkedByMe: account?.linked_by === callerId,
      linkedByName,
    },
    balancePence,
    requests,
    entries,
    squad,
    ...(isLeader ? { entrySpend } : {}),
  };
  return NextResponse.json(body);
}
