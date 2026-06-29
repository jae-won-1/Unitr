"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type Message = {
  id: string;
  sender_id: string;
  receiver_id: string;
  body: string;
  created_at: string;
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default function ThreadPage({ params }: { params: { otherId: string } }) {
  const { user } = useAuth();
  const [name, setName] = useState("Conversation");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", params.otherId).maybeSingle();
      if (profile?.full_name) setName(profile.full_name);

      const { data: rows } = await supabase
        .from("messages")
        .select("id, sender_id, receiver_id, body, created_at")
        .or(`and(sender_id.eq.${user!.id},receiver_id.eq.${params.otherId}),and(sender_id.eq.${params.otherId},receiver_id.eq.${user!.id})`)
        .order("created_at", { ascending: true });
      setMessages(rows ?? []);
      setLoading(false);

      await supabase.from("messages").update({ read: true })
        .eq("sender_id", params.otherId).eq("receiver_id", user!.id).eq("read", false);
    }
    load();
  }, [user, params.otherId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!user || !draft.trim()) return;
    setSending(true);
    const body = draft.trim();
    setDraft("");
    const { data } = await supabase.from("messages").insert({
      sender_id: user.id,
      receiver_id: params.otherId,
      body,
    }).select("id, sender_id, receiver_id, body, created_at").single();
    if (data) setMessages((prev) => [...prev, data]);
    setSending(false);
  };

  return (
    <div className="flex flex-col min-h-screen pt-12 pb-4">
      <div className="flex items-center gap-3 px-4 mb-4 flex-shrink-0">
        <a href="/messages">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </a>
        <p className="font-bold text-lg">{name}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 space-y-2">
        {loading ? (
          <div className="py-8 text-center"><div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" /></div>
        ) : messages.length === 0 ? (
          <p className="text-xs text-text-secondary text-center py-8">No messages yet — say hello.</p>
        ) : (
          messages.map((m) => {
            const mine = m.sender_id === user?.id;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${mine ? "bg-accent text-black" : "bg-surface-2 border border-border text-text-primary"}`}>
                  <p className="text-sm whitespace-pre-wrap">{m.body}</p>
                  <p className={`text-[10px] mt-1 ${mine ? "text-black/60" : "text-text-secondary"}`}>{fmtTime(m.created_at)}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-center gap-2 px-4 pt-3 flex-shrink-0">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !sending) handleSend(); }}
          placeholder="Type a message..."
          className="flex-1 bg-surface-2 border border-border rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/50"
        />
        <button onClick={handleSend} disabled={sending || !draft.trim()}
          className="w-10 h-10 rounded-xl bg-accent text-black flex items-center justify-center disabled:opacity-40">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
        </button>
      </div>
    </div>
  );
}
