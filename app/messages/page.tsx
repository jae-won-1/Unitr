"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type Conversation = {
  otherId: string;
  name: string;
  preview: string;
  createdAt: string;
  unreadCount: number;
};

function timeAgo(iso: string): string {
  const diffMins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return `${Math.floor(diffMins / 1440)}d ago`;
}

export default function MessagesPage() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!user) return;
    async function load() {
      const { data: rows } = await supabase
        .from("messages")
        .select("id, sender_id, receiver_id, body, read, created_at")
        .or(`sender_id.eq.${user!.id},receiver_id.eq.${user!.id}`)
        .order("created_at", { ascending: false });

      if (!rows || rows.length === 0) { setConversations([]); setLoading(false); return; }

      const byOther = new Map<string, typeof rows>();
      for (const r of rows) {
        const otherId = r.sender_id === user!.id ? r.receiver_id : r.sender_id;
        const list = byOther.get(otherId) ?? [];
        list.push(r);
        byOther.set(otherId, list);
      }

      const otherIds = Array.from(byOther.keys());
      const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", otherIds);
      const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name as string]));

      const convos: Conversation[] = otherIds.map((otherId) => {
        const list = byOther.get(otherId)!;
        const latest = list[0];
        const unreadCount = list.filter((m) => m.receiver_id === user!.id && !m.read).length;
        return {
          otherId,
          name: nameById.get(otherId) ?? "Unknown",
          preview: latest.body,
          createdAt: latest.created_at,
          unreadCount,
        };
      }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      setConversations(convos);
      setLoading(false);
    }
    load();
  }, [user]);

  const filtered = search
    ? conversations.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    : conversations;

  // Counts every unread message, not every unread thread — the header reads
  // "3 unread" for one thread carrying three, which is what the design shows.
  const totalUnread = conversations.reduce((n, c) => n + c.unreadCount, 0);

  return (
    <div className="flex flex-col min-h-screen pt-16">
      <header className="px-4 mb-6">
        <h1 className="text-2xl font-extrabold tracking-[-0.02em]">Messages</h1>
        <p className="text-[12.5px] font-medium text-text-secondary mt-0.5 mb-4">
          {totalUnread > 0 ? `${totalUnread} unread` : "All caught up"}
        </p>
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search messages..."
            className="w-full bg-surface border border-border rounded-btn pl-9 pr-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/50"
          />
        </div>
      </header>

      {loading ? (
        <div className="py-12 text-center"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" /></div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-3">
          <div className="w-16 h-16 rounded-full bg-surface-2 border border-border flex items-center justify-center">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="1.5" strokeLinecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </div>
          <p className="text-sm font-semibold">No conversations yet</p>
          <p className="text-xs text-text-secondary max-w-[220px]">Team chats, match chats, and direct messages will show up here.</p>
        </div>
      ) : (
        <div className="px-4">
          <div className="bg-surface border border-border shadow-card rounded-card overflow-hidden flex flex-col">
            {filtered.map((c) => {
              const initials = c.name.split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
              const unread = c.unreadCount > 0;
              return (
                <a key={c.otherId} href={`/messages/${c.otherId}`}
                  className={`flex items-center gap-3 px-4 py-3.5 border-b border-border last:border-b-0 ${unread ? "bg-[#F6FBF7]" : ""}`}>
                  {/* Rounded square, not a circle — the design reserves circles
                      for people's avatars in the chrome and uses a tile here. */}
                  <div className={`w-11 h-11 rounded-btn flex items-center justify-center flex-shrink-0 ${unread ? "bg-accent text-white" : "bg-surface-2 text-text-secondary"}`}>
                    <span className="text-[13px] font-extrabold">{initials}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <p className="text-[14.5px] font-bold truncate flex-1 min-w-0">{c.name}</p>
                      <span className="text-[10px] font-medium text-text-secondary flex-shrink-0">{timeAgo(c.createdAt)}</span>
                    </div>
                    <p className="text-xs font-medium text-text-secondary truncate mt-0.5">{c.preview}</p>
                  </div>
                  {unread && (
                    <span className="min-w-[18px] h-[18px] px-1 text-[10px] font-bold bg-danger text-white rounded-full flex items-center justify-center flex-shrink-0">{c.unreadCount}</span>
                  )}
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
