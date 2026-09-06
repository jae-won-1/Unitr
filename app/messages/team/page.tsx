"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { loadLeadership } from "@/lib/team-leadership";
import {
  CHAT_MIGRATION_HINT,
  leaveChat,
  loadMessages,
  loadSettings,
  markRead,
  rejoinChat,
  sendMessage,
  setMuted,
  type ChatMessage,
  type ChatSettings,
} from "@/lib/team-chat";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function fmtDay(iso: string): string {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return "Today";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

// New messages arrive by polling rather than a Supabase realtime channel —
// realtime isn't enabled on this project, and a chat that only updates on
// reload isn't a chat. Paused while the tab is hidden so a backgrounded phone
// isn't querying every five seconds.
const POLL_MS = 5000;

export default function TeamChatPage() {
  const { user } = useAuth();
  const [teamId, setTeamId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("Team chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [settings, setSettings] = useState<ChatSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const hasLeft = Boolean(settings?.leftAt);

  // ── First load: the viewer's team, their settings, the history ──
  useEffect(() => {
    if (!user) { setLoading(false); return; }
    (async () => {
      const led = await loadLeadership(user.id);
      if (!led) { setLoading(false); return; }
      setTeamId(led.teamId);

      const { data: team } = await supabase
        .from("teams").select("name").eq("id", led.teamId).maybeSingle();
      if (team?.name) setTeamName(team.name as string);

      const s = await loadSettings(led.teamId, user.id);
      if (!s) { setError(CHAT_MIGRATION_HINT); setLoading(false); return; }
      setSettings(s);

      const rows = await loadMessages(led.teamId, { before: s.leftAt });
      if (rows === null) { setError(CHAT_MIGRATION_HINT); setLoading(false); return; }
      setMessages(rows);
      setLoading(false);
      if (!s.leftAt) await markRead(led.teamId, user.id);
    })();
  }, [user]);

  // Only ever appends what isn't already on screen — the poll and a send can
  // both fetch the same row.
  const append = useCallback((rows: ChatMessage[]) => {
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const fresh = rows.filter((r) => !seen.has(r.id));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
  }, []);

  // ── Polling for new messages ──
  const poll = useCallback(async () => {
    if (!user || !teamId || hasLeft || document.hidden) return;
    const newest = messages[messages.length - 1]?.createdAt ?? null;
    const rows = await loadMessages(teamId, { after: newest });
    if (!rows || rows.length === 0) return;
    append(rows);
    await markRead(teamId, user.id);
  }, [user, teamId, hasLeft, messages, append]);

  useEffect(() => {
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSend = async () => {
    if (!user || !teamId || !draft.trim() || sending) return;
    setSending(true);
    const body = draft.trim();
    setDraft("");
    const res = await sendMessage(teamId, user.id, body);
    if (!res.ok) {
      setError(res.error ?? "Couldn't send that.");
      setDraft(body);
    } else {
      setError(null);
      const rows = await loadMessages(teamId, { after: messages[messages.length - 1]?.createdAt ?? null });
      if (rows?.length) append(rows);
      await markRead(teamId, user.id);
    }
    setSending(false);
  };

  const handleMute = async () => {
    if (!user || !teamId || !settings) return;
    const next = !settings.muted;
    setSettings({ ...settings, muted: next });
    setMenuOpen(false);
    if (!(await setMuted(teamId, user.id, next))) setSettings({ ...settings, muted: !next });
  };

  const handleLeave = async () => {
    if (!user || !teamId) return;
    setMenuOpen(false);
    const now = new Date().toISOString();
    if (await leaveChat(teamId, user.id)) {
      setSettings((s) => ({ muted: s?.muted ?? false, leftAt: now, lastReadAt: s?.lastReadAt ?? null }));
      setMessages((prev) => prev.filter((m) => m.createdAt <= now));
    }
  };

  const handleRejoin = async () => {
    if (!user || !teamId) return;
    setMenuOpen(false);
    if (await rejoinChat(teamId, user.id)) {
      setSettings((s) => ({ muted: s?.muted ?? false, leftAt: null, lastReadAt: new Date().toISOString() }));
      const rows = await loadMessages(teamId);
      if (rows) setMessages(rows);
    }
  };

  return (
    <div className="flex flex-col min-h-screen pt-16 pb-4">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 mb-4 flex-shrink-0">
        <a href="/messages" aria-label="Back to messages">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </a>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-lg truncate">{teamName}</p>
          <p className="text-[11px] font-medium text-text-secondary">
            Team chat · everyone in the squad{settings?.muted && !hasLeft ? " · muted" : ""}
          </p>
        </div>

        {teamId && settings && (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Chat options"
              className="w-9 h-9 rounded-btn flex items-center justify-center"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2.5" strokeLinecap="round">
                <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
              </svg>
            </button>
            {menuOpen && (
              // z-[60]: above the z-40 TopBar, per the app's overlay floor.
              <div className="absolute right-0 top-10 w-56 bg-surface border border-border rounded-2xl shadow-xl overflow-hidden z-[60]">
                <button onClick={handleMute}
                  className="w-full text-left px-4 py-3 text-[13px] font-semibold border-b border-border">
                  {settings.muted ? "Turn notifications on" : "Turn notifications off"}
                </button>
                {hasLeft ? (
                  <button onClick={handleRejoin}
                    className="w-full text-left px-4 py-3 text-[13px] font-semibold text-accent">
                    Rejoin chat
                  </button>
                ) : (
                  <button onClick={handleLeave}
                    className="w-full text-left px-4 py-3 text-[13px] font-semibold text-danger">
                    Leave chat
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mx-4 mb-3 rounded-card border border-border bg-surface px-4 py-3">
          <p className="text-xs font-medium text-danger">{error}</p>
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto px-4 space-y-2">
        {loading ? (
          <div className="py-8 text-center"><div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" /></div>
        ) : !teamId ? (
          <p className="text-xs text-text-secondary text-center py-8 max-w-[260px] mx-auto">
            The team chat opens once you&apos;re in a squad — join or register a team first.
          </p>
        ) : messages.length === 0 ? (
          <p className="text-xs text-text-secondary text-center py-8">
            No messages yet — everyone in the squad is here.
          </p>
        ) : (
          messages.map((m, i) => {
            const mine = m.senderId === user?.id;
            const prev = messages[i - 1];
            const newDay = !prev || fmtDay(prev.createdAt) !== fmtDay(m.createdAt);
            // Consecutive messages from one person are captioned once — a group
            // chat is unreadable with a name over every bubble.
            const showName = !mine && (!prev || prev.senderId !== m.senderId || newDay);
            return (
              <div key={m.id}>
                {newDay && (
                  <p className="text-[10px] font-bold text-text-secondary text-center py-2 uppercase tracking-wide">
                    {fmtDay(m.createdAt)}
                  </p>
                )}
                <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className="max-w-[78%]">
                    {showName && (
                      <p className="text-[10.5px] font-bold text-text-secondary mb-0.5 px-1">{m.senderName}</p>
                    )}
                    <div className={`rounded-card px-4 py-2.5 ${mine ? "bg-accent text-white" : "bg-surface border border-border text-text-primary"}`}>
                      <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                      <p className={`text-[10px] mt-1 ${mine ? "text-white/70" : "text-text-secondary"}`}>{fmtTime(m.createdAt)}</p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Composer, or the way back in ── */}
      {teamId && !loading && (
        hasLeft ? (
          <div className="mx-4 mt-3 rounded-card border border-border bg-surface px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold">You left this chat</p>
              <p className="text-[11px] font-medium text-text-secondary">
                You&apos;ll see what was said up to then, and nothing new.
              </p>
            </div>
            <button onClick={handleRejoin}
              className="px-4 py-2 rounded-btn bg-accent text-white text-[12.5px] font-bold flex-shrink-0">
              Rejoin
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-4 pt-3 flex-shrink-0">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
              placeholder="Message your team..."
              className="flex-1 bg-surface border border-border rounded-btn px-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/50"
            />
            <button onClick={handleSend} disabled={sending || !draft.trim()}
              aria-label="Send"
              className="w-10 h-10 rounded-btn bg-accent text-white flex items-center justify-center disabled:opacity-40">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            </button>
          </div>
        )
      )}
    </div>
  );
}
