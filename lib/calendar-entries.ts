import { supabase } from "@/lib/supabase";
import { loadTournamentFixtures } from "@/lib/tournament-fixtures";
import { isUpcomingDate, sortKey, toDateKey } from "@/lib/match-dates";
import { loadFixtureResults, resultKey, type FixtureResult } from "@/lib/match-results";
import { loadLeadership } from "@/lib/team-leadership";

// Everything the viewer is committed to, from every table that can commit them,
// flattened into one shape.
//
// Five things count as a commitment and they live in five different places:
// a confirmed friendly (match_posts + challenges + matches), a tournament
// (open_matches), the captain's own post still waiting for a taker
// (match_posts), a game they bought into as a guest (ringer_signups), and a
// pitch they booked outright (pitch_bookings). Only the Calendar needs all five
// at once, so the merge lives here rather than in the page.
//
// Dates are normalised through toDateKey() without exception. Older rows store
// the display string the picker produced — "Wed, 03 JUN 2026" — which compares
// greater than any ISO date, so raw sorting pins every legacy fixture to the top
// of Upcoming forever (see lib/match-dates.ts).

export type EntryKind = "friendly" | "tournament" | "my_post" | "ringer" | "booking";

export type CalendarEntry = {
  /** Stable React key. Ids can collide across kinds — a post id and its match id. */
  key: string;
  kind: EntryKind;
  id: string;
  title: string;
  subtitle: string | null;
  date: string;                 // ISO "YYYY-MM-DD"
  time: string;
  pitch: string | null;
  address: string | null;
  pricePence: number | null;
  badge: string | null;
  /** matches.id — present only for a confirmed friendly. Gates "Manage match". */
  matchId: string | null;
  /** open_matches.id — present only for a tournament the team actually entered.
   *  The other half of the availability answer: a tournament has no matches row,
   *  so its confirmations hang off this instead (lib/event-availability.ts). */
  openMatchId: string | null;
  /** Written back after a booking is turned into a post, to flip the CTA. */
  postId: string | null;
  resultVerified: boolean;
  /** The submitted score from the viewer's side, once a captain has filed one.
   *  Null for anything with no result, and for kinds that can't have one. */
  result: FixtureResult | null;
  isUpcoming: boolean;
};

export type CalendarData = {
  entries: CalendarEntry[];
  teamId: string | null;
  isCaptain: boolean;
};

export const KIND_LABEL: Record<EntryKind, string> = {
  friendly: "Friendly",
  tournament: "Tournament",
  my_post: "Your post",
  ringer: "Ringer",
  booking: "Pitch booking",
};

// Tailwind can't see interpolated class names, so each kind names its classes in
// full. Text/border/dot are picked apart by the card, the sheet and the grid.
// Rebrand tints. Each kind is a solid hue for the card's left rule and the
// month-grid dot, plus a pale fill/border pair for its badge — the design gives
// these as literal values rather than palette steps, so they're arbitrary
// classes. `dot` doubles as the left rule, hence border-l-* uses the same hue.
// Rebrand tints. `rule` is the solid hue for the card's 4px left edge; `border`
// is the pale badge outline that pairs with `bg` — in the old dark palette both
// were the same translucent colour, but the design separates them, so a card now
// carries a saturated edge above a soft badge. `dot` is the month-grid marker.
export const KIND_STYLE: Record<EntryKind, { text: string; border: string; bg: string; dot: string; rule: string }> = {
  friendly:   { text: "text-accent-ink",  border: "border-[#B7E8C6]",  bg: "bg-[#E7F8EC]",  dot: "bg-accent",     rule: "border-l-accent" },
  tournament: { text: "text-[#B07400]",   border: "border-[#F5DCA6]",  bg: "bg-[#FFF6E3]",  dot: "bg-[#F0A500]",  rule: "border-l-[#F0A500]" },
  my_post:    { text: "text-indigo-700",  border: "border-indigo-200", bg: "bg-indigo-50",  dot: "bg-indigo-500", rule: "border-l-indigo-500" },
  ringer:     { text: "text-orange-700",  border: "border-orange-200", bg: "bg-orange-50",  dot: "bg-orange-500", rule: "border-l-orange-500" },
  booking:    { text: "text-accent-2",    border: "border-[#C6D4FF]",  bg: "bg-[#EAF0FF]",  dot: "bg-accent-2",   rule: "border-l-accent-2" },
};

