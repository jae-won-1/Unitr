"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/contexts/RoleContext";
import { supabase } from "@/lib/supabase";

type Announcement = { id: string; title: string | null; body: string; created_at: string; authorName: string };

function timeAgo(iso: string): string {
  const diffMins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return `${Math.floor(diffMins / 1440)}d ago`;
}

// Highlights "@Full Name" mentions in announcement text for display.
function highlightMentions(text: string) {
  const re = /@([A-Z][a-zA-Z]*(?:\s[A-Z][a-zA-Z]*)*)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(<span key={key++}>{text.slice(lastIndex, m.index)}</span>);
    parts.push(<span key={key++} className="text-blue-400 font-semibold">{m[0]}</span>);
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
  return parts;
}

export default function TeamAnnouncementsPage() {
  const { user } = useAuth();
  const { role } = useRole();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    async function load() {
      let teamId: string | undefined;
      if (role === "captain") {
        const { data } = await supabase.from("teams").select("id").eq("captain_id", user!.id).maybeSingle();
        teamId = data?.id;
      } else {
        const { data: mem } = await supabase.from("team_members").select("team_id").eq("player_id", user!.id).eq("status", "approved").maybeSingle();
        teamId = mem?.team_id;
      }
      if (!teamId) { setLoading(false); return; }

      const { data: rows } = await supabase.from("team_announcements")
        .select("id, title, body, created_at, captain_id").eq("team_id", teamId)
        .order("created_at", { ascending: false });

      const authorIds = [...new Set((rows ?? []).map((r) => r.captain_id))];
      const { data: profiles } = authorIds.length > 0
        ? await supabase.from("profiles").select("id, full_name").in("id", authorIds)
        : { data: [] };
      const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name as string]));

      setAnnouncements((rows ?? []).map((r) => ({
        id: r.id, title: r.title, body: r.body, created_at: r.created_at,
        authorName: nameById.get(r.captain_id) ?? "Captain",
      })));
      setLoading(false);
    }
    load();
  }, [user, role]);

  return (
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-8">
      <div className="flex items-center gap-3 mb-6">
        <a href="/my-team">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </a>
        <div>
          <h1 className="text-xl font-bold">Team Announcements</h1>
          <p className="text-xs text-text-secondary">All past posts from your captain</p>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" /></div>
      ) : announcements.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <div className="w-16 h-16 rounded-full bg-surface-2 border border-border flex items-center justify-center">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="1.5" strokeLinecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </div>
          <p className="font-semibold">No announcements yet</p>
          <p className="text-sm text-text-secondary max-w-[240px]">Team posts from your captain will show up here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => (
            <div key={a.id} className="bg-surface-2 border border-border rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-accent">{a.authorName}</p>
                <span className="text-[10px] text-text-secondary flex-shrink-0">{timeAgo(a.created_at)}</span>
              </div>
              {a.title && <p className="text-sm font-bold mb-1">{a.title}</p>}
              <p className="text-sm text-text-primary whitespace-pre-wrap">{highlightMentions(a.body)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
