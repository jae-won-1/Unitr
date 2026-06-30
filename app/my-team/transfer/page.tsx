"use client";

import { useState } from "react";

const recommendedPlayers = [
  { id: "tp1", name: "Kofi Mensah", avatar: "KM", position: "ST", age: 22, location: "Hackney, London", distance: "1.4 miles", rating: 8.9, games: 42, goals: 31, assists: 9, experience: "Competitive", looking: true, bio: "Prolific striker with strong movement and clinical finishing. Looking for a competitive Sunday league team." },
  { id: "tp2", name: "Amir Hassan", avatar: "AH", position: "CM", age: 25, location: "Dalston, London", distance: "2.0 miles", rating: 8.4, games: 56, goals: 8, assists: 22, experience: "Semi-Pro", looking: true, bio: "Box-to-box midfielder with excellent passing range. Previously played semi-pro, now looking to settle locally." },
  { id: "tp3", name: "Luke Brennan", avatar: "LB", position: "GK", age: 28, location: "Stratford, London", distance: "3.1 miles", rating: 8.1, games: 60, goals: 0, assists: 0, experience: "Competitive", looking: true, bio: "Experienced keeper with great shot-stopping. Currently a free agent after his previous team folded." },
  { id: "tp4", name: "Eze Okonkwo", avatar: "EO", position: "RW", age: 20, location: "Bethnal Green, London", distance: "2.7 miles", rating: 8.6, games: 28, goals: 14, assists: 17, experience: "Casual", looking: true, bio: "Quick winger with great dribbling. Recent graduate looking to step up to a more competitive level." },
  { id: "tp5", name: "Dan Fletcher", avatar: "DF", position: "CB", age: 31, location: "Islington, London", distance: "4.2 miles", rating: 8.7, games: 88, goals: 6, assists: 3, experience: "Semi-Pro", looking: true, bio: "Commanding centre-back with years of experience. Reads the game well and excellent in the air." },
  { id: "tp6", name: "Yusuf Diallo", avatar: "YD", position: "CDM", age: 24, location: "Hackney, London", distance: "1.9 miles", rating: 8.0, games: 35, goals: 2, assists: 11, experience: "Competitive", looking: true, bio: "Tenacious defensive midfielder who wins the ball and distributes simply. Solid anchor for any team." },
];

const positions = ["All", "GK", "CB", "LB", "RB", "CDM", "CM", "CAM", "RW", "LW", "ST"];
const experiences = ["All", "Casual", "Competitive", "Semi-Pro"];

export default function TransferWindowPage() {
  const [posFilter, setPosFilter] = useState("All");
  const [expFilter, setExpFilter] = useState("All");
  const [sentRequests, setSentRequests] = useState<string[]>([]);

  const filtered = recommendedPlayers.filter((p) => {
    const posMatch = posFilter === "All" || p.position === posFilter;
    const expMatch = expFilter === "All" || p.experience === expFilter;
    return posMatch && expMatch;
  });

  const sendRequest = (id: string) => setSentRequests((prev) => [...prev, id]);

  return (
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-8">
      <div className="flex items-center gap-3 mb-6">
        <a href="/my-team">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </a>
        <div>
          <h1 className="text-xl font-bold">Transfer Window</h1>
          <p className="text-xs text-text-secondary">Players looking to join a team</p>
        </div>
      </div>

      {/* Info banner */}
      <div className="bg-accent/10 border border-accent/30 rounded-xl p-3 mb-4">
        <p className="text-xs text-accent font-semibold mb-0.5">Recommended for Hackney United</p>
        <p className="text-xs text-text-secondary">Based on your team's open positions and location. Send a request to invite a player.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 mb-4">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {positions.map((p) => (
            <button key={p} onClick={() => setPosFilter(p)} className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${posFilter === p ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>{p}</button>
          ))}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {experiences.map((e) => (
            <button key={e} onClick={() => setExpFilter(e)} className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${expFilter === e ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>{e}</button>
          ))}
        </div>
      </div>

      <p className="text-xs text-text-secondary mb-3">{filtered.length} players found</p>

      {/* Player cards */}
      <div className="space-y-4">
        {filtered.map((player) => {
          const requested = sentRequests.includes(player.id);
          return (
            <div key={player.id} className="bg-surface-2 border border-border rounded-2xl p-4">
              {/* Header */}
              <div className="flex items-start gap-3 mb-3">
                <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-accent">{player.avatar}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold">{player.name}</p>
                    <span className="text-xs bg-accent/10 text-accent border border-accent/30 px-2 py-0.5 rounded-full font-semibold">{player.position}</span>
                  </div>
                  <p className="text-xs text-text-secondary mt-0.5">{player.location} · {player.distance}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${player.experience === "Casual" ? "bg-blue-500/10 text-blue-400" : player.experience === "Competitive" ? "bg-orange-500/10 text-orange-400" : "bg-purple-500/10 text-purple-400"}`}>{player.experience}</span>
                    <span className="text-xs text-text-secondary">Age {player.age}</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xl font-bold text-accent">{player.rating}</p>
                  <p className="text-[10px] text-text-secondary">Rating</p>
                </div>
              </div>

              {/* Stats row */}
              <div className="flex items-center gap-3 mb-3 text-xs text-text-secondary bg-background rounded-xl px-3 py-2">
                <div className="text-center">
                  <p className="font-bold text-text-primary">{player.games}</p>
                  <p>Games</p>
                </div>
                <div className="w-px h-6 bg-border" />
                <div className="text-center">
                  <p className="font-bold text-text-primary">{player.goals}</p>
                  <p>Goals</p>
                </div>
                <div className="w-px h-6 bg-border" />
                <div className="text-center">
                  <p className="font-bold text-text-primary">{player.assists}</p>
                  <p>Assists</p>
                </div>
              </div>

              {/* Bio */}
              <p className="text-xs text-text-secondary mb-4 leading-relaxed">{player.bio}</p>

              {/* Actions */}
              <div className="flex gap-2">
                <button className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold text-text-secondary">
                  View Profile
                </button>
                <button
                  onClick={() => sendRequest(player.id)}
                  disabled={requested}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors ${requested ? "bg-accent/20 text-accent border border-accent/30 cursor-default" : "bg-accent text-black"}`}
                >
                  {requested ? "Request Sent" : "Send Request"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
