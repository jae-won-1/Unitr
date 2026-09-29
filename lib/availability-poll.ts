// The team's live availability poll and this player's answer to it.
//
// Extracted out of components/AvailabilityModal.tsx so the mobile app can share
// it — same move as lib/dues.ts and lib/game-feed.ts. The hook was always pure
// data (two Supabase reads, no JSX and no DOM); AvailabilityModal re-exports it
// so nothing importing from there had to change.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { authedDelete } from "@/lib/authed-fetch";
import { actingCaptainId } from "@/lib/team-leadership";

export type DateOption = {
  id: string;
  date: string;
  time: string;
  day: string;
  month: string;
  dayName: string;
  location?: string;
};

export type PollRequest = { id: string; date_options: DateOption[] };
type Request = PollRequest;

// Latest poll for the team, plus whether this player has already answered.
// An empty available_date_ids is a real answer meaning "none of these" — it has
// to be distinguished from "hasn't replied", hence null vs [].
export function useAvailabilityPoll(teamId: string | null, userId: string | undefined) {
  const [request, setRequest] = useState<Request | null>(null);
  const [myAnswer, setMyAnswer] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!teamId || !userId) { setLoading(false); return; }
    const { data: req } = await supabase
      .from("availability_requests")
      .select("id, date_options")
      .eq("team_id", teamId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!req) { setRequest(null); setMyAnswer(null); setLoading(false); return; }

    const { data: mine } = await supabase
      .from("availability_responses")
      .select("available_date_ids")
      .eq("request_id", req.id)
      .eq("player_id", userId)
      .maybeSingle();

    setRequest(req as Request);
    setMyAnswer(mine ? (mine.available_date_ids as string[]) : null);
    setLoading(false);
  }, [teamId, userId]);

  useEffect(() => { load(); }, [load]);

  return { request, myAnswer, loading, reload: load };
}

// ── Creating and closing a poll ───────────────────────────────────────
// Moved here from components/AvailabilityPollForm.tsx so the mobile app
// creates polls through the same code. The rule that makes one implementation
// matter: a team has exactly one live poll, so posting a new one deletes the
// previous request (and its responses) first. Two copies of that would
// eventually drift into two live polls.

const MONTH_NAMES = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

// An option id only has to be unique within its poll. Browsers have
// crypto.randomUUID; React Native's Hermes engine doesn't, so a phone falls
// back to a random v4-shaped id.
function optionId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function parseDateOption(dateStr: string, timeStr: string, location?: string): DateOption {
  const d = new Date(dateStr + "T" + timeStr);
  const day = String(d.getDate()).padStart(2, "0");
  const month = MONTH_NAMES[d.getMonth()];
  const dayName = DAY_NAMES[d.getDay()];
  const display = `${dayName.slice(0, 3)}, ${day} ${month} ${d.getFullYear()}`;
  const loc = location?.trim();
  return { id: optionId(), date: display, time: timeStr, day, month, dayName, ...(loc ? { location: loc } : {}) };
}

export type PollRow = { date: string; time: string; location?: string };

/** Replace the team's live poll with one proposing `rows` (ISO date + HH:MM). */
export async function createAvailabilityPoll(
  teamId: string,
  captainId: string,
  rows: PollRow[],
): Promise<{ error: string | null }> {
  const { data: existing } = await supabase
    .from("availability_requests").select("id").eq("team_id", teamId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existing) {
    await authedDelete("/api/availability/delete", { requestId: existing.id });
  }

  const date_options = rows.map((r) => parseDateOption(r.date, r.time, r.location));
  // A co-captain opens polls too. The row is filed under the team's captain
  // so every squad member's "is there a poll for my team?" still matches,
  // whoever pressed Send.
  const { error: insertError } = await supabase
    .from("availability_requests")
    .insert({
      team_id: teamId,
      captain_id: await actingCaptainId(captainId, teamId),
      date_options,
    });
  return { error: insertError?.message ?? null };
}

/** Close a poll: the request and every answer on it (server-side, leader-checked). */
export async function deleteAvailabilityPoll(requestId: string): Promise<void> {
  await authedDelete("/api/availability/delete", { requestId });
}
