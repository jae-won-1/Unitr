import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCallerId, isTeamLeader, forbidden, unauthorized } from "@/lib/api-auth";
import { financeOff, sendFinanceMessages, UUID } from "@/lib/team-finance-server";
import { pounds, type RequestAction } from "@/lib/team-finance";

export const dynamic = "force-dynamic";

// What a leader does to a request after sending it: tick a member off (cash,
// a bank transfer), untick a mistaken tick, remind, drop a member added by
// mistake, or cancel the whole request.
//
// Ticking is bookkeeping — it moves no money and calls no Stripe. A CARD
// payment is never unticked here: that money really arrived, and only a
// refund (the webhook) takes it back.

const ACTIONS: RequestAction[] = ["mark_paid", "mark_unpaid", "remind", "remove_member", "cancel"];
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: NextRequest) {
  const off = financeOff();
  if (off) return off;

  const callerId = await getCallerId(req);
  if (!callerId) return unauthorized();

  const { requestId, action, playerId } = await req.json().catch(() => ({}));
  if (!UUID.test(requestId ?? "")) return bad("Missing requestId");
  if (!ACTIONS.includes(action)) return bad("Unknown action.");

  const { data: request } = await adminSupabase.from("payment_requests")
    .select("id, team_id, title, cancelled_at").eq("id", requestId).maybeSingle();
  if (!request || request.cancelled_at) return bad("That request no longer exists.", 404);
  if (!(await isTeamLeader(callerId, request.team_id as string))) {
    return forbidden("Only the captain or a co-captain can manage payment requests.");
  }

  if (action === "cancel") {
    // Kept, not deleted: anything already paid on it stays in the balance.
    const { error } = await adminSupabase.from("payment_requests")
      .update({ cancelled_at: new Date().toISOString() }).eq("id", requestId);
    return error ? bad("Couldn't cancel the request.", 500) : NextResponse.json({ ok: true });
  }

  if (!UUID.test(playerId ?? "")) return bad("Missing playerId");
  const { data: member } = await adminSupabase.from("payment_request_members")
    .select("id, amount_pence, paid_pence, paid_via")
    .eq("request_id", requestId).eq("player_id", playerId).maybeSingle();
  if (!member) return bad("That player isn't on this request.", 404);

  const owed = Math.max(0, (member.amount_pence as number) - (member.paid_pence as number));

  // What has come in by card on this row, net of refunds — the floor a tick
  // can be taken back to.
  const cardPaid = async (): Promise<number> => {
    const { data } = await adminSupabase.from("payment_request_payments")
      .select("amount_pence, refunded_pence").eq("member_id", member.id);
    return (data ?? []).reduce((sum, p) => sum + (p.amount_pence as number) - (p.refunded_pence as number), 0);
  };

  let error: { message: string } | null = null;

  if (action === "mark_paid") {
    if (owed === 0) return NextResponse.json({ ok: true });
    ({ error } = await adminSupabase.from("payment_request_members")
      .update({ paid_pence: member.amount_pence, paid_via: "manual", paid_at: new Date().toISOString() })
      .eq("id", member.id));
  } else if (action === "mark_unpaid") {
    if (member.paid_via !== "manual") return bad("That was paid by card, so it can't be unticked.", 409);
    const card = await cardPaid();
    ({ error } = await adminSupabase.from("payment_request_members")
      .update({ paid_pence: card, paid_via: card > 0 ? "card" : null, paid_at: null })
      .eq("id", member.id));
  } else if (action === "remove_member") {
    if ((member.paid_pence as number) > 0) return bad("They've already paid towards this, so they can't be removed.", 409);
    ({ error } = await adminSupabase.from("payment_request_members").delete().eq("id", member.id));
  } else {
    if (owed === 0) return bad("They've already paid.", 409);
    await sendFinanceMessages(callerId, [{
      receiverId: playerId,
      body: `Reminder: you owe ${pounds(owed)} for ${request.title}. Pay it in Team finance.`,
    }]);
    ({ error } = await adminSupabase.from("payment_request_members")
      .update({ reminded_at: new Date().toISOString() }).eq("id", member.id));
  }

  if (error) {
    console.error(`finance/request-action ${action}:`, error.message);
    return bad("Couldn't save that.", 500);
  }
  return NextResponse.json({ ok: true });
}