/** Upcoming soonest-first, then past most-recent-first. */
export function compareEntries(a: CalendarEntry, b: CalendarEntry): number {
  if (a.isUpcoming !== b.isUpcoming) return a.isUpcoming ? -1 : 1;
  const ka = sortKey(a.date, a.time);
  const kb = sortKey(b.date, b.time);
  return a.isUpcoming ? ka.localeCompare(kb) : kb.localeCompare(ka);
}

function base(date: string, time: string) {
  return { date: toDateKey(date), time: time ?? "", isUpcoming: isUpcomingDate(date) };
}

// ── Confirmed friendlies ──────────────────────────────────────────────
// Two sides of the same fixture: posts this captain made that got challenged,
// and challenges they sent that were accepted. The `matches` row is what the
// manage screen keys off, so both sides resolve post_id → matches.id.
async function loadFriendlies(captainId: string, teamId: string | null): Promise<CalendarEntry[]> {
  const [{ data: myPosts }, { data: myChallenges }] = await Promise.all([
    supabase.from("match_posts")
      .select("id, match_date, match_time").eq("captain_id", captainId).eq("status", "matched"),
    supabase.from("challenges")
      .select("post_id, selected_pitch").eq("challenger_captain_id", captainId).eq("status", "accepted"),
  ]);

  type Draft = { postId: string; opponent: string; date: string; time: string; pitch: string; address: string | null; side: "poster" | "challenger" };
  const drafts: Draft[] = [];

  for (const post of myPosts ?? []) {
    const { data: ch } = await supabase.from("challenges")
      .select("challenger_team_name, selected_pitch").eq("post_id", post.id).eq("status", "accepted").maybeSingle();
    const pitch = (ch as { selected_pitch?: { name?: string; address?: string } } | null)?.selected_pitch;
    drafts.push({
      postId: post.id,
      opponent: (ch as { challenger_team_name?: string } | null)?.challenger_team_name ?? "Opponent",
      date: post.match_date,
      time: post.match_time,
      pitch: pitch?.name ?? "TBC",
      address: pitch?.address ?? null,
      side: "poster",
    });
  }

  for (const c of myChallenges ?? []) {
    const { data: post } = await supabase.from("match_posts")
      .select("team_name, match_date, match_time").eq("id", c.post_id).maybeSingle();
    if (!post) continue;
    const pitch = c.selected_pitch as { name?: string; address?: string } | null;
    drafts.push({
      postId: c.post_id,
      opponent: (post as { team_name?: string }).team_name ?? "Opponent",
      date: (post as { match_date: string }).match_date,
      time: (post as { match_time: string }).match_time,
      pitch: pitch?.name ?? "TBC",
      address: pitch?.address ?? null,
      side: "challenger",
    });
  }

  if (drafts.length === 0) return [];

  const { data: rows } = await supabase.from("matches")
    .select("id, post_id, confirmed_pitch, result_verified")
    .in("post_id", drafts.map((d) => d.postId));
  const matchByPost = new Map((rows ?? []).map((r) => [r.post_id as string, r]));

  // The score this team filed, if it filed one. Read from the team's own
  // match_results row, so it is already the right way round for the viewer.
  const results = teamId
    ? await loadFixtureResults((rows ?? []).map((r) => ({
        matchId: r.id as string, teamId, verified: Boolean(r.result_verified),
      })))
    : new Map<string, FixtureResult>();

  return drafts.map((d) => {
    const m = matchByPost.get(d.postId);
    const price = (m?.confirmed_pitch as { price?: number } | null)?.price;
    return {
      key: `friendly:${d.postId}`,
      kind: "friendly" as const,
      id: d.postId,
      title: `vs ${d.opponent}`,
      subtitle: d.side === "poster" ? "You posted · they challenged" : "You challenged",
      pitch: d.pitch,
      address: d.address,
      pricePence: price != null ? Math.round(price * 100) : null,
      badge: "Confirmed",
      matchId: (m?.id as string) ?? null,
      openMatchId: null,
      postId: d.postId,
      resultVerified: Boolean(m?.result_verified),
      result: m && teamId ? results.get(resultKey(m.id as string, teamId)) ?? null : null,
      ...base(d.date, d.time),
    };
  });
}

