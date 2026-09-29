// Dues and joining-fee bookkeeping: what a player owes their team, and the
// client-side half of recording a payment against it.
//
// Extracted out of components/DuesTopUpModal.tsx so the mobile app can share
// it — same move as lib/game-feed.ts and lib/ringer-feed.ts. Both pieces were
// always pure data (Supabase queries and updates, no JSX and no DOM), so this
// is a lift, not a rewrite, and DuesTopUpModal.tsx re-exports them so nothing
// importing from there had to change. The card entry (Stripe Elements) stays
// in the component: it is web-only.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type MyDue = {
  pcsId: string;
  matchId: string;
  kind: "match" | "tournament";
  opponent: string;
  date: string;
  remainingPence: number;
  sharePence: number;
};

export type SavedCard = { customerId: string; paymentMethodId: string; last4: string | null };

// Apply a completed payment toward a single targeted due (targetPcsId) or the
// player's own outstanding fees, oldest-game-first.
//
// This is the bookkeeping half ONLY. The team's credit is added server-side —
// by the Stripe webhook for manual card entry, or by /api/settle-match for a
// saved card — because the browser cannot prove a payment happened.
export async function applyTopUp(
  userId: string,
  amountPence: number,
  targetPcsId?: string
): Promise<void> {
  if (targetPcsId) {
    const { data: row } = await supabase.from("payment_collection_status")
      .select("share_pence").eq("id", targetPcsId).maybeSingle();
    await supabase.from("payment_collection_status").update({
      credited_pence: row?.share_pence ?? amountPence,
      received: true,
      updated_at: new Date().toISOString(),
    }).eq("id", targetPcsId);
    return;
  }

  let remaining = amountPence;
  const { data: dueRowsRaw } = await supabase.from("payment_collection_status")
    .select("id, match_id, share_pence, credited_pence").eq("player_id", userId).eq("included", true);
  const dueMatchIds = [...new Set((dueRowsRaw ?? []).map((r) => r.match_id))];
  const { data: dueMatches } = dueMatchIds.length > 0
    ? await supabase.from("matches").select("id, match_date").in("id", dueMatchIds)
    : { data: [] as { id: string; match_date: string }[] };
  const matchDateById = new Map((dueMatches ?? []).map((m) => [m.id, m.match_date as string]));
  const dueRows = [...(dueRowsRaw ?? [])].sort((a, b) =>
    (matchDateById.get(a.match_id) ?? "").localeCompare(matchDateById.get(b.match_id) ?? "")
  );
  for (const row of dueRows) {
    if (remaining <= 0) break;
    const need = row.share_pence - (row.credited_pence ?? 0);
    if (need <= 0) continue;
    const applied = Math.min(remaining, need);
    const newCredited = (row.credited_pence ?? 0) + applied;
    await supabase.from("payment_collection_status").update({
      credited_pence: newCredited,
      received: newCredited >= row.share_pence,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    remaining -= applied;
  }
}

// ── Dues data ─────────────────────────────────────────────────
// A charge targets either a match or a tournament entry, so each set of labels
// is resolved from its own table rather than assuming match_id is present.
export function useMyDues(teamId: string | null, userId: string) {
  const [dues, setDues] = useState<MyDue[]>([]);
  const [owedPence, setOwedPence] = useState(0);

  const reload = useCallback(async () => {
    if (!teamId) return;
    const { data: rows } = await supabase.from("payment_collection_status")
      .select("id, match_id, open_match_id, share_pence, credited_pence")
      .eq("player_id", userId).eq("included", true).eq("received", false);
    const pending = (rows ?? [])
      .map((r) => ({ ...r, remaining: r.share_pence - (r.credited_pence ?? 0) }))
      .filter((r) => r.remaining > 0);
    if (pending.length === 0) { setDues([]); setOwedPence(0); return; }

    const matchIds = [...new Set(pending.map((r) => r.match_id).filter(Boolean))] as string[];
    const omIds = [...new Set(pending.map((r) => r.open_match_id).filter(Boolean))] as string[];
    const [{ data: ms }, { data: oms }] = await Promise.all([
      matchIds.length
        ? supabase.from("matches").select("id, posting_team_id, challenging_team_id, match_date").in("id", matchIds)
        : Promise.resolve({ data: [] as { id: string; posting_team_id: string; challenging_team_id: string; match_date: string }[] }),
      omIds.length
        ? supabase.from("open_matches").select("id, title, match_date").in("id", omIds)
        : Promise.resolve({ data: [] as { id: string; title: string; match_date: string }[] }),
    ]);
    const matchById = new Map((ms ?? []).map((m) => [m.id, m]));
    const omById = new Map((oms ?? []).map((o) => [o.id, o]));
    const oppIds = [...new Set((ms ?? []).map((m) => (m.posting_team_id === teamId ? m.challenging_team_id : m.posting_team_id)))];
    const { data: teamsData } = oppIds.length
      ? await supabase.from("teams").select("id, name").in("id", oppIds)
      : { data: [] as { id: string; name: string }[] };
    const teamName = new Map((teamsData ?? []).map((t) => [t.id, t.name as string]));

    const mapped: MyDue[] = pending.map((r) => {
      if (r.open_match_id) {
        const t = omById.get(r.open_match_id);
        return {
          pcsId: r.id, matchId: r.open_match_id, kind: "tournament" as const,
          opponent: t?.title || "Tournament", date: t?.match_date ?? "",
          remainingPence: r.remaining, sharePence: r.share_pence,
        };
      }
      const m = matchById.get(r.match_id);
      const oppId = m ? (m.posting_team_id === teamId ? m.challenging_team_id : m.posting_team_id) : null;
      return {
        pcsId: r.id, matchId: r.match_id, kind: "match" as const,
        opponent: oppId ? (teamName.get(oppId) ?? "Opponent") : "Opponent",
        date: m?.match_date ?? "",
        remainingPence: r.remaining, sharePence: r.share_pence,
      };
    }).sort((a, b) => a.date.localeCompare(b.date));

    setDues(mapped);
    setOwedPence(mapped.reduce((sum, d) => sum + d.remainingPence, 0));
  }, [teamId, userId]);

  useEffect(() => { reload(); }, [reload]);

  return { dues, owedPence, reload };
}
