export default function PlayPage() {
  const games = [
    { title: "5-a-side", location: "Hackney Marshes", time: "Today, 6:00 PM", players: "8/10", level: "Casual" },
    { title: "7-a-side", location: "Victoria Park", time: "Sat, 10:00 AM", players: "11/14", level: "Competitive" },
    { title: "11-a-side", location: "Wembley Arena Pitches", time: "Sun, 2:00 PM", players: "16/22", level: "Semi-Pro" },
    { title: "5-a-side", location: "Powerleague Shoreditch", time: "Mon, 8:00 PM", players: "4/10", level: "Casual" },
  ];

  return (
    <div className="flex flex-col min-h-screen px-4 pt-12">
      <header className="mb-8">
        <h1 className="text-2xl font-bold mb-1">Play</h1>
        <p className="text-text-secondary text-sm">Find and join games near you</p>
      </header>

      {/* Filter chips */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-none">
        {["All", "5-a-side", "7-a-side", "11-a-side", "Tonight", "This Week"].map(
          (filter, i) => (
            <button
              key={filter}
              className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium border ${
                i === 0
                  ? "bg-accent text-black border-accent"
                  : "bg-surface-2 text-text-secondary border-border"
              }`}
            >
              {filter}
            </button>
          )
        )}
      </div>

      {/* Game list */}
      <div className="space-y-3">
        {games.map((game) => (
          <div
            key={`${game.title}-${game.location}`}
            className="bg-surface-2 border border-border rounded-2xl p-4"
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="font-semibold">{game.title}</p>
                <p className="text-xs text-text-secondary mt-0.5">{game.location}</p>
              </div>
              <span
                className={`text-xs font-medium px-2 py-1 rounded-lg ${
                  game.level === "Casual"
                    ? "bg-blue-500/10 text-blue-400"
                    : game.level === "Competitive"
                    ? "bg-orange-500/10 text-orange-400"
                    : "bg-purple-500/10 text-purple-400"
                }`}
              >
                {game.level}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex gap-4">
                <span className="text-xs text-text-secondary">{game.time}</span>
                <span className="text-xs text-text-secondary">{game.players} players</span>
              </div>
              <button className="text-xs font-semibold text-accent">Join</button>
            </div>
          </div>
        ))}
      </div>

      {/* FAB */}
      <button className="fixed bottom-24 right-4 w-14 h-14 rounded-full bg-accent text-black flex items-center justify-center shadow-lg shadow-accent/30">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}