// ── Tournaments the team entered or hosted ────────────────────────────
async function loadTournaments(teamId: string | null): Promise<CalendarEntry[]> {
  const rows = await loadTournamentFixtures(teamId, { includePast: true });
  return rows.map((t) => ({
    key: `tournament:${t.id}`,
    kind: "tournament" as const,
    id: t.id,
    title: t.title || "Tournament",
    subtitle: [t.format, t.hosting ? "Hosted by your team" : "Your team entered"].filter(Boolean).join(" · "),
    pitch: t.pitch,
    address: t.address,
    pricePence: null,
    badge: t.hosting ? "Hosting" : "Entered",
    matchId: null,
    // Hosting a tournament isn't fielding a team in it — an organiser buys in
    // separately — so only an entered one asks the squad for availability.
    openMatchId: t.entered ? t.id : null,
    postId: null,
    resultVerified: false,
    result: null,
    ...base(t.date, t.time),
  }));
}

// ── The captain's own posts, still waiting for a taker ────────────────
// Unlike useMyPosts (components/MyPostCard.tsx) this keeps expired posts: a post
// nobody challenged is still a thing that happened, and the Calendar files it
// under Past rather than hiding it.
async function loadMyPosts(captainId: string): Promise<CalendarEntry[]> {
  const { data } = await supabase.from("match_posts")
    .select("id, match_date, match_time, pitch_options, description, pitch_secured")
    .eq("captain_id", captainId).eq("status", "open");

  return (data ?? []).map((r) => {
    const options = (r.pitch_options ?? []) as { name?: string; address?: string; price?: number }[];
    const first = options[0];
    return {
      key: `my_post:${r.id}`,
      kind: "my_post" as const,
      id: r.id,
      title: "Your match post",
      subtitle: r.description || (options.length > 1 ? `${options.length} pitch options` : null),
      pitch: first?.name ?? null,
      address: first?.address ?? null,
      pricePence: first?.price != null ? Math.round(first.price * 100) : null,
      badge: isUpcomingDate(r.match_date)
        ? (r.pitch_secured ? "Pitch secured · awaiting opponent" : "Awaiting opponent")
        : "Expired",
      matchId: null,
      openMatchId: null,
      postId: r.id,
      resultVerified: false,
      result: null,
      ...base(r.match_date, r.match_time),
    };
  });
}

