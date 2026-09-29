// One-to-one messages (the `messages` table): the inbox's conversation list, a
// thread, marking it read, and sending.
//
// Written for the mobile app, as the same queries app/messages/page.tsx and
// app/messages/[otherId]/page.tsx run inline — lifted into one place so the
// phone doesn't carry a second copy. The web pages still use their own inline
// versions for now; they can switch to these without any change in behaviour.
//
// RLS (supabase_pilot_security.sql) makes a message readable only by its two
// correspondents, so every query here is already scoped by the database as
// well as by its filters. No embedded selects: messages → profiles has no
// relationship in the schema cache, so names are fetched separately.

import { supabase } from "@/lib/supabase";

export type Conversation = {
  otherId: string;
  name: string;
  preview: string;
  createdAt: string;
  unreadCount: number;
};

export type DirectMessage = {
  id: string;
  sender_id: string;
  receiver_id: string;
  body: string;
  created_at: string;
};

const THREAD_COLUMNS = "id, sender_id, receiver_id, body, created_at";

// Every thread the user is in, newest first, with who it's with, the latest
// line, and how many of the other person's messages are still unread.
export async function loadConversations(userId: string): Promise<Conversation[]> {
  const { data: rows } = await supabase
    .from("messages")
    .select("id, sender_id, receiver_id, body, read, created_at")
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
    .order("created_at", { ascending: false });

  if (!rows || rows.length === 0) return [];

  const byOther = new Map<string, typeof rows>();
  for (const r of rows) {
    const otherId = r.sender_id === userId ? r.receiver_id : r.sender_id;
    const list = byOther.get(otherId) ?? [];
    list.push(r);
    byOther.set(otherId, list);
  }

  const otherIds = Array.from(byOther.keys());
  const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", otherIds);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name as string]));

  return otherIds.map((otherId) => {
    const list = byOther.get(otherId)!;
    const latest = list[0];
    return {
      otherId,
      name: nameById.get(otherId) ?? "Unknown",
      preview: latest.body,
      createdAt: latest.created_at,
      unreadCount: list.filter((m) => m.receiver_id === userId && !m.read).length,
    };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// How many messages are waiting for the user across every thread — one count
// query, for a badge that shouldn't have to load the whole inbox.
export async function countUnreadDirect(userId: string): Promise<number> {
  const { count } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("receiver_id", userId)
    .eq("read", false);
  return count ?? 0;
}

// The thread between two people, oldest first. `after` returns only what
// arrived since a timestamp, for polling.
export async function loadThread(
  userId: string,
  otherId: string,
  opts: { after?: string | null } = {},
): Promise<DirectMessage[]> {
  let q = supabase
    .from("messages")
    .select(THREAD_COLUMNS)
    .or(`and(sender_id.eq.${userId},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${userId})`)
    .order("created_at", { ascending: true });
  if (opts.after) q = q.gt("created_at", opts.after);
  const { data } = await q;
  return (data as DirectMessage[] | null) ?? [];
}

// Everything the other person sent that the user hasn't seen, marked seen.
export async function markThreadRead(userId: string, otherId: string): Promise<void> {
  await supabase.from("messages").update({ read: true })
    .eq("sender_id", otherId).eq("receiver_id", userId).eq("read", false);
}

export async function sendDirectMessage(
  userId: string,
  otherId: string,
  body: string,
): Promise<DirectMessage | null> {
  const { data } = await supabase.from("messages").insert({
    sender_id: userId,
    receiver_id: otherId,
    body,
  }).select(THREAD_COLUMNS).single();
  return (data as DirectMessage | null) ?? null;
}

export async function loadPersonName(userId: string): Promise<string | null> {
  const { data } = await supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  return (data?.full_name as string | undefined) ?? null;
}
