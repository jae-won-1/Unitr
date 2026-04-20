"use client";

import { useRole } from "@/contexts/RoleContext";

const stats = [
  { label: "Games", value: "47" },
  { label: "Goals", value: "23" },
  { label: "Assists", value: "31" },
  { label: "Rating", value: "8.7" },
];

const badges = [
  { label: "Hat-trick Hero", icon: "⚽" },
  { label: "Team Player", icon: "🤝" },
  { label: "Top Scorer", icon: "🏆" },
  { label: "Consistent", icon: "🔥" },
];

function ProfileContent({ isCaptain }: { isCaptain: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      {/* Avatar */}
      <section className="flex flex-col items-center">
        <div className="w-20 h-20 rounded-full bg-accent/10 border-2 border-accent flex items-center justify-center mb-3">
          <span className="text-2xl font-bold text-accent">JD</span>
        </div>
        <h2 className="text-xl font-bold">Jamie Dawson</h2>
        <p className="text-text-secondary text-sm mt-0.5">Attacking Midfielder · London</p>
        {isCaptain && (
          <span className="mt-2 text-xs font-semibold bg-accent/10 text-accent border border-accent/30 px-3 py-1 rounded-full">
            Captain — Hackney United
          </span>
        )}
        <div className="flex gap-2 mt-3 flex-wrap justify-center">
          <span className="text-xs bg-accent/10 text-accent border border-accent/30 px-3 py-1 rounded-full font-medium">CAM</span>
          <span className="text-xs bg-surface-2 text-text-secondary border border-border px-3 py-1 rounded-full font-medium">Right Foot</span>
          <span className="text-xs bg-surface-2 text-text-secondary border border-border px-3 py-1 rounded-full font-medium">6 years exp.</span>
        </div>
      </section>

      {/* Stats */}
      <section>
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Season Stats</h3>
        <div className="grid grid-cols-4 gap-2">
          {stats.map((s) => (
            <div key={s.label} className="bg-surface-2 border border-border rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-accent">{s.value}</p>
              <p className="text-[10px] text-text-secondary mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Badges */}
      <section>
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Badges</h3>
        <div className="grid grid-cols-2 gap-2">
          {badges.map((b) => (
            <div key={b.label} className="bg-surface-2 border border-border rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="text-xl">{b.icon}</span>
              <p className="text-sm font-medium">{b.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* My Stats */}
      <section>
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">My Stats</h3>
        <div className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
          {[
            { label: "Win Rate", value: "72%", bar: 72 },
            { label: "Goals Per Game", value: "0.49", bar: 49 },
            { label: "Pass Accuracy", value: "84%", bar: 84 },
          ].map((s) => (
            <div key={s.label}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-text-secondary">{s.label}</span>
                <span className="font-semibold">{s.value}</span>
              </div>
              <div className="w-full h-1.5 bg-background rounded-full">
                <div className="h-1.5 bg-accent rounded-full" style={{ width: `${s.bar}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Individual Highlights */}
      <section>
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Individual Highlights</h3>
        <div className="space-y-3">
          {[
            { id: "h1", title: "Goal vs Regents FC", match: "Feb 15, 2026 · 11v11", duration: "0:18", tag: "Goal" },
            { id: "h2", title: "Through-ball assist vs Dalston Athletic", match: "Jan 22, 2026 · League", duration: "0:24", tag: "Assist" },
            { id: "h3", title: "Man of the Match — vs East End FC", match: "Jan 8, 2026 · Friendly", duration: "1:02", tag: "MOTM" },
          ].map((clip) => (
            <div key={clip.id} className="bg-surface-2 border border-border rounded-2xl overflow-hidden">
              <div className="relative w-full" style={{ paddingBottom: "48%", background: "linear-gradient(135deg, #1a0a2e 0%, #2a1040 50%, #150820 100%)" }}>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-12 h-12 rounded-full bg-black/40 border border-white/20 flex items-center justify-center">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  </div>
                </div>
                <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded">{clip.duration}</div>
                <div className="absolute top-2 left-2">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${clip.tag === "Goal" ? "bg-red-500/80 text-white" : clip.tag === "Assist" ? "bg-blue-500/80 text-white" : "bg-accent/80 text-black"}`}>
                    {clip.tag}
                  </span>
                </div>
              </div>
              <div className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">{clip.title}</p>
                  <p className="text-xs text-text-secondary mt-0.5">{clip.match}</p>
                </div>
                <button className="text-xs text-accent font-medium flex items-center gap-1">
                  Share
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <button className="w-full py-3 rounded-xl border border-accent text-accent font-semibold text-sm">
        Edit Profile
      </button>

      {isCaptain && (
        <a href="/my-team" className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm text-center block">
          Manage My Team
        </a>
      )}
    </div>
  );
}

export default function ProfilePage() {
  const { role } = useRole();

  return (
    <div className="flex flex-col min-h-screen px-4 pt-12">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Profile</h1>
      </header>
      {role === "new_user" ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <div className="w-16 h-16 rounded-full bg-surface-2 border border-border flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="1.5" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </div>
          <p className="text-sm font-semibold">No profile yet</p>
          <p className="text-xs text-text-secondary text-center max-w-[220px]">Create an account to build your player profile and track your stats.</p>
          <a href="/register" className="px-6 py-3 rounded-xl bg-accent text-black font-bold text-sm">Create Account</a>
        </div>
      ) : (
        <ProfileContent isCaptain={role === "captain"} />
      )}
    </div>
  );
}
