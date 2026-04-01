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

export default function ProfilePage() {
  return (
    <div className="flex flex-col min-h-screen px-4 pt-12">
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Profile</h1>
        <button className="w-9 h-9 rounded-full bg-surface-2 border border-border flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
        </button>
      </header>

      {/* Profile card */}
      <section className="flex flex-col items-center mb-8">
        <div className="w-20 h-20 rounded-full bg-accent/10 border-2 border-accent flex items-center justify-center mb-3">
          <span className="text-2xl font-bold text-accent">JD</span>
        </div>
        <h2 className="text-xl font-bold">Jamie Dawson</h2>
        <p className="text-text-secondary text-sm mt-0.5">Attacking Midfielder · London</p>
        <div className="flex gap-2 mt-3">
          <span className="text-xs bg-accent/10 text-accent border border-accent/30 px-3 py-1 rounded-full font-medium">
            CAM
          </span>
          <span className="text-xs bg-surface-2 text-text-secondary border border-border px-3 py-1 rounded-full font-medium">
            Right Foot
          </span>
          <span className="text-xs bg-surface-2 text-text-secondary border border-border px-3 py-1 rounded-full font-medium">
            6 years exp.
          </span>
        </div>
      </section>

      {/* Stats */}
      <section className="mb-6">
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
          Season Stats
        </h3>
        <div className="grid grid-cols-4 gap-2">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="bg-surface-2 border border-border rounded-xl p-3 text-center"
            >
              <p className="text-lg font-bold text-accent">{stat.value}</p>
              <p className="text-[10px] text-text-secondary mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Badges */}
      <section className="mb-6">
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
          Badges
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {badges.map((badge) => (
            <div
              key={badge.label}
              className="bg-surface-2 border border-border rounded-xl px-4 py-3 flex items-center gap-3"
            >
              <span className="text-xl">{badge.icon}</span>
              <p className="text-sm font-medium">{badge.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Edit profile */}
      <button className="w-full py-3 rounded-xl border border-accent text-accent font-semibold text-sm mb-4">
        Edit Profile
      </button>
    </div>
  );
}
