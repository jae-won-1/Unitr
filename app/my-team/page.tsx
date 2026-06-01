"use client";

import { useEffect, useState } from "react";
import { useRole } from "@/contexts/RoleContext";
import { useTactics } from "@/contexts/TacticsContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type Team = {
  id: string;
  name: string;
  location: string;
  level: string;
  format: string;
  description: string;
  captain_id: string;
  member_count?: number;
};

type JoinRequest = {
  id: string;
  player_id: string;
  status: string;
  profiles: { full_name: string; position: string } | null;
};

// ── Shared dummy squad (still hardcoded — matches backend coming later) ──
const squad = [
  { name: "Marcus Webb", position: "GK", rating: 7.8, avatar: "MW" },
  { name: "Jordan Ellis", position: "CB", rating: 8.1, avatar: "JE" },
  { name: "Tyler Nash", position: "LB", rating: 7.5, avatar: "TN" },
  { name: "Ryan Scott", position: "CM", rating: 8.6, avatar: "RS" },
  { name: "Liam Foster", position: "CAM", rating: 9.0, avatar: "LF" },
  { name: "Devon King", position: "ST", rating: 8.3, avatar: "DK" },
];

const formationDots: Record<string, { x: string; y: string }[]> = {
  "4-3-3": [
    { x: "50%", y: "88%" },
    { x: "15%", y: "72%" }, { x: "35%", y: "74%" }, { x: "65%", y: "74%" }, { x: "85%", y: "72%" },
    { x: "25%", y: "52%" }, { x: "50%", y: "50%" }, { x: "75%", y: "52%" },
    { x: "20%", y: "25%" }, { x: "50%", y: "20%" }, { x: "80%", y: "25%" },
  ],
  "4-4-2": [
    { x: "50%", y: "88%" },
    { x: "15%", y: "72%" }, { x: "35%", y: "74%" }, { x: "65%", y: "74%" }, { x: "85%", y: "72%" },
    { x: "15%", y: "50%" }, { x: "35%", y: "50%" }, { x: "65%", y: "50%" }, { x: "85%", y: "50%" },
    { x: "35%", y: "22%" }, { x: "65%", y: "22%" },
  ],
  "3-5-2": [
    { x: "50%", y: "88%" },
    { x: "25%", y: "72%" }, { x: "50%", y: "74%" }, { x: "75%", y: "72%" },
    { x: "10%", y: "52%" }, { x: "30%", y: "50%" }, { x: "50%", y: "55%" }, { x: "70%", y: "50%" }, { x: "90%", y: "52%" },
    { x: "35%", y: "22%" }, { x: "65%", y: "22%" },
  ],
  "4-2-3-1": [
    { x: "50%", y: "88%" },
    { x: "15%", y: "72%" }, { x: "35%", y: "74%" }, { x: "65%", y: "74%" }, { x: "85%", y: "72%" },
    { x: "35%", y: "58%" }, { x: "65%", y: "58%" },
    { x: "18%", y: "38%" }, { x: "50%", y: "36%" }, { x: "82%", y: "38%" },
    { x: "50%", y: "18%" },
  ],
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
        <input type="search" placeholder="Search teams or locations..." className="w-full bg-surface-2 border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/50" />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {["All", "Casual", "Competitive", "Semi-Pro"].map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${filter === f ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>{f}</button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-sm text-text-secondary">No teams found yet.</p>
          <p className="text-xs text-text-secondary mt-1">Be the first to register one!</p>
        </div>
      )}

      {filtered.map((team) => (
        <div key={team.id} className="bg-surface-2 border border-border rounded-2xl p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-accent">{team.name.split(" ").map((w: string) => w[0]).join("").slice(0,2)}</span>
              </div>
              <div>
                <p className="font-semibold">{team.name}</p>
                <p className="text-xs text-text-secondary mt-0.5">{team.location}</p>
              </div>
            </div>
            <span className={`text-xs font-medium px-2 py-1 rounded-lg flex-shrink-0 ${team.level === "Casual" ? "bg-blue-500/10 text-blue-400" : team.level === "Competitive" ? "bg-orange-500/10 text-orange-400" : "bg-purple-500/10 text-purple-400"}`}>{team.level}</span>
          </div>
          {team.description && <p className="text-xs text-text-secondary mb-3">{team.description}</p>}
          <div className="flex items-center gap-2 mb-4 text-xs text-text-secondary">
            <span className="bg-surface border border-border px-2 py-0.5 rounded-md">{team.format}</span>
          </div>
          <div className="flex gap-2">
            <button className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold text-center text-text-secondary">View Profile</button>
            <button
              disabled={requested.has(team.id)}
              onClick={() => handleRequest(team.id)}
              className="flex-1 py-2.5 rounded-xl bg-accent text-black text-sm font-bold disabled:opacity-60"
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
          className="bg-accent text-black rounded-2xl p-4 flex flex-col gap-2">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <p className="text-sm font-bold">Register Your Team</p>
          <p className="text-xs font-normal opacity-70">Set up your team as captain</p>
        </a>
        <div className="bg-surface-2 border border-border rounded-2xl p-4 flex flex-col gap-2">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <p className="text-sm font-bold">Find a Team</p>
          <p className="text-xs text-text-secondary">Request to join below</p>
        </div>
      </div>
      <BrowseTeams />
    </div>
  );
}

// ── Player My Team ────────────────────────────────────────────
function PlayerMyTeam() {
  const { tactics } = useTactics();
  const { user } = useAuth();
  const dots = formationDots[tactics.formation] ?? formationDots["4-3-3"];
  const teamMedia = tactics.media.filter((m) => !m.matchId);
  const [myTeam, setMyTeam] = useState<Team | null | undefined>(undefined);

  useEffect(() => {
    if (!user) return;
    // Check if player is an approved member of any team
    supabase
      .from("team_members")
      .select("team_id, teams(*)")
      .eq("player_id", user.id)
      .eq("status", "approved")
      .maybeSingle()
      .then(({ data }) => {
        setMyTeam(data ? (data.teams as unknown as Team) : null);
      });
  }, [user]);

  if (myTeam === undefined) return <div className="py-12 text-center text-sm text-text-secondary">Loading…</div>;

  if (myTeam === null) {
    return (
      <div className="space-y-4">
        <div className="bg-surface-2 border border-border rounded-2xl p-6 text-center">
          <p className="font-semibold mb-1">You're not in a team yet</p>
          <p className="text-xs text-text-secondary mb-4">Request to join a team below or wait for a captain to approve your request.</p>
        </div>
        <BrowseTeams />
      </div>
    );
  }

  const initials = myTeam.name.split(" ").map((w: string) => w[0]).join("").slice(0,2);

  return (
    <div className="space-y-6">
      {/* Team card */}
      <section className="bg-surface-2 border border-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-lg">{myTeam.name}</h2>
            <p className="text-xs text-text-secondary mt-0.5">{myTeam.level} · {myTeam.format}</p>
          </div>
          <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center">
            <span className="text-accent font-bold text-sm">{initials}</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[{ label: "W", value: "13" }, { label: "D", value: "2" }, { label: "L", value: "3" }].map((s) => (
            <div key={s.label} className="bg-background rounded-xl py-3">
              <p className="text-lg font-bold text-accent">{s.value}</p>
              <p className="text-xs text-text-secondary">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Upcoming fixtures */}
      <section>
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Upcoming Fixtures</h3>
        <div className="space-y-3">
          {[
            { id: "match-1", opponent: "Regents FC", date: "Feb 15, 2026", time: "14:00", location: "Central Park Field 3", status: "confirmed" },
            { id: "match-2", opponent: "Dalston Athletic", date: "Feb 22, 2026", time: "11:00", location: "Hackney Marshes Pitch 4", status: "pending" },
          ].map((match) => (
            <a key={match.id} href={`/match/${match.id}`} className="block bg-surface-2 border border-border rounded-2xl p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-semibold text-sm">vs {match.opponent}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-text-secondary">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                    {match.date} · {match.time}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-text-secondary">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    {match.location}
                  </div>
                </div>
                <span className={`text-xs font-semibold px-2 py-1 rounded-full flex-shrink-0 ${match.status === "confirmed" ? "bg-accent/15 text-accent" : "bg-yellow-400/15 text-yellow-400"}`}>
                  {match.status}
                </span>
              </div>
              <div className="flex items-center gap-1 text-xs text-accent mt-2 font-medium">
                View details
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* Team Tactics */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">Team Tactics</h3>
          <span className="text-xs text-text-secondary">Set by captain</span>
        </div>
        <div className="bg-surface-2 border border-border rounded-2xl p-4">
          <div className="relative w-full rounded-xl overflow-hidden mb-4" style={{ paddingBottom: "60%", background: "linear-gradient(180deg, #1a5c1a 0%, #1e6b1e 50%, #1a5c1a 100%)" }}>
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 60" preserveAspectRatio="none">
              <rect x="3" y="3" width="94" height="54" rx="1" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="0.6"/>
              <line x1="3" y1="30" x2="97" y2="30" stroke="rgba(255,255,255,0.35)" strokeWidth="0.6"/>
              <circle cx="50" cy="30" r="8" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="0.6"/>
              <rect x="20" y="3" width="60" height="14" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="0.6"/>
              <rect x="20" y="43" width="60" height="14" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="0.6"/>
            </svg>
            {dots.map((pos, i) => (
              <div key={i} className="absolute w-4 h-4 rounded-full bg-accent border border-white shadow" style={{ left: pos.x, top: pos.y, transform: "translate(-50%,-50%)" }} />
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <span className="text-lg font-bold">{tactics.formation}</span>
            {tactics.style && <span className="text-xs bg-accent/10 text-accent border border-accent/30 px-2 py-1 rounded-lg font-semibold">{tactics.style}</span>}
            {tactics.pressing && <span className="text-xs bg-surface border border-border px-2 py-1 rounded-lg text-text-secondary">{tactics.pressing} Press</span>}
          </div>
          {tactics.notes && (
            <div className="bg-background rounded-xl p-3 mb-3">
              <p className="text-xs font-semibold text-text-secondary mb-1">Captain's Notes</p>
              <p className="text-xs text-text-secondary leading-relaxed">{tactics.notes}</p>
            </div>
          )}
          {teamMedia.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-text-secondary mb-2">Tactics Media</p>
              <div className="space-y-2">
                {teamMedia.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 bg-background rounded-xl px-3 py-2.5">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${item.type === "video" ? "bg-purple-500/15" : "bg-blue-500/15"}`}>
                      {item.type === "video"
                        ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2" strokeLinecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>}
                    </div>
                    <p className="text-xs font-medium flex-1 truncate">{item.label}</p>
                    <span className="text-[10px] text-text-secondary capitalize">{item.type}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Match Media */}
      <section>
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Match Media</h3>
        <div className="space-y-3">
          {[
            { id: "v1", title: "Full Match — vs Regents FC", date: "Feb 15, 2026", duration: "1:32:10", type: "full" },
            { id: "v2", title: "Highlights — vs Regents FC", date: "Feb 15, 2026", duration: "4:22", type: "highlights" },
          ].map((video) => (
            <div key={video.id} className="bg-surface-2 border border-border rounded-2xl overflow-hidden">
              <div className="relative w-full" style={{ paddingBottom: "52%", background: "linear-gradient(135deg, #0d1b2a 0%, #1b2a3b 50%, #0a1628 100%)" }}>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-12 h-12 rounded-full bg-black/40 border border-white/20 flex items-center justify-center">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  </div>
                </div>
                <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded">{video.duration}</div>
                <div className="absolute top-2 left-2">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${video.type === "full" ? "bg-blue-500/80 text-white" : "bg-purple-500/80 text-white"}`}>
                    {video.type === "full" ? "Full Match" : "Highlights"}
                  </span>
                </div>
              </div>
              <div className="px-4 py-3">
                <p className="text-sm font-semibold">{video.title}</p>
                <p className="text-xs text-text-secondary mt-0.5">{video.date}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Squad */}
      <section>
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Squad ({squad.length})</h3>
        <div className="space-y-2">
          {squad.map((p) => (
            <div key={p.name} className="bg-surface-2 border border-border rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-semibold text-text-secondary">{p.avatar}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{p.name}</p>
                <p className="text-xs text-text-secondary">{p.position}</p>
              </div>
              <span className="text-sm font-bold text-accent">{p.rating}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

type ConfirmedFixture = {
  postId: string;
  opponent: string;
  date: string;
  time: string;
  pitch: string;
};

// ── Captain My Team ───────────────────────────────────────────
function CaptainMyTeam() {
  const { user } = useAuth();
  const [myTeam, setMyTeam] = useState<Team | null | undefined>(undefined);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [fixtures, setFixtures] = useState<ConfirmedFixture[]>([]);
  const [fixturesLoading, setFixturesLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase.from("teams").select("*").eq("captain_id", user.id).maybeSingle()
      .then(({ data }) => setMyTeam(data ?? null));
  }, [user]);

  useEffect(() => {
    if (!myTeam) return;
    supabase.from("team_members").select("id, player_id, status, profiles(full_name, position)")
      .eq("team_id", myTeam.id).eq("status", "pending")
      .then(({ data }) => setRequests((data as unknown as JoinRequest[]) ?? []));
  }, [myTeam]);

  useEffect(() => {
    if (!user) return;
    async function loadFixtures() {
      // Matches where user is the poster
      const { data: myPosts } = await supabase.from("match_posts")
        .select("id, match_date, match_time").eq("captain_id", user!.id).eq("status", "matched");

      const posterFixtures: ConfirmedFixture[] = await Promise.all(
        (myPosts ?? []).map(async (post) => {
          const { data: ch } = await supabase.from("challenges")
            .select("challenger_team_name, selected_pitch").eq("post_id", post.id).eq("status", "accepted").maybeSingle();
          return {
            postId: post.id,
            opponent: (ch as { challenger_team_name: string } | null)?.challenger_team_name ?? "Unknown",
            date: post.match_date,
            time: post.match_time,
            pitch: ((ch as { selected_pitch?: { name: string } } | null)?.selected_pitch?.name) ?? "TBC",
          };
        })
      );

      // Matches where user challenged
      const { data: myChallenges } = await supabase.from("challenges")
        .select("post_id, selected_pitch").eq("challenger_captain_id", user!.id).eq("status", "accepted");

      const challengerFixtures: ConfirmedFixture[] = await Promise.all(
        (myChallenges ?? []).map(async (c) => {
          const { data: post } = await supabase.from("match_posts")
            .select("id, team_name, match_date, match_time").eq("id", c.post_id).maybeSingle();
          return {
            postId: c.post_id,
            opponent: (post as { team_name: string } | null)?.team_name ?? "Unknown",
            date: (post as { match_date: string } | null)?.match_date ?? "",
            time: (post as { match_time: string } | null)?.match_time ?? "",
            pitch: (c.selected_pitch as { name: string } | null)?.name ?? "TBC",
          };
        })
      );

      setFixtures([...posterFixtures, ...challengerFixtures]);
      setFixturesLoading(false);
    }
    loadFixtures();
  }, [user]);

  const handleRequest = async (requestId: string, status: "approved" | "rejected") => {
    setUpdatingId(requestId);
    await supabase.from("team_members").update({ status }).eq("id", requestId);
    setRequests((prev) => prev.filter((r) => r.id !== requestId));
    setUpdatingId(null);
  };

  if (myTeam === undefined) return <div className="py-12 text-center text-sm text-text-secondary">Loading…</div>;

  if (myTeam === null) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-surface-2 border border-border flex items-center justify-center">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="1.5" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <p className="font-semibold">No team registered yet</p>
        <p className="text-sm text-text-secondary max-w-[240px]">Register your team on Unitr to start finding opponents and managing your squad.</p>
        <a href="/my-team/create" className="px-6 py-3 rounded-xl bg-accent text-black font-bold text-sm">Register Your Team</a>
      </div>
    );
  }

  const initials = myTeam.name.split(" ").map((w: string) => w[0]).join("").slice(0,2);

  return (
    <div className="space-y-5">
      {/* Team card */}
      <section className="bg-surface-2 border border-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-lg">{myTeam.name}</h2>
            <p className="text-xs text-text-secondary mt-0.5">{myTeam.level} · {myTeam.format} · Captain</p>
          </div>
          <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center">
            <span className="text-accent font-bold text-sm">{initials}</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center mb-4">
          {[{ label: "W", value: "0" }, { label: "D", value: "0" }, { label: "L", value: "0" }].map((s) => (
            <div key={s.label} className="bg-background rounded-xl py-3">
              <p className="text-lg font-bold text-accent">{s.value}</p>
              <p className="text-xs text-text-secondary">{s.label}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <a href="/my-team/availability" className="py-2.5 rounded-xl border border-accent/40 text-accent text-sm font-semibold text-center">Collect Availability</a>
          <a href="/play/create" className="py-2.5 rounded-xl bg-accent text-black text-sm font-bold text-center">Post a Match</a>
        </div>
      </section>

      {/* Confirmed fixtures */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">Upcoming Fixtures</h3>
          {fixtures.length > 0 && <span className="text-xs font-bold bg-accent text-black px-2 py-0.5 rounded-full">{fixtures.length}</span>}
        </div>
        {fixturesLoading ? (
          <div className="py-4 text-center"><div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" /></div>
        ) : fixtures.length === 0 ? (
          <p className="text-sm text-text-secondary py-2">No confirmed fixtures yet.</p>
        ) : (
          <div className="space-y-2">
            {fixtures.map((f) => (
              <a key={f.postId} href={`/my-team/match/${f.postId}`} className="block bg-surface-2 border border-border rounded-2xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-semibold text-sm">vs {f.opponent}</p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-text-secondary">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                      {f.date} · {f.time}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-text-secondary">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                      {f.pitch}
                    </div>
                  </div>
                  <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/30 px-2 py-0.5 rounded-full flex-shrink-0">Confirmed</span>
                </div>
                <div className="flex items-center gap-1 text-xs text-accent font-medium mt-1">
                  Manage Match
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                </div>
              </a>
            ))}
          </div>
        )}
      </section>

      {/* Join requests */}
      {requests.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">Join Requests</h3>
            <span className="text-xs font-bold bg-accent text-black px-2 py-0.5 rounded-full">{requests.length}</span>
          </div>
          <div className="space-y-2">
            {requests.map((req) => (
              <div key={req.id} className="bg-surface-2 border border-border rounded-2xl px-4 py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-accent">
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
                    className="px-3 py-1.5 rounded-lg bg-accent text-black text-xs font-bold disabled:opacity-40">Approve</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Captain actions */}
      <section>
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Manage</h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Tactics Board", icon: "🗂️", href: "/my-team/tactics" },
            { label: "Transfer Window", icon: "🔄", href: "/my-team/transfer" },
            { label: "Players", icon: "👥", href: "/my-team/players" },
            { label: "Settings", icon: "⚙️", href: "#" },
          ].map((a) => (
            <a key={a.label} href={a.href} className="bg-surface-2 border border-border rounded-xl p-4 flex flex-col gap-2">
              <span className="text-2xl">{a.icon}</span>
              <p className="text-sm font-semibold">{a.label}</p>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────
export default function MyTeamPage() {
  const { role, roleLoading } = useRole();
  if (roleLoading) return <div className="flex items-center justify-center min-h-screen"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;

  return (
    <div className="flex flex-col min-h-screen px-4 pt-12 pb-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold mb-1">
          {role === "new_user" ? "Browse Teams" : "My Team"}
        </h1>
        <p className="text-text-secondary text-sm">
          {role === "new_user" ? "Find teams to become your next family"
          : role === "player" ? "Your squad and performance"
          : "Manage your squad and organise matches"}
        </p>
      </header>
      {role === "new_user" && <NewUserMyTeam />}
      {role === "player" && <PlayerMyTeam />}
      {role === "captain" && <CaptainMyTeam />}
    </div>
  );
}
