"use client";

// ── My Team ───────────────────────────────────────────────────────────
// Four tabs: Manage Match · Tactics · Stats · Members.
//
// This page used to be 1,400 lines of one continuous scroll, carrying a credit
// bar, an availability poll, a fixtures list and a grid of links to other
// pages. Nearly all of it had a better home elsewhere — team credit and
// settlement now live on Home, availability polling on Home and
// /my-team/collect-availability, and fixtures on the Calendar, which does them
// properly with month grids and filters. What was left duplicated those
// surfaces and buried the thing only this page can do: run the team.
//
// So the page is now about the squad and the next game, and nothing else.
// Captains author, players observe — and per the house convention in
// QuickNav, captain-only controls render greyed rather than absent, so the
// layout doesn't shift between roles.

import { useEffect, useState } from "react";
import { useRole } from "@/contexts/RoleContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { fmtFee } from "@/lib/joining-fee";
import ManageMatchTab from "@/components/my-team/ManageMatchTab";
import TacticsTab from "@/components/my-team/TacticsTab";
import StatsTab from "@/components/my-team/StatsTab";
import MembersTab from "@/components/my-team/MembersTab";

// Highlights "@Full Name" mentions in announcement text for display.
// Validity (matching a real squad member) is enforced at creation time via
// the mention autocomplete, so this just renders any @-prefixed name pattern.
function highlightMentions(text: string) {
  const re = /@([A-Z][a-zA-Z]*(?:\s[A-Z][a-zA-Z]*)*)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(<span key={key++}>{text.slice(lastIndex, m.index)}</span>);
    parts.push(<span key={key++} className="text-blue-600 font-semibold">{m[0]}</span>);
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
  return parts;
}

type Team = {
  id: string;
  name: string;
  location: string;
  level: string;
  format: string;
  description: string;
  captain_id: string;
  member_count?: number;
  joining_fee_pence?: number | null;
};

type JoinRequest = {
  id: string;
  player_id: string;
  status: string;
  profiles: { full_name: string; position: string } | null;
};

// Not exported: a Next.js page module may only export the default component
// and the framework's own config keys — anything else fails the type check.
const TEAM_TABS = ["match", "tactics", "stats", "members"] as const;
type TeamTab = (typeof TEAM_TABS)[number];

const TAB_LABEL: Record<TeamTab, string> = {
  match: "Manage Match",
  tactics: "Tactics",
  stats: "Stats",
  members: "Members",
};

// Circular icon slots in the same shape as components/QuickNav.tsx, so the two
// action rows on Home and My Team read as one vocabulary. Same four-fixed-slots
// rule too: every role sees all four, since a squad player can view each tab
// even where the controls inside are read-only.
const TAB_ICONS: Record<TeamTab, React.ReactNode> = {
  match: <><circle cx="12" cy="12" r="10" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /><path d="M2 12h20" /></>,
  tactics: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M12 5v14" /><circle cx="12" cy="12" r="3" /></>,
  stats: <><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></>,
  members: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
};

