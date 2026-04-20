const teamData: Record<string, {
  name: string; location: string; distance: string; rating: number;
  members: number; winRate: number; record: { w: number; d: number; l: number };
  level: string; description: string; founded: string; league: string;
  trainingDays: string; openPositions: string[];
  players: { name: string; position: string; rating: number; avatar: string }[];
  recentResults: { opponent: string; score: string; result: "W" | "D" | "L" }[];
}> = {
  "hackney-united": {
    name: "Hackney United",
    location: "Hackney Marshes, London",
    distance: "1.2 miles",
    rating: 4.8,
    members: 9,
    winRate: 72,
    record: { w: 13, d: 2, l: 3 },
    level: "Competitive",
    description: "Established Sunday league side looking for passionate players to strengthen the squad. We train hard and play harder — but always with respect for the game.",
    founded: "2018",
    league: "East London Sunday League – Div 1",
    trainingDays: "Thursdays, 7:00 PM",
    openPositions: ["GK", "CB", "RW"],
    players: [
      { name: "Marcus Webb", position: "GK", rating: 7.8, avatar: "MW" },
      { name: "Jordan Ellis", position: "CB", rating: 8.1, avatar: "JE" },
      { name: "Ryan Scott", position: "CM", rating: 8.6, avatar: "RS" },
      { name: "Liam Foster", position: "ST", rating: 9.0, avatar: "LF" },
    ],
    recentResults: [
      { opponent: "Dalston Athletic", score: "3–1", result: "W" },
      { opponent: "Bow City FC", score: "2–2", result: "D" },
      { opponent: "Shoreditch Rovers", score: "1–2", result: "L" },
    ],
  },
  "east-end-fc": {
    name: "East End FC",
    location: "Victoria Park, London",
    distance: "2.1 miles",
    rating: 4.6,
    members: 7,
    winRate: 58,
    record: { w: 9, d: 4, l: 5 },
    level: "Casual",
    description: "Friendly 5-a-side team that plays weekly. All abilities welcome, good vibes only.",
    founded: "2021",
    league: "Casual 5-a-side League",
    trainingDays: "Sundays, 10:00 AM",
    openPositions: ["CM", "ST", "LB"],
    players: [
      { name: "Tyler Nash", position: "LB", rating: 7.5, avatar: "TN" },
      { name: "Devon King", position: "ST", rating: 8.3, avatar: "DK" },
    ],
    recentResults: [
      { opponent: "Bow City FC", score: "4–2", result: "W" },
      { opponent: "Hackney United", score: "1–3", result: "L" },
      { opponent: "Dalston Athletic", score: "2–2", result: "D" },
    ],
  },
  "shoreditch-rovers": {
    name: "Shoreditch Rovers",
    location: "Powerleague Shoreditch",
    distance: "3.4 miles",
    rating: 4.9,
    members: 14,
    winRate: 85,
    record: { w: 22, d: 1, l: 3 },
    level: "Semi-Pro",
    description: "Semi-pro side competing in regional leagues. Looking for technically strong players only.",
    founded: "2015",
    league: "London Regional League – Div 2",
    trainingDays: "Tues & Fri, 6:30 PM",
    openPositions: ["CDM", "RB"],
    players: [
      { name: "Sam Okafor", position: "CDM", rating: 9.1, avatar: "SO" },
      { name: "Chris Patel", position: "CAM", rating: 8.9, avatar: "CP" },
    ],
    recentResults: [
      { opponent: "Hackney United", score: "2–1", result: "W" },
      { opponent: "Dalston Athletic", score: "3–0", result: "W" },
      { opponent: "East End FC", score: "1–1", result: "D" },
    ],
  },
  "dalston-athletic": {
    name: "Dalston Athletic",
    location: "London Fields, London",
    distance: "4.0 miles",
    rating: 4.5,
    members: 11,
    winRate: 64,
    record: { w: 11, d: 3, l: 5 },
    level: "Competitive",
    description: "11-a-side team with a strong defensive record. Always looking for determined players.",
    founded: "2017",
    league: "East London Sunday League – Div 2",
    trainingDays: "Wednesdays, 7:30 PM",
    openPositions: ["ST", "LW", "RW"],
    players: [
      { name: "Ben Traoré", position: "CB", rating: 8.4, avatar: "BT" },
      { name: "Kai Morris", position: "ST", rating: 7.9, avatar: "KM" },
    ],
    recentResults: [
      { opponent: "Bow City FC", score: "2–0", result: "W" },
      { opponent: "East End FC", score: "2–2", result: "D" },
      { opponent: "Shoreditch Rovers", score: "0–3", result: "L" },
    ],
  },
  "bow-city": {
    name: "Bow City FC",
    location: "Mile End Park, London",
    distance: "4.8 miles",
    rating: 4.3,
    members: 8,
    winRate: 50,
    record: { w: 8, d: 4, l: 8 },
    level: "Casual",
    description: "Casual 5-a-side crew. We play for fun — results are a bonus. Beginners welcome.",
    founded: "2022",
    league: "Casual 5-a-side League",
    trainingDays: "Saturdays, 9:00 AM",
    openPositions: ["GK", "CM", "ST", "LB", "RB"],
    players: [
      { name: "Ollie Grant", position: "CM", rating: 7.2, avatar: "OG" },
    ],
    recentResults: [
      { opponent: "Hackney United", score: "2–2", result: "D" },
      { opponent: "East End FC", score: "2–4", result: "L" },
      { opponent: "Dalston Athletic", score: "0–2", result: "L" },
    ],
  },
};

