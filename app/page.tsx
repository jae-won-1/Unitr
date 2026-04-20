"use client";

import { useRole } from "@/contexts/RoleContext";

// ── Shared data ──────────────────────────────────────────────
const nearbyTeams = [
  { id: "hackney-united", name: "Hackney United", location: "Hackney Marshes", distance: "1.2 miles", rating: 4.8, members: 9, winRate: 72, record: { w: 13, d: 2, l: 3 }, level: "Competitive", description: "Established Sunday league side looking for passionate players." },
  { id: "east-end-fc", name: "East End FC", location: "Victoria Park", distance: "2.1 miles", rating: 4.6, members: 7, winRate: 58, record: { w: 9, d: 4, l: 5 }, level: "Casual", description: "Friendly 5-a-side team. All abilities welcome, good vibes only." },
  { id: "shoreditch-rovers", name: "Shoreditch Rovers", location: "Powerleague Shoreditch", distance: "3.4 miles", rating: 4.9, members: 14, winRate: 85, record: { w: 22, d: 1, l: 3 }, level: "Semi-Pro", description: "Semi-pro side competing in regional leagues." },
];

const fixtures = [
  { id: "match-1", opponent: "Regents FC", hostedBy: "Thunder Hawks", type: "match", date: "Feb 15, 2026", time: "14:00", location: "Central Park Field 3", rating: 4.9, players: { confirmed: 11, total: 11 }, status: "accepted", description: "Friendly 11v11 match. All skill levels welcome!" },
  { id: "match-2", opponent: "Dalston Athletic", hostedBy: "Hackney United", type: "league", date: "Feb 22, 2026", time: "11:00", location: "Hackney Marshes Pitch 4", rating: 4.7, players: { confirmed: 9, total: 11 }, status: "pending", description: "Sunday league fixture. Attendance is mandatory." },
  { id: "match-3", opponent: "Shoreditch Rovers", hostedBy: "East End FC", type: "tournament", date: "Mar 1, 2026", time: "09:00", location: "Victoria Park Arena", rating: 4.8, players: { confirmed: 7, total: 11 }, status: "accepted", description: "East London Cup — group stage. Arrive 30 mins early." },
];

const socialPosts = [
  {
    id: "post-1",
    type: "match_result",
    author: "Hackney United",
    avatar: "HU",
    time: "2h ago",
    content: "Full-time: Hackney United 3 – 1 East End FC",
    sub: "League · Hackney Marshes",
    stats: [{ label: "Goals", value: "3" }, { label: "Shots", value: "12" }, { label: "Possession", value: "61%" }],
  },
  {
    id: "post-2",
    type: "highlight",
    author: "Liam Foster",
    avatar: "LF",
    time: "3h ago",
    content: "Hat-trick goal vs East End FC — clinical finish from the CAM",
    sub: "Individual highlight · CAM",
    isVideo: true,
  },
  {
    id: "post-3",
    type: "tournament",
    author: "East London Cup",
    avatar: "EL",
    time: "5h ago",
    content: "East London Cup — Group Stage fixtures confirmed. 8 teams competing from Mar 1.",
    sub: "Tournament · Starts Mar 1, 2026",
    teams: ["Hackney United", "Shoreditch Rovers", "East End FC", "Dalston Athletic"],
  },
  {
    id: "post-4",
    type: "goal_moment",
    author: "Ryan Scott",
    avatar: "RS",
    time: "1d ago",
    content: "30-yard screamer vs Regents FC — top corner, no chance for the keeper",
    sub: "Goal moment · CM · Hackney United",
    isVideo: true,
  },
  {
    id: "post-5",
    type: "stats",
    author: "Shoreditch Rovers",
    avatar: "SR",
    time: "1d ago",
    content: "Season so far: 22W 1D 3L — top of Division 1 with 4 games to play.",
    sub: "Team stats update",
    stats: [{ label: "Win Rate", value: "85%" }, { label: "Goals", value: "67" }, { label: "Clean Sheets", value: "11" }],
  },
];