// ── Browse Teams (new users + players without a team) ─────────
function BrowseTeams({ onJoinRequest }: { onJoinRequest?: (teamId: string) => void }) {
  const { user } = useAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("All");

  useEffect(() => {
    supabase
      .from("teams")
      .select("*")
      .then(({ data }) => {
        setTeams(data ?? []);
        setLoading(false);
      });
  }, []);

  const handleRequest = async (teamId: string) => {
    if (!user) return;
    await supabase.from("team_members").insert({ team_id: teamId, player_id: user.id });
    setRequested((prev) => new Set([...prev, teamId]));
    onJoinRequest?.(teamId);
  };

  const filtered = filter === "All" ? teams : teams.filter((t) => t.level === filter);

  if (loading) return <div className="py-12 text-center text-sm text-text-secondary">Loading teams…</div>;

  return (
    <div className="space-y-4">
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input type="search" placeholder="Search teams or locations..." className="w-full bg-surface border border-border rounded-btn pl-9 pr-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/50" />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {["All", "Casual", "Competitive", "Semi-Pro"].map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${filter === f ? "bg-accent text-white border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>{f}</button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-sm text-text-secondary">No teams found yet.</p>
          <p className="text-xs text-text-secondary mt-1">Be the first to register one!</p>
        </div>
      )}

      {filtered.map((team) => (
        <div key={team.id} className="bg-surface border border-border shadow-card rounded-card p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-accent-ink">{team.name.split(" ").map((w: string) => w[0]).join("").slice(0,2)}</span>
              </div>
              <div>
                <p className="font-semibold">{team.name}</p>
                <p className="text-xs text-text-secondary mt-0.5">{team.location}</p>
              </div>
            </div>
            <span className={`text-xs font-medium px-2 py-1 rounded-lg flex-shrink-0 ${team.level === "Casual" ? "bg-blue-500/10 text-blue-600" : team.level === "Competitive" ? "bg-orange-500/10 text-orange-600" : "bg-purple-500/10 text-purple-600"}`}>{team.level}</span>
          </div>
          {team.description && <p className="text-xs text-text-secondary mb-3">{team.description}</p>}
          <div className="flex items-center gap-2 mb-4 text-xs text-text-secondary">
            <span className="bg-surface border border-border px-2 py-0.5 rounded-md">{team.format}</span>
            {/* Fee (or its absence) shown up front, so nobody discovers a
                charge only after their join request is approved. */}
            <span className="bg-surface border border-border px-2 py-0.5 rounded-md">
              {(team.joining_fee_pence ?? 0) > 0
                ? `${fmtFee(team.joining_fee_pence ?? 0)} joining fee`
                : "No joining fee"}
            </span>
          </div>
          <div className="flex gap-2">
            <button className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold text-center text-text-secondary">View Profile</button>
            <button
              disabled={requested.has(team.id)}
              onClick={() => handleRequest(team.id)}
              className="flex-1 py-2.5 rounded-btn bg-accent text-white text-sm font-bold disabled:opacity-60"
            >
              {requested.has(team.id) ? "Request Sent" : "Request to Join"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── New User My Team ──────────────────────────────────────────
function NewUserMyTeam() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <a href="/my-team/create"
          className="bg-accent text-white rounded-2xl p-4 flex flex-col gap-2">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <p className="text-sm font-bold">Register Your Team</p>
          <p className="text-xs font-normal opacity-70">Set up your team as captain</p>
        </a>
        <div className="bg-surface border border-border shadow-card rounded-card p-4 flex flex-col gap-2">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <p className="text-sm font-bold">Find a Team</p>
          <p className="text-xs text-text-secondary">Request to join below</p>
        </div>
      </div>
      <BrowseTeams />
    </div>
  );
}

// ── Join requests ─────────────────────────────────────────────
// Above the tabs, not inside one: an unanswered join request is an inbox item
// with someone waiting on the other end, and burying it behind a tab is how a
// player sits in limbo for a fortnight.
function JoinRequests({ teamId }: { teamId: string }) {
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("team_members")
      .select("id, player_id, status, profiles(full_name, position)")
      .eq("team_id", teamId)
      .eq("status", "pending")
      .then(({ data }) => setRequests((data ?? []) as unknown as JoinRequest[]));
  }, [teamId]);

  const handleRequest = async (requestId: string, status: "approved" | "rejected") => {
    setUpdatingId(requestId);
    await supabase.from("team_members").update({ status }).eq("id", requestId);
    setRequests((prev) => prev.filter((r) => r.id !== requestId));
    setUpdatingId(null);
  };

  if (requests.length === 0) return null;

  return (
    <section className="mb-5">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">Join Requests</h3>
        <span className="text-xs font-bold bg-accent text-white px-2 py-0.5 rounded-full">{requests.length}</span>
      </div>
      <div className="space-y-2">
        {requests.map((req) => (
          <div key={req.id} className="bg-surface border border-border shadow-card rounded-card px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-accent-ink">
                {req.profiles?.full_name?.split(" ").map((w) => w[0]).join("").slice(0,2) ?? "?"}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{req.profiles?.full_name ?? "Unknown player"}</p>
              <p className="text-xs text-text-secondary">{req.profiles?.position ?? "—"}</p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button disabled={updatingId === req.id} onClick={() => handleRequest(req.id, "rejected")}
                className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-secondary disabled:opacity-40">Decline</button>
              <button disabled={updatingId === req.id} onClick={() => handleRequest(req.id, "approved")}
                className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-bold disabled:opacity-40">Approve</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Team header card ──────────────────────────────────────────
function TeamHeaderCard({ team, isCaptain }: { team: Team; isCaptain: boolean }) {
  const initials = team.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2);
  return (
    <div className="bg-surface border border-border shadow-card rounded-card p-4 mb-5">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-[#E7F8EC] border border-[#B7E8C6] flex items-center justify-center flex-shrink-0">
          <span className="text-[15px] font-extrabold text-accent-ink">{initials}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-extrabold truncate">{team.name}</p>
          <p className="text-xs font-medium text-text-secondary truncate mt-0.5">
            {[team.location, team.level, team.format].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      {isCaptain && (
        <div className="flex gap-2 mt-3">
          {/* Inviting players is the thing a new captain came here to do, so it
              gets the filled button and its own row. The link itself lives in
              Team Settings alongside the joining fee — the two questions a
              captain answers about letting someone in. */}
          <a href="/my-team/settings#invite" className="w-full py-2.5 rounded-btn bg-accent text-white text-xs font-bold text-center">
            Invite Players
          </a>
        </div>
      )}
      {isCaptain && (
        <div className="flex gap-2 mt-2">
          <a href="/my-team/settings" className="flex-1 py-2.5 rounded-btn border border-border text-xs font-semibold text-text-secondary text-center">
            Team Settings
          </a>
          <a href="/my-team/announcement/create" className="flex-1 py-2.5 rounded-btn border border-border text-xs font-semibold text-text-secondary text-center">
            Post Announcement
          </a>
        </div>
      )}
    </div>
  );
}

// ── Team-scoped tab surface ───────────────────────────────────
function TeamTabs({ userId, isCaptain }: { userId: string; isCaptain: boolean }) {
  const [team, setTeam] = useState<Team | null | undefined>(undefined);
  const [tab, setTab] = useState<TeamTab>("match");

  // Read ?tab= after mount rather than during render. useSearchParams would
  // force a Suspense boundary around the whole page, and reading
  // window.location in a state initialiser would mismatch on hydration.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && (TEAM_TABS as readonly string[]).includes(t)) setTab(t as TeamTab);
  }, []);

  useEffect(() => {
    async function load() {
      if (isCaptain) {
        const { data } = await supabase.from("teams").select("*").eq("captain_id", userId).maybeSingle();
        setTeam(data ?? null);
        return;
      }
      const { data: mem } = await supabase
        .from("team_members").select("team_id")
        .eq("player_id", userId).eq("status", "approved").maybeSingle();
      if (!mem?.team_id) { setTeam(null); return; }
      const { data: t } = await supabase.from("teams").select("*").eq("id", mem.team_id).maybeSingle();
      setTeam(t ?? null);
    }
    load();
  }, [userId, isCaptain]);

  function selectTab(next: TeamTab) {
    setTab(next);
    // Keep the URL honest so a refresh or a back button lands on the same tab,
    // without a navigation that would remount and refetch everything.
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.toString());
  }

  if (team === undefined) {
    return <div className="py-12 flex justify-center"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;
  }

  if (team === null) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-surface-2 border border-border flex items-center justify-center">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="1.5" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <p className="font-semibold">No team registered yet</p>
        <p className="text-sm text-text-secondary max-w-[240px]">Register your team on Unitr to start finding opponents and managing your squad.</p>
        <a href="/my-team/create" className="px-6 py-3 rounded-btn bg-accent text-white font-bold text-sm">Register Your Team</a>
      </div>
    );
  }

  return (
    <>
      <TeamHeaderCard team={team} isCaptain={isCaptain} />
      {isCaptain && <JoinRequests teamId={team.id} />}

      <div className="flex justify-between gap-2 overflow-x-auto pb-2 mb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TEAM_TABS.map((t) => (
          <button key={t} type="button" onClick={() => selectTab(t)}
            aria-current={tab === t ? "page" : undefined}
            className="flex flex-col items-center gap-2 flex-1 min-w-[64px]">
            <span className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
              tab === t ? "bg-accent text-white" : "bg-surface border border-border text-text-secondary"}`}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {TAB_ICONS[t]}
              </svg>
            </span>
            <p className={`text-[11px] text-center leading-tight ${tab === t ? "font-bold text-text-primary" : "font-semibold text-text-secondary"}`}>
              {TAB_LABEL[t]}
            </p>
          </button>
        ))}
      </div>

      {tab === "match" && <ManageMatchTab teamId={team.id} userId={userId} isCaptain={isCaptain} />}
      {tab === "tactics" && <TacticsTab teamId={team.id} userId={userId} isCaptain={isCaptain} />}
      {tab === "stats" && <StatsTab teamId={team.id} userId={userId} isCaptain={isCaptain} />}
      {tab === "members" && <MembersTab teamId={team.id} userId={userId} isCaptain={isCaptain} />}
    </>
  );
}

// ── Team Announcement Banner ────────────────────────────────────
function TeamAnnouncementBanner({ userId, role }: { userId: string; role: "captain" | "player" }) {
  const [announcement, setAnnouncement] = useState<{ title: string | null; body: string; created_at: string; authorName: string } | null | undefined>(undefined);

  useEffect(() => {
    async function load() {
      let teamId: string | undefined;
      if (role === "captain") {
        const { data } = await supabase.from("teams").select("id").eq("captain_id", userId).maybeSingle();
        teamId = data?.id;
      } else {
        const { data: mem } = await supabase.from("team_members").select("team_id").eq("player_id", userId).eq("status", "approved").maybeSingle();
        teamId = mem?.team_id;
      }
      if (!teamId) { setAnnouncement(null); return; }

      const { data: latest } = await supabase.from("team_announcements")
        .select("title, body, created_at, captain_id").eq("team_id", teamId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();

      if (!latest) { setAnnouncement(null); return; }

      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      if (new Date(latest.created_at).getTime() < weekAgo) { setAnnouncement(null); return; }

      const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", latest.captain_id).maybeSingle();
      setAnnouncement({ title: latest.title, body: latest.body, created_at: latest.created_at, authorName: profile?.full_name ?? "Captain" });
    }
    load();
  }, [userId, role]);

  if (!announcement) return null;

  const diffMins = Math.floor((Date.now() - new Date(announcement.created_at).getTime()) / 60000);
  const timeAgo = diffMins < 1 ? "just now" : diffMins < 60 ? `${diffMins}m ago` : diffMins < 1440 ? `${Math.floor(diffMins / 60)}h ago` : `${Math.floor(diffMins / 1440)}d ago`;

  return (
    // Was a white callout standing out against the old near-black page. On the
    // light background white alone no longer separates it, so it takes the
    // rebrand's standard card treatment — border and shadow do the work.
    <div className="bg-surface border border-border shadow-card rounded-card p-4 mb-4">
      {announcement.title && <p className="text-sm font-bold text-text-primary mb-1">{announcement.title}</p>}
      <p className="text-sm text-text-primary whitespace-pre-wrap mb-1">{highlightMentions(announcement.body)}</p>
      <p className="text-[11px] text-text-secondary mb-3">— {announcement.authorName} · {timeAgo}</p>
      <a href="/my-team/announcements" className="flex items-center gap-1 text-xs text-accent-ink font-semibold underline">
        View previous announcements
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </a>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────
export default function MyTeamPage() {
  const { role, roleLoading } = useRole();
  const { user } = useAuth();
  if (roleLoading) return <div className="flex items-center justify-center min-h-screen"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;

  const inTeam = (role === "captain" || role === "player") && user;

  return (
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-24">
      <header className="mb-4">
        <h1 className="text-2xl font-extrabold mb-0.5">
          {role === "new_user" ? "Browse Teams" : "My Team"}
        </h1>
        <p className="text-text-secondary text-sm">
          {role === "new_user" ? "Find teams to become your next family"
          : role === "player" ? "Your squad, your next game"
          : "Run your squad and organise the next game"}
        </p>
      </header>

      {inTeam && <TeamAnnouncementBanner userId={user.id} role={role as "captain" | "player"} />}

      {role === "new_user" && !user && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <div className="w-16 h-16 rounded-full bg-surface-2 border border-border flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="1.5" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </div>
          <p className="text-sm font-semibold">No profile yet</p>
          <p className="text-xs text-text-secondary text-center max-w-[220px]">Create an account to build your player profile and track your stats.</p>
          <div className="flex gap-3">
            <a href="/register" className="px-6 py-3 rounded-btn bg-accent text-white font-bold text-sm">Create Account</a>
            <a href="/login" className="px-6 py-3 rounded-xl border border-border text-text-primary font-bold text-sm">Sign In</a>
          </div>
        </div>
      )}
      {role === "new_user" && user && <NewUserMyTeam />}
      {inTeam && <TeamTabs userId={user.id} isCaptain={role === "captain"} />}
    </div>
  );
}
