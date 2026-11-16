import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCallerId, isTeamLeader, forbidden, unauthorized } from "@/lib/api-auth";
import { financeOff, loadSquad, sendFinanceMessages, UUID } from "@/lib/team-finance-server";
import { MAX_REQUEST_PENCE, MIN_REQUEST_PENCE, pounds, type RequestKind } from "@/lib/team-finance";
import { withOptionalColumn } from "@/lib/optional-column";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Create a payment request — or, for kind "joining_fee", set the team's
// joining fee, which is one standing request the whole squad is on.
//
// A form rather than JSON because a request can carry a screenshot. The file
// goes into a private bucket; the dashboard route hands out signed links.

const KINDS: RequestKind[] = ["general", "joining_fee", "match_fee"];
const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const EXEMPT_NEEDS_MIGRATION =
  "Exempting the captain needs supabase_team_finance_captain_exempt.sql run on this database.";

function text(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function amountProblem(pence: number): string | null {
  if (!Number.isInteger(pence) || pence < MIN_REQUEST_PENCE) return `The smallest request is ${pounds(MIN_REQUEST_PENCE)} each.`;
  if (pence > MAX_REQUEST_PENCE) return `The largest request is ${pounds(MAX_REQUEST_PENCE)} each.`;
  return null;
}

export async function POST(req: NextRequest) {
  const off = financeOff();
  if (off) return off;

  const callerId = await getCallerId(req);
  if (!callerId) return unauthorized();

  let form: FormData;
  try { form = await req.formData(); } catch { return bad("Couldn't read that request."); }

  const teamId = text(form, "teamId");
  const kind = text(form, "kind") as RequestKind;
  const description = text(form, "description").slice(0, 1000) || null;
  const dueDate = text(form, "dueDate") || null;
  const matchId = text(form, "matchId") || null;
  const openMatchId = text(form, "openMatchId") || null;

  if (!UUID.test(teamId)) return bad("Missing teamId");
  if (!KINDS.includes(kind)) return bad("Unknown kind of request.");
  if (!(await isTeamLeader(callerId, teamId))) return forbidden("Only the captain or a co-captain can ask the squad for money.");
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return bad("That due date isn't a date.");

  const title = (text(form, "title") || (kind === "joining_fee" ? "Joining fee" : "")).slice(0, 80);
  if (!title) return bad("Give the request a title.");

  const squad = await loadSquad(teamId);
  const squadIds = new Set(squad.map((s) => s.playerId));
  const captainId = squad.find((s) => s.isCaptain)?.playerId ?? null;
  // Joining fee only. The captain owes it like anyone else unless the team
  // says otherwise; the choice is stored on the request so changing the fee
  // later keeps it.
  const captainExempt = kind === "joining_fee" && text(form, "captainExempt") === "true" && captainId !== null;

  // Who it goes to. The joining fee is always the whole squad — less the
  // captain, if they are exempt.
  let recipients: string[];
  if (kind === "joining_fee") {
    recipients = [...squadIds].filter((id) => !(captainExempt && id === captainId));
  } else {
    let asked: unknown;
    try { asked = JSON.parse(text(form, "playerIds") || "[]"); } catch { asked = null; }
    if (!Array.isArray(asked)) return bad("Choose who to send it to.");
    recipients = [...new Set(asked.filter((id): id is string => typeof id === "string"))];
    if (recipients.some((id) => !squadIds.has(id))) return bad("Someone on that list isn't in the squad.");
  }
  if (recipients.length === 0) {
    return bad(kind === "joining_fee" ? "There's nobody in the squad to ask for it yet." : "Choose who to send it to.");
  }

  // What each of them is asked for.
  const shares = new Map<string, number>();
  let perMember: number;
  if (kind === "match_fee") {
    if (Boolean(matchId) === Boolean(openMatchId)) return bad("A match fee belongs to one fixture.");
    if ((matchId && !UUID.test(matchId)) || (openMatchId && !UUID.test(openMatchId))) return bad("Unknown fixture.");
    const total = Number(text(form, "totalPence"));
    if (!Number.isInteger(total) || total <= 0) return bad("Missing the cost to share.");

    // The fixture has to be this team's.
    if (matchId) {
      const { data: m } = await adminSupabase.from("matches")
        .select("posting_team_id, challenging_team_id").eq("id", matchId).maybeSingle();
      if (!m || (m.posting_team_id !== teamId && m.challenging_team_id !== teamId)) return bad("That match isn't your team's.");
    } else {
      const { data: e } = await adminSupabase.from("open_match_teams")
        .select("team_id").eq("open_match_id", openMatchId!).eq("team_id", teamId).maybeSingle();
      if (!e) return bad("Your team isn't entered in that event.");
    }

    // Equal shares; the odd pennies go to the first few so the shares add up
    // to exactly the cost.
    const base = Math.floor(total / recipients.length);
    const extra = total - base * recipients.length;
    recipients.forEach((id, i) => shares.set(id, base + (i < extra ? 1 : 0)));
    perMember = base + (extra > 0 ? 1 : 0);
    const problem = amountProblem(perMember) ?? amountProblem(base);
    if (problem) return bad(problem);
  } else {
    perMember = Number(text(form, "amountPence"));
    const problem = amountProblem(perMember);
    if (problem) return bad(problem);
    recipients.forEach((id) => shares.set(id, perMember));
  }

  // The screenshot, if there is one.
  let imagePath: string | null = null;
  const file = form.get("image");
  if (file && typeof file !== "string" && file.size > 0) {
    const ext = IMAGE_TYPES[file.type];
    if (!ext) return bad("The screenshot has to be a JPEG, PNG or WebP image.");
    if (file.size > MAX_IMAGE_BYTES) return bad("The screenshot is over 5 MB.");
    imagePath = `${teamId}/${randomUUID()}.${ext}`;
    const { error: upErr } = await adminSupabase.storage.from("payment-requests")
      .upload(imagePath, Buffer.from(await file.arrayBuffer()), { contentType: file.type });
    if (upErr) {
      console.error("finance/requests: upload failed:", upErr.message);
      return bad("Couldn't save the screenshot. Try again, or send the request without it.", 500);
    }
  }

  // ── The joining fee: one standing request, changed in place ──────────
  if (kind === "joining_fee") {
    const { data: existing } = await adminSupabase.from("payment_requests")
      .select("id, amount_pence").eq("team_id", teamId).eq("kind", "joining_fee")
      .is("cancelled_at", null).maybeSingle();

    if (existing) {
      const update: Record<string, unknown> = { title, description, amount_pence: perMember, due_date: dueDate };
      if (imagePath) update.image_path = imagePath;
      const { error: updErr, included } = await withOptionalColumn("captain_exempt", (withExempt) =>
        adminSupabase.from("payment_requests")
          .update(withExempt ? { ...update, captain_exempt: captainExempt } : update)
          .eq("id", existing.id));
      if (updErr) return bad("Couldn't save the joining fee.", 500);
      if (captainExempt && !included) return bad(EXEMPT_NEEDS_MIGRATION, 500);

      // The fee is the team's CURRENT fee: everyone moves onto it. Only what
      // is asked moves — what somebody has paid is money already in, so a
      // raise leaves the difference owed and a cut settles them.
      let moveAll = adminSupabase.from("payment_request_members")
        .update({ amount_pence: perMember }).eq("request_id", existing.id);
      if (captainExempt) moveAll = moveAll.neq("player_id", captainId!);
      await moveAll;

      // Newly exempt: the captain comes off the request. Anything they had
      // already paid stays paid — their row is kept, asking exactly that, so
      // the money still shows and nothing is refunded.
      if (captainExempt) {
        const { data: own } = await adminSupabase.from("payment_request_members")
          .select("id, paid_pence").eq("request_id", existing.id).eq("player_id", captainId!).maybeSingle();
        if (own && (own.paid_pence as number) > 0) {
          await adminSupabase.from("payment_request_members")
            .update({ amount_pence: own.paid_pence }).eq("id", own.id);
        } else if (own) {
          await adminSupabase.from("payment_request_members").delete().eq("id", own.id);
        }
      }
      await adminSupabase.from("payment_request_members").upsert(
        recipients.map((id) => ({ request_id: existing.id, team_id: teamId, player_id: id, amount_pence: perMember })),
        { onConflict: "request_id,player_id", ignoreDuplicates: true },
      );

      if (perMember > (existing.amount_pence as number)) {
        await sendFinanceMessages(callerId, recipients.map((id) => ({
          receiverId: id,
          body: `The team's joining fee is now ${pounds(perMember)}. Pay what you still owe in Team finance.`,
        })));
      }
      return NextResponse.json({ requestId: existing.id });
    }
  }

  const row: Record<string, unknown> = {
    team_id: teamId,
    kind,
    title,
    description,
    image_path: imagePath,
    amount_pence: perMember,
    due_date: dueDate,
    match_id: matchId,
    open_match_id: openMatchId,
    created_by: callerId,
  };
  // Only an exemption needs the column, so a database without it still takes
  // every other request.
  const { data: created, error: insErr, included } = await withOptionalColumn<{ id: string }>("captain_exempt", (withExempt) =>
    adminSupabase.from("payment_requests")
      .insert(withExempt && captainExempt ? { ...row, captain_exempt: true } : row)
      .select("id").single());
  if (created && captainExempt && !included) {
    await adminSupabase.from("payment_requests").delete().eq("id", created.id);
    return bad(EXEMPT_NEEDS_MIGRATION, 500);
  }

  if (insErr || !created) {
    // The unique indexes: one joining fee per team, one request per fixture.
    if (insErr?.code === "23505") return bad("A payment request for that has already been sent.", 409);
    console.error("finance/requests: insert failed:", insErr?.message);
    return bad("Couldn't create the request.", 500);
  }

  const { error: memErr } = await adminSupabase.from("payment_request_members").insert(
    recipients.map((id) => ({
      request_id: created.id, team_id: teamId, player_id: id, amount_pence: shares.get(id)!,
    })),
  );
  if (memErr) {
    // A request nobody is on would sit in the dashboard asking no one.
    await adminSupabase.from("payment_requests").delete().eq("id", created.id);
    console.error("finance/requests: members insert failed:", memErr.message);
    return bad("Couldn't create the request.", 500);
  }

  await sendFinanceMessages(callerId, recipients.map((id) => ({
    receiverId: id,
    body: `New payment request: ${title} — ${pounds(shares.get(id)!)}`
      + `${dueDate ? `, due ${dueDate}` : ""}. Pay it in Team finance.`,
  })));

  return NextResponse.json({ requestId: created.id });
}
