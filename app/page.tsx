export default function HomePage() {
  return (
    <div className="flex flex-col min-h-screen px-4 pt-12">
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold tracking-tight">
          Unitr<span className="text-accent">.</span>
        </h1>
        <div className="w-9 h-9 rounded-full bg-surface-2 border border-border" />
      </header>

      {/* Hero */}
      <section className="rounded-2xl bg-surface-2 border border-border p-6 mb-6">
        <p className="text-text-secondary text-sm mb-1">Welcome back</p>
        <h2 className="text-xl font-semibold mb-4">Find your next game</h2>
        <button className="w-full py-3 rounded-xl bg-accent text-black font-semibold text-sm">
          Browse Games
        </button>
      </section>

      {/* Quick Stats */}
      <section className="mb-6">
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
          Your Stats
        </h3>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Games", value: "12" },
            { label: "Goals", value: "7" },
            { label: "Rating", value: "8.4" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-surface-2 border border-border rounded-xl p-4 text-center"
            >
              <p className="text-xl font-bold text-accent">{stat.value}</p>
              <p className="text-xs text-text-secondary mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Nearby Games */}
      <section>
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
          Nearby Games
        </h3>
        <div className="space-y-3">
          {[
            { title: "5-a-side at Hackney Marshes", time: "Today, 6:00 PM", spots: 2 },
            { title: "7-a-side League Match", time: "Tomorrow, 10:00 AM", spots: 5 },
          ].map((game) => (
            <div
              key={game.title}
              className="bg-surface-2 border border-border rounded-xl p-4 flex items-center justify-between"
            >
              <div>
                <p className="text-sm font-medium">{game.title}</p>
                <p className="text-xs text-text-secondary mt-0.5">{game.time}</p>
              </div>
              <span className="text-xs text-accent font-semibold bg-accent/10 px-2 py-1 rounded-lg">
                {game.spots} spots
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
