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

  return (
    <div className="flex flex-col min-h-screen pt-16">
      <header className="px-4 mb-6">
        <h1 className="text-2xl font-bold mb-4">Messages</h1>
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
            className="w-full bg-surface-2 border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/50"
          />
        </div>
      </header>

      {loading ? (
        <div className="py-12 text-center"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" /></div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-3">
          <div className="w-16 h-16 rounded-full bg-surface-2 border border-border flex items-center justify-center">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="1.5" strokeLinecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </div>
          <p className="text-sm font-semibold">No conversations yet</p>
          <p className="text-xs text-text-secondary max-w-[220px]">Team chats, match chats, and direct messages will show up here.</p>
        </div>
      ) : (
        <div className="px-4 space-y-2">
          {filtered.map((c) => {
            const initials = c.name.split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
            return (
              <a key={c.otherId} href={`/messages/${c.otherId}`}
                className="flex items-center gap-3 bg-surface-2 border border-border rounded-xl px-4 py-3">
                <div className="w-10 h-10 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-accent">{initials}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold truncate">{c.name}</p>
                    <span className="text-[10px] text-text-secondary flex-shrink-0">{timeAgo(c.createdAt)}</span>
                  </div>
                  <p className="text-xs text-text-secondary truncate mt-0.5">{c.preview}</p>
                </div>
                {c.unreadCount > 0 && (
                  <span className="text-[10px] font-bold bg-accent text-black px-1.5 py-0.5 rounded-full flex-shrink-0">{c.unreadCount}</span>
                )}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
