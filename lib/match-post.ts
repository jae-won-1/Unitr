// Turning a captain's dates and pitch options into match_posts rows, and
// checking which pitches are free at those slots — shared by the web's
// /play/create (+ /pitches select mode) and the mobile app's Post a Match.
//
// The rows rule, lifted unchanged from app/play/create/page.tsx: for each
// date, the pitches kept at that date's time are bundled into ONE post (ranked
// options the opponent picks from); any pitch given an alternative time for
// that date becomes its own standalone post. Every post is filed under the
// TEAM'S captain, even when a co-captain posts it, so "my team's posts"
// queries keep finding it. No money moves at post time: hold_pence 0, mode
// "individual" (the fee is split between both teams when one accepts).

import type { SupabaseClient } from "@supabase/supabase-js";

export type PostPitchOption = {
  id: string;
  name: string;
  address: string;
  price: number;
  format: string;
  distance: string;
  /** Per-date kick-off overrides for this pitch (ISO date → "HH:MM"). */
  slotTimes?: Record<string, string>;
};

export type PostDate = { date: string; time: string; dayName: string };

export type PostingTeam = { id: string; name: string; location: string | null; captain_id: string | null };

export function buildMatchPostRows(
  team: PostingTeam,
  userId: string,
  dates: PostDate[],
  pitchOptions: PostPitchOption[],
  description: string,
): Record<string, unknown>[] {
  const base = {
    team_id: team.id,
    captain_id: team.captain_id ?? userId,
    team_name: team.name,
    team_location: team.location ?? "",
    description,
    status: "open",
    payment_mode: "individual",
    hold_pence: 0,
  };
  const rows: Record<string, unknown>[] = [];
  for (const d of dates) {
    const withTimes = pitchOptions.map(({ slotTimes, ...p }) => ({ ...p, time: slotTimes?.[d.date] ?? d.time }));
    const original = withTimes.filter((p) => p.time === d.time);
    const alternatives = withTimes.filter((p) => p.time !== d.time);
    if (original.length > 0) {
      rows.push({ ...base, match_date: d.date, match_time: d.time, day_name: d.dayName, pitch_options: original });
    }
    for (const p of alternatives) {
      rows.push({ ...base, match_date: d.date, match_time: p.time, day_name: d.dayName, pitch_options: [p] });
    }
  }
  return rows;
}

// ── Is a pitch free at a slot? ──────────────────────────────────────────

export type SlotStatus = "available" | "booked" | "closed";

const DAY_INDEX: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
};

/**
 * For each pitch, the status of each slot (same order as `slots`): closed when
 * the venue's weekly hours rule it out, booked when a live booking covers the
 * kick-off, otherwise available. The same test /pitches runs in select mode.
 */
export async function loadPitchSlotStatus(
  client: SupabaseClient,
  pitchIds: string[],
  slots: PostDate[],
): Promise<Record<string, SlotStatus[]>> {
  if (pitchIds.length === 0 || slots.length === 0) return {};
  const days = Array.from(new Set(slots.map((s) => DAY_INDEX[s.dayName]).filter((d) => d !== undefined)));
  const dates = Array.from(new Set(slots.map((s) => s.date)));
  const [{ data: avails }, { data: bookings }] = await Promise.all([
    client.from("pitch_availability").select("pitch_id, day_of_week, open_time, close_time, is_active")
      .in("pitch_id", pitchIds).in("day_of_week", days),
    client.from("pitch_bookings").select("pitch_id, match_date, start_time, end_time")
      .in("pitch_id", pitchIds).in("match_date", dates).neq("status", "cancelled"),
  ]);
  const map: Record<string, SlotStatus[]> = {};
  for (const id of pitchIds) {
    map[id] = slots.map((slot) => {
      const avail = avails?.find((a) => a.pitch_id === id && a.day_of_week === DAY_INDEX[slot.dayName]);
      if (avail && !avail.is_active) return "closed";
      if (avail && (slot.time < avail.open_time || slot.time >= avail.close_time)) return "closed";
      const booked = bookings?.some((b) =>
        b.pitch_id === id && b.match_date === slot.date &&
        (b.end_time ? b.start_time <= slot.time && slot.time < b.end_time : b.start_time === slot.time));
      return booked ? "booked" : "available";
    });
  }
  return map;
}
