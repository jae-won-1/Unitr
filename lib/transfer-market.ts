import { supabase } from "@/lib/supabase";
import { actingCaptainId, loadLeadership } from "@/lib/team-leadership";

// Data layer for the Transfer Market. Kept out of the page because every card
// needs the viewer's *relationship* to the row it renders, not just the row —
// and resolving that per card would be a query per card. Everything here loads
// the viewer's edges once, up front, and hands the page lookup maps.

export type MarketPlayer = {
  id: string;
  full_name: string;
  position: string | null;
  location: string | null;
  experience: string | null;
  teamName: string | null; // null = free agent, the ones captains are hunting
};

export type MarketTeam = {
  id: string;
  name: string;
  location: string | null;
  level: string | null;
  format: string | null;
  captain_id: string;
  members: number;
};

/** Where the viewer stands with another player. */
export type FriendState = "none" | "sent" | "incoming" | "friends";
/** Where the viewer's team stands with a player they could sign. Mirrors the
 *  status column verbatim so the map never needs translating. */
export type OfferState = "none" | "pending" | "declined" | "accepted";
/** Where the viewer stands with a team they could join. */
export type JoinState = "none" | "pending" | "member" | "captain";

export type Viewer = {
  userId: string;
  /** The team the viewer captains, if any — the team an offer would come from. */
  captainTeamId: string | null;
  /** Any team the viewer belongs to, captained or joined. */
  myTeamId: string | null;
};

export type MarketEdges = {
  friends: Map<string, FriendState>;
  offers: Map<string, OfferState>;   // keyed by player id, for the viewer's team
  joins: Map<string, JoinState>;     // keyed by team id
};

const EMPTY_EDGES: MarketEdges = { friends: new Map(), offers: new Map(), joins: new Map() };

// `captainTeamId` is the team the viewer may recruit for — a co-captain
// recruits too, so it's set for them as well.
export async function loadViewer(userId: string): Promise<Viewer> {
  const led = await loadLeadership(userId);
  return {
    userId,
    captainTeamId: led?.canManage ? led.teamId : null,
    myTeamId: led?.teamId ?? null,
  };
}

// Squad membership for a batch of players, so a captain can tell a free agent
// from someone already signed before spending an offer on them.
async function teamNamesForPlayers(playerIds: string[]): Promise<Map<string, string>> {
  if (playerIds.length === 0) return new Map();

  const [{ data: memberships }, { data: captained }] = await Promise.all([
    supabase.from("team_members").select("player_id, team_id").in("player_id", playerIds).eq("status", "approved"),
    supabase.from("teams").select("id, name, captain_id").in("captain_id", playerIds),
  ]);

  const out = new Map<string, string>();
  for (const t of captained ?? []) out.set(t.captain_id as string, t.name as string);

  const teamIds = [...new Set((memberships ?? []).map((m) => m.team_id))];
  if (teamIds.length > 0) {
    const { data: teams } = await supabase.from("teams").select("id, name").in("id", teamIds);
    const byId = new Map((teams ?? []).map((t) => [t.id, t.name as string]));
    for (const m of memberships ?? []) {
      const name = byId.get(m.team_id);
      if (name && !out.has(m.player_id)) out.set(m.player_id, name);
    }
  }
  return out;
}

export async function searchPlayers(query: string, viewerId: string | undefined): Promise<MarketPlayer[]> {
  let q = supabase.from("profiles")
    .select("id, full_name, position, location, experience")
    .eq("account_type", "player")
    .limit(30);
  if (query.trim()) q = q.ilike("full_name", `%${query.trim()}%`);

  const { data } = await q;
  const rows = (data ?? []).filter((p) => p.id !== viewerId);
  const teamNames = await teamNamesForPlayers(rows.map((p) => p.id));

  return rows.map((p) => ({ ...p, teamName: teamNames.get(p.id) ?? null })) as MarketPlayer[];
}

export async function searchTeams(query: string): Promise<MarketTeam[]> {
  let q = supabase.from("teams")
    .select("id, name, location, level, format, captain_id")
    .limit(30);
  if (query.trim()) q = q.ilike("name", `%${query.trim()}%`);

  const { data: rows } = await q;
  if (!rows || rows.length === 0) return [];

  // One tally for every approved membership rather than a count per team.
  // The captain has no team_members row, so every team starts at 1.
  const { data: members } = await supabase.from("team_members")
    .select("team_id").eq("status", "approved").in("team_id", rows.map((t) => t.id));
  const tally = new Map<string, number>();
  for (const m of members ?? []) tally.set(m.team_id, (tally.get(m.team_id) ?? 0) + 1);

  return rows.map((t) => ({ ...t, members: (tally.get(t.id) ?? 0) + 1 })) as MarketTeam[];
}

