// Fixture dates come in two shapes. Newer rows store ISO "2026-07-30", but
// older ones store the display string the picker produced — "Wed, 03 JUN 2026"
// (see match_posts / matches). Comparing those two shapes as raw strings is
// what put played June fixtures in Upcoming: "W" > "2", so every legacy row
// sorted as if it were in the future, forever.
//
// Everything that splits or sorts fixtures should key off toDateKey().

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

// Normalise any stored fixture date to a sortable ISO "YYYY-MM-DD".
// Unparseable input returns "" so it sorts as past rather than pinning
// itself to the top of Upcoming.
export function toDateKey(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // "Wed, 03 JUN 2026" / "3 Jun 2026" — day, month name, year, any case.
  const m = trimmed.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toUpperCase()];
    if (mo !== undefined) {
      return `${m[3]}-${String(mo + 1).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
    }
  }
  return "";
}

// Today in the viewer's LOCAL timezone. toISOString() would give the UTC date,
// which is a day off for most of the evening in UTC+ zones — enough to leave a
// finished fixture sitting in Upcoming.
export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// A fixture is upcoming until the end of its match day.
export function isUpcomingDate(raw: string | null | undefined): boolean {
  const key = toDateKey(raw);
  return key !== "" && key >= todayKey();
}

// Sort key that keeps same-day fixtures in kick-off order.
export function sortKey(raw: string | null | undefined, time?: string | null): string {
  return `${toDateKey(raw)} ${(time ?? "").padStart(5, "0")}`;
}

// Has kickoff already passed? Compares the stored naive "YYYY-MM-DD" + "HH:mm"
// against now as Europe/London wall-clock strings, so the answer never depends
// on the viewer's device timezone — a phone set to Korea time would otherwise
// read a UK kickoff ~9h early and hide matches that haven't started.
export function isKickoffPast(rawDate: string, time: string): boolean {
  const key = toDateKey(rawDate);
  if (!key) return false;
  const kickoff = `${key} ${(time ?? "").padStart(5, "0")}:00`;
  return kickoff < new Date().toLocaleString("sv-SE", { timeZone: "Europe/London" });
}

// "Sat, 13 Jun · 16:00" from either stored date shape.
export function fmtKickoff(rawDate: string, time: string): string {
  const key = toDateKey(rawDate);
  if (!key) return `${rawDate} · ${time}`;
  const d = new Date(`${key}T12:00:00`);
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · ${time}`;
}