// ── Sub-components ───────────────────────────────────────────
function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-sm font-bold text-yellow-400">{rating}</span>
      {[1,2,3,4,5].map((i) => (
        <svg key={i} width="11" height="11" viewBox="0 0 24 24" fill={i <= Math.round(rating) ? "#FACC15" : "none"} stroke="#FACC15" strokeWidth="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
    </div>
  );
}

function TeamCard({ team }: { team: typeof nearbyTeams[0] }) {
  return (
    <a href={`/my-team/${team.id}`} className="block bg-surface-2 border border-border rounded-2xl p-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-bold text-accent">{team.name.split(" ").map((w) => w[0]).join("").slice(0,2)}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold truncate">{team.name}</p>
            <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />
          </div>
          <p className="text-xs text-text-secondary">{team.location} · {team.distance}</p>
        </div>
        <span className={`text-xs font-medium px-2 py-1 rounded-lg flex-shrink-0 ${team.level === "Casual" ? "bg-blue-500/10 text-blue-400" : team.level === "Competitive" ? "bg-orange-500/10 text-orange-400" : "bg-purple-500/10 text-purple-400"}`}>
          {team.level}
        </span>
      </div>
      <p className="text-xs text-text-secondary mb-2 line-clamp-1">{team.description}</p>
      <div className="flex items-center gap-3 text-xs text-text-secondary">
        <span>{team.members} members</span>
        <span className="text-yellow-400 font-medium">{team.winRate}% win rate</span>
        <span>{team.record.w}W · {team.record.d}D · {team.record.l}L</span>
      </div>
    </a>
  );
}

function FixtureCard({ fixture }: { fixture: typeof fixtures[0] }) {
  return (
    <div className="bg-white/5 border border-border rounded-2xl overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/></svg>
            </div>
            <div>
              <p className="font-semibold text-sm">vs {fixture.opponent}</p>
              <p className="text-xs text-text-secondary">Hosted by {fixture.hostedBy}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Stars rating={fixture.rating} />
            <span className="w-2 h-2 rounded-full bg-accent" />
          </div>
        </div>
        <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-md mb-2 ${fixture.type === "match" ? "bg-blue-500/10 text-blue-400" : fixture.type === "league" ? "bg-orange-500/10 text-orange-400" : "bg-purple-500/10 text-purple-400"}`}>
          {fixture.type}
        </span>
        <div className="space-y-1 mb-2">
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            {fixture.date}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            {fixture.time}
          </div>
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            {fixture.location}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-text-secondary truncate pr-3">{fixture.description}</p>
          <div className="flex items-center gap-1 text-xs flex-shrink-0">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span className={fixture.players.confirmed < fixture.players.total ? "text-red-400" : "text-text-secondary"}>
              {fixture.players.confirmed}/{fixture.players.total}
            </span>
          </div>
        </div>
      </div>
      <a href={`/match/${fixture.id}`} className="flex items-center justify-between px-4 py-3 bg-accent text-black font-semibold text-sm">
        <span>View Match Details</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </a>
    </div>
  );
}

function FeedPost({ post }: { post: typeof socialPosts[0] }) {
  const typeConfig: Record<string, { label: string; color: string }> = {
    match_result: { label: "Result", color: "bg-accent/10 text-accent" },
    highlight: { label: "Highlight", color: "bg-purple-500/10 text-purple-400" },
    goal_moment: { label: "Goal", color: "bg-red-500/10 text-red-400" },
    tournament: { label: "Tournament", color: "bg-orange-500/10 text-orange-400" },
    stats: { label: "Stats", color: "bg-blue-500/10 text-blue-400" },
  };
  const config = typeConfig[post.type] ?? { label: post.type, color: "bg-surface-2 text-text-secondary" };

  return (
    <div className="bg-surface-2 border border-border rounded-2xl p-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-bold text-accent">{post.avatar}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{post.author}</p>
          <p className="text-xs text-text-secondary">{post.sub}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${config.color}`}>{config.label}</span>
          <span className="text-[10px] text-text-secondary">{post.time}</span>
        </div>
      </div>

      {/* Video thumbnail placeholder */}
      {post.isVideo && (
        <div className="relative w-full rounded-xl overflow-hidden mb-3" style={{ paddingBottom: "52%", background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)" }}>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-black/40 border border-white/20 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </div>
          </div>
          <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded">0:32</div>
        </div>
      )}

      {/* Content */}
      <p className="text-sm text-text-primary mb-2">{post.content}</p>

      {/* Stats row */}
      {post.stats && (
        <div className="flex gap-3 mt-2">
          {post.stats.map((s) => (
            <div key={s.label} className="bg-background rounded-lg px-3 py-1.5 text-center">
              <p className="text-sm font-bold text-accent">{s.value}</p>
              <p className="text-[10px] text-text-secondary">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Teams list for tournament posts */}
      {post.teams && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {post.teams.map((t) => (
            <span key={t} className="text-[11px] bg-background text-text-secondary px-2 py-1 rounded-lg">{t}</span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-4 mt-3 pt-3 border-t border-border">
        <button className="flex items-center gap-1.5 text-xs text-text-secondary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          Like
        </button>
        <button className="flex items-center gap-1.5 text-xs text-text-secondary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Comment
        </button>
        <button className="flex items-center gap-1.5 text-xs text-text-secondary ml-auto">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          Share
        </button>
      </div>
    </div>
  );
}

// ── POV Views ────────────────────────────────────────────────
function NewUserHome() {
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl bg-surface-2 border border-border p-6 text-center">
        <p className="text-text-secondary text-sm mb-2">The football platform</p>
        <h2 className="text-2xl font-bold mb-1">Connect. Compete.</h2>
        <h2 className="text-2xl font-bold text-accent mb-3">Conquer Together.</h2>
        <p className="text-text-secondary text-sm mb-5">Find opponents, book pitches, and build your legacy.</p>
        <div className="flex gap-3">
          <a href="/register" className="flex-1 py-3 rounded-xl bg-accent text-black font-semibold text-sm text-center">Register</a>
          <a href="/login" className="flex-1 py-3 rounded-xl border border-border text-text-primary font-semibold text-sm text-center">Sign In</a>
        </div>
      </section>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-bold">Teams Near You</h3>
            <p className="text-xs text-text-secondary mt-0.5">Find a team to join</p>
          </div>
          <a href="/my-team" className="text-xs text-accent font-medium">See all</a>
        </div>
        <div className="space-y-3">
          {nearbyTeams.map((t) => <TeamCard key={t.id} team={t} />)}
        </div>
      </section>
    </div>
  );
}

function PlayerHome() {
  return (
    <div className="flex flex-col gap-6">

      {/* New match notification */}
      <a href="/play" className="flex items-center gap-3 bg-accent/10 border border-accent/30 rounded-2xl p-4">
        <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-accent">2 new matches near you</p>
          <p className="text-xs text-text-secondary mt-0.5 truncate">Posts matching your team's availability — tap to view</p>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </a>

      {/* Availability notification */}
      <a href="/my-team/availability" className="flex items-center gap-3 bg-orange-500/10 border border-orange-500/30 rounded-2xl p-4">
        <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center flex-shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FB923C" strokeWidth="2" strokeLinecap="round">
            <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-orange-400">Action needed</p>
          <p className="text-xs text-text-secondary mt-0.5 truncate">Captain wants your availability for the next match</p>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </a>

      {/* Next fixture */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-bold">Next Fixture</h3>
            <p className="text-xs text-text-secondary mt-0.5">{fixtures[0].date} · {fixtures[0].time}</p>
          </div>
          <a href="/my-team" className="text-xs text-accent font-medium">All fixtures</a>
        </div>
        <FixtureCard fixture={fixtures[0]} />
      </section>

      {/* Social feed */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-bold">Your Area</h3>
            <p className="text-xs text-text-secondary mt-0.5">Results, highlights &amp; local news</p>
          </div>
        </div>
        <div className="space-y-3">
          {socialPosts.map((p) => <FeedPost key={p.id} post={p} />)}
        </div>
      </section>
    </div>
  );
}

function CaptainHome() {
  return (
    <div className="flex flex-col gap-6">

      {/* New match notification */}
      <a href="/play" className="flex items-center gap-3 bg-accent/10 border border-accent/30 rounded-2xl p-4">
        <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-accent">2 new matches near you</p>
          <p className="text-xs text-text-secondary mt-0.5 truncate">Posts matching your team's availability — tap to challenge</p>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </a>

      {/* Quick actions */}
      <section>
        <h3 className="font-bold mb-3">Quick Actions</h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Collect Availability", icon: "📅", href: "/my-team/availability" },
            { label: "Post a Match", icon: "⚽", href: "/play/create" },
            { label: "Scout Players", icon: "🔍", href: "/my-team/transfer" },
            { label: "Team Messages", icon: "💬", href: "/messages" },
          ].map((action) => (
            <a key={action.label} href={action.href} className="bg-surface-2 border border-border rounded-xl p-4 flex flex-col gap-2">
              <span className="text-2xl">{action.icon}</span>
              <p className="text-sm font-semibold">{action.label}</p>
            </a>
          ))}
        </div>
      </section>

      {/* Next fixture */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-bold">Next Fixture</h3>
            <p className="text-xs text-text-secondary mt-0.5">{fixtures[0].date} · {fixtures[0].time}</p>
          </div>
          <a href="/my-team" className="text-xs text-accent font-medium">All fixtures</a>
        </div>
        <FixtureCard fixture={fixtures[0]} />
      </section>

      {/* Social feed */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-bold">Your Area</h3>
            <p className="text-xs text-text-secondary mt-0.5">Results, highlights &amp; local news</p>
          </div>
        </div>
        <div className="space-y-3">
          {socialPosts.map((p) => <FeedPost key={p.id} post={p} />)}
        </div>
      </section>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────
export default function HomePage() {
  const { role } = useRole();

  return (
    <div className="flex flex-col min-h-screen px-4 pt-12">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Unitr<span className="text-accent">.</span></h1>
        <div className="w-9 h-9 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center">
          <span className="text-xs font-bold text-accent">{role === "new_user" ? "?" : "JD"}</span>
        </div>
      </header>
      {role === "new_user" && <NewUserHome />}
      {role === "player" && <PlayerHome />}
      {role === "captain" && <CaptainHome />}
    </div>
  );
}
