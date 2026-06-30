"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type RosterPlayer = { player_id: string; name: string };

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Renders body text as React nodes, wrapping any "@FullName" that matches a
// real squad member in a blue highlighted span.
function renderHighlighted(text: string, roster: RosterPlayer[]) {
  if (!text) return null;
  const names = [...new Set(roster.map((r) => r.name).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (names.length === 0) return text;
  const re = new RegExp(`@(${names.map(escapeRegex).join("|")})`, "g");
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(<span key={key++}>{text.slice(lastIndex, m.index)}</span>);
    parts.push(<span key={key++} className="text-blue-400">{m[0]}</span>);
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
  if (text.endsWith("\n")) parts.push("​");
  return parts;
}

export default function CreateAnnouncementPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [suggestions, setSuggestions] = useState<RosterPlayer[]>([]);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!user) return;
    async function loadRoster() {
      const { data: team } = await supabase.from("teams").select("id, captain_id").eq("captain_id", user!.id).maybeSingle();
      if (!team) return;
      const [{ data: members }, { data: captainProfile }] = await Promise.all([
        supabase.from("team_members").select("player_id, profiles(full_name)").eq("team_id", team.id).eq("status", "approved"),
        supabase.from("profiles").select("full_name").eq("id", team.captain_id).maybeSingle(),
      ]);
      const list: RosterPlayer[] = [
        ...(team.captain_id ? [{ player_id: team.captain_id as string, name: captainProfile?.full_name ?? "Captain" }] : []),
        ...(members ?? []).map((m) => ({ player_id: m.player_id as string, name: (m.profiles as unknown as { full_name: string } | null)?.full_name ?? "Player" })),
      ].filter((p, i, arr) => arr.findIndex((x) => x.player_id === p.player_id) === i);
      setRoster(list);
    }
    loadRoster();
  }, [user]);

  const detectMention = (value: string, cursor: number) => {
    const beforeCursor = value.slice(0, cursor);
    const match = beforeCursor.match(/@([A-Za-z]*)$/);
    if (!match) { setSuggestions([]); setMentionStart(null); return; }
    const query = match[1].toLowerCase();
    const matches = roster.filter((p) => p.name.toLowerCase().startsWith(query));
    setSuggestions(matches);
    setMentionStart(cursor - match[0].length);
  };

  const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setBody(value);
    detectMention(value, e.target.selectionStart);
  };

  const handleCursorMove = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    detectMention(el.value, el.selectionStart);
  };

  const selectMention = (player: RosterPlayer) => {
    if (mentionStart === null || !textareaRef.current) return;
    const cursor = textareaRef.current.selectionStart;
    const before = body.slice(0, mentionStart);
    const after = body.slice(cursor);
    const inserted = `@${player.name} `;
    const newText = before + inserted + after;
    setBody(newText);
    setSuggestions([]);
    setMentionStart(null);
    requestAnimationFrame(() => {
      const newCursor = before.length + inserted.length;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(newCursor, newCursor);
    });
  };

  const handlePost = async () => {
    if (!user) { setError("You must be signed in."); return; }
    if (!body.trim()) { setError("Write something for your team to see."); return; }
    setPosting(true);
    setError(null);

    const { data: team } = await supabase.from("teams").select("id, name").eq("captain_id", user.id).maybeSingle();
    if (!team) { setPosting(false); setError("No team found. Register your team first."); return; }

    const { error: insertError } = await supabase.from("team_announcements").insert({
      team_id: team.id,
      captain_id: user.id,
      title: title.trim() || null,
      body: body.trim(),
    });
    if (insertError) { setPosting(false); setError(insertError.message); return; }

    // Notify every other squad member as a direct message.
    const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
    const recipientIds = roster.map((p) => p.player_id).filter((id) => id !== user.id);
    if (recipientIds.length > 0) {
      const summary = title.trim() ? `${title.trim()}\n${body.trim()}` : body.trim();
      await supabase.from("messages").insert(
        recipientIds.map((playerId) => ({
          sender_id: user.id,
          receiver_id: playerId,
          type: "team_announcement",
          body: `📋 New team announcement from ${profile?.full_name ?? "your captain"} (${team.name}):\n${summary}`,
        }))
      );
    }

    setPosting(false);
    router.push("/my-team");
  };

  return (
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-8">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.back()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
        </button>
        <div>
          <h1 className="text-xl font-bold">Post Announcement</h1>
          <p className="text-xs text-text-secondary mt-0.5">Announce something to your whole squad</p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold">Title <span className="text-text-secondary font-normal">(optional)</span></label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Training moved to Tuesday"
            maxLength={80}
            className="bg-surface-2 border border-border rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/50"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold">Message</label>
          <div className="relative bg-surface-2 border border-border rounded-xl focus-within:border-accent/50">
            <div aria-hidden className="px-4 py-3 text-sm whitespace-pre-wrap break-words min-h-[140px] leading-relaxed">
              {renderHighlighted(body, roster) ?? <span className="text-text-secondary">Training moved to Tuesday this week, bring both kits to Saturday&apos;s match... Type @ to mention a player.</span>}
            </div>
            <textarea
              ref={textareaRef}
              rows={6}
              autoFocus
              value={body}
              onChange={handleBodyChange}
              onClick={handleCursorMove}
              onKeyUp={handleCursorMove}
              placeholder="Training moved to Tuesday this week, bring both kits to Saturday's match... Type @ to mention a player."
              className="absolute inset-0 w-full h-full px-4 py-3 text-sm leading-relaxed bg-transparent text-transparent outline-none resize-none placeholder:text-transparent"
              style={{ caretColor: "#fff" }}
            />

            {suggestions.length > 0 && (
              <div className="absolute left-2 right-2 bottom-2 bg-surface border border-border rounded-xl shadow-lg overflow-hidden z-10 max-h-48 overflow-y-auto">
                {suggestions.map((p) => (
                  <button key={p.player_id} type="button" onClick={() => selectMention(p)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-2 transition-colors">
                    <div className="w-6 h-6 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                      <span className="text-[9px] font-bold text-accent">{p.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>
                    </div>
                    <span className="text-sm">{p.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="text-[11px] text-text-secondary">
            Type @ followed by a name to ping a teammate — they&apos;ll be highlighted in blue.
          </p>
        </div>

        <p className="text-xs text-text-secondary">
          Every player on your squad will get a notification with this announcement.
        </p>

        <button onClick={handlePost} disabled={posting}
          className="w-full py-3.5 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
          {posting ? (
            <><svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Posting…</>
          ) : "Post Announcement"}
        </button>
      </div>
    </div>
  );
}
