import type { SupabaseClient } from "@supabase/supabase-js";

// One pitch's day, hour by hour — the grid Book a Pitch shows and the test
// /api/book/pitch runs before it writes a booking. Shared so the screen and
// the server can't disagree about whether an hour is free.
//
// Reads the venue portal's own tables: weekly opening hours
// (pitch_availability), bookings, and ad-hoc blocks (pitch_blocks). A table
// that doesn't exist on this database reads as empty, which is what a pitch
// with no rules means anyway: open 07:00–22:00, free unless booked.

export type DaySlotStatus = "available" | "booked" | "closed";
export type DaySlot = { time: string; status: DaySlotStatus };

// Display window for the day grid (matches the venue portal's default hours).
export const BOOKING_HOURS = Array.from({ length: 16 }, (_, i) => `${String(i + 7).padStart(2, "0")}:00`); // 07:00–22:00
const DEFAULT_OPEN = 7;
const DEFAULT_CLOSE = 22;

// A booking is one hour, ending no later than 23:00.
export function bookingEndTime(time: string): string {
  return `${String(Math.min(Number(time.split(":")[0]) + 1, 23)).padStart(2, "0")}:00`;
}

export function dayNameOf(iso: string): string {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(iso + "T12:00:00").getDay()];
}

const toMins = (t: string) => {
  const [hh, mm] = t.split(":");
  return Number(hh) * 60 + (Number(mm) || 0);
};

export async function loadPitchDay(
  client: SupabaseClient,
  pitchIds: string[],
  date: string,
): Promise<Record<string, DaySlot[]>> {
  if (pitchIds.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return {};
  const dayOfWeek = new Date(date + "T12:00:00").getDay();

  const [{ data: avails }, { data: bookings }, { data: blocks }] = await Promise.all([
    client.from("pitch_availability")
      .select("pitch_id, open_time, close_time, is_active")
      .in("pitch_id", pitchIds).eq("day_of_week", dayOfWeek),
    client.from("pitch_bookings")
      .select("pitch_id, start_time, end_time").in("pitch_id", pitchIds).eq("match_date", date).neq("status", "cancelled"),
    client.from("pitch_blocks")
      .select("pitch_id, start_time, end_time").in("pitch_id", pitchIds).eq("block_date", date),
  ]);

  const map: Record<string, DaySlot[]> = {};
  for (const pitchId of pitchIds) {
    const avail = avails?.find((a) => a.pitch_id === pitchId);
    // No availability row → the venue portal's default open hours.
    if (avail && !avail.is_active) {
      map[pitchId] = BOOKING_HOURS.map((t) => ({ time: t, status: "closed" as DaySlotStatus }));
      continue;
    }
    const oh = avail ? Number(String(avail.open_time).split(":")[0]) : DEFAULT_OPEN;
    const ch = avail ? Number(String(avail.close_time).split(":")[0]) : DEFAULT_CLOSE;

    // An hourly slot H (H:00–H+1:00) is taken if any booking or block overlaps
    // it — so a part-hour booking like 18:30–19:30 blocks both 18:00 and 19:00.
    const taken = new Set<string>();
    const pitchBookings = (bookings ?? []).filter((b) => b.pitch_id === pitchId);
    const pitchBlocks = (blocks ?? []).filter((b) => b.pitch_id === pitchId);
    const wholeDayBlocked = pitchBlocks.some((b) => !b.start_time);
    for (const b of [...pitchBookings, ...pitchBlocks]) {
      if (!b.start_time) continue;
      const startMins = toMins(b.start_time);
      const endMins = b.end_time ? toMins(b.end_time) : startMins + 60;
      const firstHour = Math.floor(startMins / 60);
      const lastHour = Math.ceil(endMins / 60); // exclusive
      for (let h = firstHour; h < lastHour; h++) taken.add(`${String(h).padStart(2, "0")}:00`);
    }

    map[pitchId] = BOOKING_HOURS.map((t) => {
      const h = Number(t.split(":")[0]);
      if (wholeDayBlocked || h < oh || h >= ch) return { time: t, status: "closed" as DaySlotStatus };
      if (taken.has(t)) return { time: t, status: "booked" as DaySlotStatus };
      return { time: t, status: "available" as DaySlotStatus };
    });
  }
  return map;
}
