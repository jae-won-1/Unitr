const players = [
  { name: "Marcus Webb", position: "GK", rating: 7.8, avatar: "MW" },
  { name: "Jordan Ellis", position: "CB", rating: 8.1, avatar: "JE" },
  { name: "Tyler Nash", position: "LB", rating: 7.5, avatar: "TN" },
  { name: "Ryan Scott", position: "CM", rating: 8.6, avatar: "RS" },
  { name: "Liam Foster", position: "CAM", rating: 9.0, avatar: "LF" },
  { name: "Devon King", position: "ST", rating: 8.3, avatar: "DK" },
];

export default function MyTeamPage() {
  return (
    <div className="flex flex-col min-h-screen px-4 pt-12">
      <header className="mb-8">
        <h1 className="text-2xl font-bold mb-1">My Team</h1>
        <p className="text-text-secondary text-sm">Manage your squad</p>
      </header>

      {/* Team card */}
      <section className="bg-surface-2 border border-border rounded-2xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-lg">FC Unitr Wolves</h2>
            <p className="text-xs text-text-secondary mt-0.5">Sunday League · Division 2</p>
          </div>
          <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center">
            <span className="text-accent font-bold text-sm">UW</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: "W", value: "8" },
            { label: "D", value: "2" },
            { label: "L", value: "3" },
          ].map((s) => (
            <div key={s.label} className="bg-background rounded-xl py-3">
              <p className="text-lg font-bold text-accent">{s.value}</p>
              <p className="text-xs text-text-secondary">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Squad */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
            Squad ({players.length})
          </h3>
          <button className="text-xs text-accent font-medium">+ Invite</button>
        </div>
        <div className="space-y-2">
          {players.map((player) => (
            <div
              key={player.name}
              className="bg-surface-2 border border-border rounded-xl px-4 py-3 flex items-center gap-3"
            >
              <div className="w-9 h-9 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-semibold text-text-secondary">{player.avatar}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{player.name}</p>
                <p className="text-xs text-text-secondary">{player.position}</p>
              </div>
              <span className="text-sm font-bold text-accent">{player.rating}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