// ── Games the viewer paid into as a guest ─────────────────────────────
// ringer_signups arrives with supabase_ringers.sql. Selecting from a table that
// doesn't exist fails the whole query, so a missing migration yields no ringer
// rows rather than an empty Calendar.
async function loadRingerGames(userId: string): Promise<CalendarEntry[]> {
  const { data: signups, error } = await supabase.from("ringer_signups")
    .select("id, match_id, team_id, position, amount_pence").eq("player_id", userId);
  if (error || !signups || signups.length === 0) return [];

  const { data: matches } = await supabase.from("matches")
    .select("id, posting_team_id, challenging_team_id, match_date, match_time, confirmed_pitch, result_verified")
    .in("id", signups.map((s) => s.match_id));
  const matchById = new Map((matches ?? []).map((m) => [m.id as string, m]));

  const teamIds = [...new Set((matches ?? []).flatMap((m) => [m.posting_team_id, m.challenging_team_id]).filter(Boolean))];
  const { data: teams } = teamIds.length
    ? await supabase.from("teams").select("id, name").in("id", teamIds)
    : { data: [] as { id: string; name: string }[] };
  const teamName = new Map((teams ?? []).map((t) => [t.id as string, t.name as string]));

  // A ringer reads the score from the side they guested for, not from whichever
  // team happened to post the fixture.
  const results = await loadFixtureResults(signups
    .filter((s) => matchById.has(s.match_id))
    .map((s) => ({
      matchId: s.match_id as string,
      teamId: s.team_id as string,
      verified: Boolean(matchById.get(s.match_id)?.result_verified),
    })));

  const out: CalendarEntry[] = [];
  for (const s of signups) {
    const m = matchById.get(s.match_id);
    if (!m) continue;
    const opponentId = s.team_id === m.posting_team_id ? m.challenging_team_id : m.posting_team_id;
    const pitch = m.confirmed_pitch as { name?: string; address?: string } | null;
    out.push({
      key: `ringer:${s.id}`,
      kind: "ringer",
      id: s.match_id,
      title: `${teamName.get(s.team_id) ?? "Team"} vs ${teamName.get(opponentId) ?? "Opponent"}`,
      subtitle: s.position ? `Guesting at ${s.position}` : "Guesting",
      pitch: pitch?.name ?? "TBC",
      address: pitch?.address ?? null,
      pricePence: s.amount_pence ?? null,
      badge: "Paid ✓",
      matchId: s.match_id,
      openMatchId: null,
      postId: null,
      resultVerified: Boolean(m.result_verified),
      result: results.get(resultKey(s.match_id, s.team_id)) ?? null,
      ...base(m.match_date, m.match_time),
    });
  }
  return out;
}

// ── Pitches booked directly ───────────────────────────────────────────
async function loadBookings(userId: string): Promise<CalendarEntry[]> {
  const { data: rows } = await supabase.from("pitch_bookings")
    .select("id, pitch_id, match_date, start_time, end_time, total_price_pence, payment_status, status, post_id")
    .eq("booked_by", userId).eq("booking_type", "platform");
  if (!rows || rows.length === 0) return [];

  const pitchIds = [...new Set(rows.map((r) => r.pitch_id))];
  const { data: pitches } = pitchIds.length
    ? await supabase.from("pitches").select("id, name, address").in("id", pitchIds)
    : { data: [] as { id: string; name: string; address: string }[] };
  const pitchById = new Map((pitches ?? []).map((p) => [p.id as string, p]));

  return rows.map((r) => {
    const p = pitchById.get(r.pitch_id);
    return {
      key: `booking:${r.id}`,
      kind: "booking" as const,
      id: r.id,
      title: p?.name ?? "Pitch booking",
      subtitle: r.end_time ? `${r.start_time}–${r.end_time}` : null,
      pitch: p?.name ?? null,
      address: p?.address ?? null,
      pricePence: r.total_price_pence ?? null,
      badge: r.status === "cancelled" ? "Cancelled"
        : r.post_id ? "Posted"
        : r.payment_status === "paid" ? "Paid ✓" : "Payment pending",
      matchId: null,
      openMatchId: null,
      postId: r.post_id ?? null,
      resultVerified: false,
      result: null,
      ...base(r.match_date, r.start_time),
    };
  });
}

// ── The whole picture ─────────────────────────────────────────────────
export async function loadCalendarEntries(userId: string): Promise<CalendarData> {
  const led = await loadLeadership(userId);
  const teamId = led?.teamId ?? null;
  const isCaptain = Boolean(led?.canManage);

  // Friendlies and posts hang off the TEAM'S captain id, not the viewer's —
  // true for a squad player and true for a co-captain, since the fixture
  // belongs to the team whoever set it up.
  const captainId = led?.captainId ?? userId;

  const [friendlies, tournaments, myPosts, ringers, bookings] = await Promise.all([
    loadFriendlies(captainId, teamId),
    loadTournaments(teamId),
    isCaptain ? loadMyPosts(captainId) : Promise.resolve([]),
    loadRingerGames(userId),
    loadBookings(userId),
  ]);

  const entries = [...friendlies, ...tournaments, ...myPosts, ...ringers, ...bookings]
    // An unparseable date can't be placed on a grid or sorted against anything.
    .filter((e) => e.date !== "")
    .sort(compareEntries);

  return { entries, teamId, isCaptain };
}
