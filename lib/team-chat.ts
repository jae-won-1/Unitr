"use client";

// ── The team group chat ────────────────────────────────────────────────
// One chat per team, and the only place `team_chat_messages` /
// `team_chat_members` are read or written (the same rule lib/event-availability
// follows for availability).
//
// Membership is DERIVED, never stored: the captain plus every approved
// `team_members` row is in the chat. So a newly approved member — or one who
// walked in through the invite link — is in it on their next load with nothing
// to write, and a member who is removed from the squad drops out of it.
//
// `team_chat_members` carries only what that derivation can't know: muted,
// left, and how far this person has read. The row is created lazily, so most
// of the squad never has one.

import { supabase } from "@/lib/supabase";

export type ChatSettings = {
  muted: boolean;
  /** When they left, or null if they're still in. Also the history cut-off. */
  leftAt: string | null;
  lastReadAt: string | null;
};

export type ChatMessage = {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
};

/** What the inbox and the bell need without opening the chat. */
export type ChatSummary = {
  teamId: string;
  teamName: string;
  preview: string | null;
  lastAt: string | null;
  unreadCount: number;
  muted: boolean;
  hasLeft: boolean;
};

// House convention: a missing migration degrades, it doesn't crash. Selecting
// from a table that isn't there fails the whole query, so every entry point
// tells that apart from a real failure and the UI says so plainly.
export const CHAT_MIGRATION_HINT =
  "Team chat isn't set up yet — run supabase_team_chat.sql in Supabase.";

function isMissingTable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01"
    || /team_chat_(messages|members)|schema cache|does not exist/i.test(error.message ?? "");
}

// ── Settings ───────────────────────────────────────────────────────────

export async function loadSettings(
  teamId: string, userId: string,
): Promise<ChatSettings | null> {
  const { data, error } = await supabase
    .from("team_chat_members")
    .select("muted, left_at, last_read_at")
    .eq("team_id", teamId).eq("user_id", userId).maybeSingle();
  if (error && isMissingTable(error)) return null;
  return {
    muted: Boolean(data?.muted),
    leftAt: (data?.left_at as string) ?? null,
    lastReadAt: (data?.last_read_at as string) ?? null,
  };
}

// Every settings write is the same upsert — the row may not exist yet, and
// two of these can race on a first open (marking read while muting).
async function upsertSettings(
  teamId: string, userId: string, patch: Record<string, unknown>,
): Promise<boolean> {
  const { error } = await supabase
    .from("team_chat_members")
    .upsert({ team_id: teamId, user_id: userId, ...patch }, { onConflict: "team_id,user_id" });
  return !error;
}

export function setMuted(teamId: string, userId: string, muted: boolean) {
  return upsertSettings(teamId, userId, { muted });
}

/** Leaving stops new messages arriving; the history up to now is kept. */
export function leaveChat(teamId: string, userId: string) {
  return upsertSettings(teamId, userId, { left_at: new Date().toISOString() });
}

/** Rejoining is always available while they're still in the squad. */
export function rejoinChat(teamId: string, userId: string) {
  return upsertSettings(teamId, userId, { left_at: null, last_read_at: new Date().toISOString() });
}

export function markRead(teamId: string, userId: string) {
  return upsertSettings(teamId, userId, { last_read_at: new Date().toISOString() });
}

// ── Messages ───────────────────────────────────────────────────────────

// `before` is the leaver's cut-off: they see the chat as it stood when they
// left rather than a live feed they're no longer part of.
export async function loadMessages(
  teamId: string, opts: { after?: string | null; before?: string | null } = {},
): Promise<ChatMessage[] | null> {
  let q = supabase
    .from("team_chat_messages")
    .select("id, sender_id, body, created_at")
    .eq("team_id", teamId)
    .order("created_at", { ascending: true });
  if (opts.after) q = q.gt("created_at", opts.after);
  if (opts.before) q = q.lte("created_at", opts.before);

  const { data, error } = await q;
  if (error) return isMissingTable(error) ? null : [];

  const rows = (data ?? []) as { id: string; sender_id: string; body: string; created_at: string }[];
  const senderIds = Array.from(new Set(rows.map((r) => r.sender_id)));
  // Separate fetch, not an embedded select: team_chat_messages.sender_id
  // points at auth.users, which has no relationship to profiles in the schema
  // cache — embedding it fails the whole query with PGRST200.
  const nameById = new Map<string, string>();
  if (senderIds.length) {
    const { data: profiles } = await supabase
      .from("profiles").select("id, full_name").in("id", senderIds);
    for (const p of profiles ?? []) nameById.set(p.id as string, (p.full_name as string) ?? "Player");
  }

  return rows.map((r) => ({
    id: r.id,
    senderId: r.sender_id,
    senderName: nameById.get(r.sender_id) ?? "Player",
    body: r.body,
    createdAt: r.created_at,
  }));
}

export async function sendMessage(
  teamId: string, userId: string, body: string,
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "Nothing to send" };
  const { error } = await supabase
    .from("team_chat_messages")
    .insert({ team_id: teamId, sender_id: userId, body: trimmed });
  if (!error) return { ok: true };
  if (isMissingTable(error)) return { ok: false, error: CHAT_MIGRATION_HINT };
  // The insert policy is the one that can refuse a signed-in squad member:
  // it's what stops someone who left posting into a chat they're not in.
  return {
    ok: false,
    error: /row-level security/i.test(error.message)
      ? "You're not in this chat any more."
      : error.message,
  };
}

// ── Summary, for the inbox row and the bell ────────────────────────────

export async function loadChatSummary(
  teamId: string | null | undefined,
  userId: string | null | undefined,
): Promise<ChatSummary | null> {
  if (!teamId || !userId) return null;

  const settings = await loadSettings(teamId, userId);
  if (!settings) return null;   // migration not run

  const { data: team } = await supabase
    .from("teams").select("name").eq("id", teamId).maybeSingle();

  const { data: latest, error } = await supabase
    .from("team_chat_messages")
    .select("body, created_at")
    .eq("team_id", teamId)
    .lte("created_at", settings.leftAt ?? "9999-12-31")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return null;

  const last = (latest ?? [])[0] as { body: string; created_at: string } | undefined;

  // A muted or left chat never contributes an unread count — that is what
  // both switches are for — so the query is skipped entirely for them.
  let unreadCount = 0;
  if (!settings.muted && !settings.leftAt && settings.lastReadAt) {
    const { count } = await supabase
      .from("team_chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("team_id", teamId)
      .gt("created_at", settings.lastReadAt)
      .neq("sender_id", userId);
    unreadCount = count ?? 0;
  }

  return {
    teamId,
    teamName: (team?.name as string) ?? "Your team",
    preview: last?.body ?? null,
    lastAt: last?.created_at ?? null,
    unreadCount,
    muted: settings.muted,
    hasLeft: Boolean(settings.leftAt),
  };
}