// Every edge the viewer has, in three queries regardless of result-set size.
export async function loadEdges(viewer: Viewer | null): Promise<MarketEdges> {
  if (!viewer) return EMPTY_EDGES;
  const { userId, captainTeamId } = viewer;

  const [{ data: friendRows }, { data: offerRows }, { data: joinRows }] = await Promise.all([
    supabase.from("friend_requests")
      .select("from_player_id, to_player_id, status")
      .or(`from_player_id.eq.${userId},to_player_id.eq.${userId}`),
    captainTeamId
      ? supabase.from("player_offers").select("player_id, status").eq("team_id", captainTeamId)
      : Promise.resolve({ data: [] as { player_id: string; status: string }[] }),
    supabase.from("team_members").select("team_id, status").eq("player_id", userId),
  ]);

  const friends = new Map<string, FriendState>();
  for (const r of friendRows ?? []) {
    const other = r.from_player_id === userId ? r.to_player_id : r.from_player_id;
    if (r.status === "accepted") { friends.set(other, "friends"); continue; }
    if (r.status === "declined") continue; // reads as "none" — the button comes back
    friends.set(other, r.from_player_id === userId ? "sent" : "incoming");
  }

  const offers = new Map<string, OfferState>();
  for (const o of offerRows ?? []) offers.set(o.player_id, o.status as OfferState);

  const joins = new Map<string, JoinState>();
  for (const j of joinRows ?? []) {
    joins.set(j.team_id, j.status === "approved" ? "member" : "pending");
  }
  if (captainTeamId) joins.set(captainTeamId, "captain");

  return { friends, offers, joins };
}

// ── Actions ───────────────────────────────────────────────────────────
// Each returns void and throws nothing: the page reloads edges afterwards, so
// a failed write simply leaves the button in its previous state.

export async function sendFriendRequest(fromId: string, toId: string) {
  await supabase.from("friend_requests")
    .upsert({ from_player_id: fromId, to_player_id: toId, status: "pending" },
      { onConflict: "from_player_id,to_player_id" });
}

export async function respondToFriendRequest(fromId: string, toId: string, accept: boolean) {
  await supabase.from("friend_requests")
    .update({ status: accept ? "accepted" : "declined" })
    .eq("from_player_id", fromId).eq("to_player_id", toId);
}

// `actingUserId` is whoever pressed Send — the offer itself is filed under the
// team's captain, so a co-captain's offer reads as the team's and the unique
// (team, player) key still means one offer per player per team.
export async function sendOffer(teamId: string, actingUserId: string, playerId: string, message: string | null) {
  const captainId = await actingCaptainId(actingUserId, teamId);
  await supabase.from("player_offers")
    .upsert({ team_id: teamId, captain_id: captainId, player_id: playerId, message, status: "pending" },
      { onConflict: "team_id,player_id" });
}

// Accepting is what actually moves the player: the offer row records the
// decision, team_members records the squad.
export async function acceptOffer(offerId: string, teamId: string, playerId: string) {
  await supabase.from("team_members")
    .upsert({ team_id: teamId, player_id: playerId, status: "approved" }, { onConflict: "team_id,player_id" });
  await supabase.from("player_offers").update({ status: "accepted" }).eq("id", offerId);
}

export async function declineOffer(offerId: string) {
  await supabase.from("player_offers").update({ status: "declined" }).eq("id", offerId);
}

export async function askToJoin(teamId: string, playerId: string) {
  await supabase.from("team_members")
    .upsert({ team_id: teamId, player_id: playerId, status: "pending" }, { onConflict: "team_id,player_id" });
}

// ── Inbox ─────────────────────────────────────────────────────────────
export type InboxOffer = {
  id: string; teamId: string; teamName: string; message: string | null;
};
export type InboxFriend = {
  fromId: string; name: string; position: string | null; location: string | null;
};

export async function loadInbox(userId: string): Promise<{ offers: InboxOffer[]; friends: InboxFriend[] }> {
  const [{ data: offerRows }, { data: friendRows }] = await Promise.all([
    supabase.from("player_offers").select("id, team_id, message").eq("player_id", userId).eq("status", "pending"),
    supabase.from("friend_requests").select("from_player_id").eq("to_player_id", userId).eq("status", "pending"),
  ]);

  const teamIds = [...new Set((offerRows ?? []).map((o) => o.team_id))];
  const { data: teams } = teamIds.length
    ? await supabase.from("teams").select("id, name").in("id", teamIds)
    : { data: [] as { id: string; name: string }[] };
  const teamName = new Map((teams ?? []).map((t) => [t.id, t.name as string]));

  const fromIds = [...new Set((friendRows ?? []).map((f) => f.from_player_id))];
  const { data: profiles } = fromIds.length
    ? await supabase.from("profiles").select("id, full_name, position, location").in("id", fromIds)
    : { data: [] as { id: string; full_name: string; position: string | null; location: string | null }[] };

  return {
    offers: (offerRows ?? []).map((o) => ({
      id: o.id, teamId: o.team_id, teamName: teamName.get(o.team_id) ?? "A team", message: o.message,
    })),
    friends: (profiles ?? []).map((p) => ({
      fromId: p.id, name: p.full_name, position: p.position, location: p.location,
    })),
  };
}