export default function TeamProfilePage({ params }: { params: { teamId: string } }) {
  const team = teamData[params.teamId];

  if (!team) {
    return (
      <div className="flex items-center justify-center min-h-screen px-4">
        <p className="text-text-secondary">Team not found.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen px-4 pt-12 pb-8">
      {/* Back */}
      <a href="/my-team" className="flex items-center gap-2 mb-6 text-text-secondary text-sm">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5M12 5l-7 7 7 7" />
        </svg>
        Browse Teams
      </a>

      {/* Team header */}
      <section className="flex flex-col items-center text-center mb-6">
        <div className="w-20 h-20 rounded-full bg-accent/10 border-2 border-accent flex items-center justify-center mb-3">
          <span className="text-xl font-bold text-accent">
            {team.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
          </span>
        </div>
        <h1 className="text-xl font-bold">{team.name}</h1>
        <p className="text-text-secondary text-sm mt-0.5">{team.location} · {team.distance}</p>
        <div className="flex items-center gap-1.5 mt-2">
          <span className="text-sm font-bold text-yellow-400">{team.rating}</span>
          <div className="flex">
            {[1,2,3,4,5].map((i) => (
              <svg key={i} width="13" height="13" viewBox="0 0 24 24" fill={i <= Math.round(team.rating) ? "#FACC15" : "none"} stroke="#FACC15" strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            ))}
          </div>
          <span className={`ml-1 text-xs font-medium px-2 py-0.5 rounded-lg ${
            team.level === "Casual" ? "bg-blue-500/10 text-blue-400"
            : team.level === "Competitive" ? "bg-orange-500/10 text-orange-400"
            : "bg-purple-500/10 text-purple-400"
          }`}>{team.level}</span>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-3 gap-2 mb-6">
        {[
          { label: "Win Rate", value: `${team.winRate}%` },
          { label: "Members", value: `${team.members}` },
          { label: "Founded", value: team.founded },
        ].map((s) => (
          <div key={s.label} className="bg-surface-2 border border-border rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-accent">{s.value}</p>
            <p className="text-xs text-text-secondary mt-0.5">{s.label}</p>
          </div>
        ))}
      </section>

      {/* W/D/L */}
      <section className="bg-surface-2 border border-border rounded-2xl p-4 mb-5">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">Season Record</h3>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: "Wins", value: team.record.w, color: "text-accent" },
            { label: "Draws", value: team.record.d, color: "text-yellow-400" },
            { label: "Losses", value: team.record.l, color: "text-red-400" },
          ].map((s) => (
            <div key={s.label} className="bg-background rounded-xl py-3">
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-text-secondary mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* About */}
      <section className="mb-5">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">About</h3>
        <p className="text-sm text-text-secondary leading-relaxed">{team.description}</p>
        <div className="mt-3 space-y-1.5 text-xs text-text-secondary">
          <p><span className="text-text-primary font-medium">League:</span> {team.league}</p>
          <p><span className="text-text-primary font-medium">Training:</span> {team.trainingDays}</p>
        </div>
      </section>

      {/* Open positions */}
      <section className="mb-5">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Open Positions</h3>
        <div className="flex flex-wrap gap-2">
          {team.openPositions.map((pos) => (
            <span key={pos} className="px-3 py-1.5 rounded-xl bg-accent/10 border border-accent/30 text-accent text-xs font-semibold">
              {pos}
            </span>
          ))}
        </div>
      </section>

      {/* Players */}
      <section className="mb-5">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Players</h3>
        <div className="space-y-2">
          {team.players.map((p) => (
            <div key={p.name} className="bg-surface-2 border border-border rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-semibold text-text-secondary">{p.avatar}</span>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">{p.name}</p>
                <p className="text-xs text-text-secondary">{p.position}</p>
              </div>
              <span className="text-sm font-bold text-accent">{p.rating}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Recent results */}
      <section className="mb-6">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Recent Results</h3>
        <div className="space-y-2">
          {team.recentResults.map((r) => (
            <div key={r.opponent} className="bg-surface-2 border border-border rounded-xl px-4 py-3 flex items-center justify-between">
              <p className="text-sm text-text-secondary">vs {r.opponent}</p>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold">{r.score}</span>
                <span className={`text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center ${
                  r.result === "W" ? "bg-accent/20 text-accent"
                  : r.result === "D" ? "bg-yellow-400/20 text-yellow-400"
                  : "bg-red-400/20 text-red-400"
                }`}>{r.result}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <button className="w-full py-3.5 rounded-xl bg-accent text-black font-bold text-sm">
        Request to Join {team.name}
      </button>
    </div>
  );
}
