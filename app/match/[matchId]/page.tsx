"use client";

import { useState } from "react";

const matchData: Record<string, {
  title: string;
  status: "accepted" | "pending" | "confirmed";
  date: string;
  time: string;
  location: string;
  type: string;
  description: string;
  teams: {
    name: string;
    players: number;
    totalPlayers: number;
    location: string;
    level: string;
  }[];
  availability: { name: string; available: boolean; avatar: string }[];
}> = {
  "match-1": {
    title: "FTB FC vs Regents FC",
    status: "accepted",
    date: "Feb 15, 2026",
    time: "14:00",
    location: "Central Park Field 3",
    type: "match",
    description: "Friendly 11v11 match. All skill levels welcome!",
    teams: [
      { name: "FTB FC", players: 11, totalPlayers: 11, location: "North London", level: "Intermediate" },
      { name: "Regents FC", players: 10, totalPlayers: 11, location: "Central London", level: "Intermediate" },
    ],
    availability: [
      { name: "Jamie Dawson", available: true, avatar: "JD" },
      { name: "Marcus Webb", available: true, avatar: "MW" },
      { name: "Jordan Ellis", available: true, avatar: "JE" },
      { name: "Ryan Scott", available: true, avatar: "RS" },
      { name: "Liam Foster", available: true, avatar: "LF" },
      { name: "Tyler Nash", available: false, avatar: "TN" },
      { name: "Devon King", available: true, avatar: "DK" },
      { name: "Sam Okafor", available: true, avatar: "SO" },
      { name: "Chris Patel", available: false, avatar: "CP" },
      { name: "Ben Traoré", available: true, avatar: "BT" },
      { name: "Kai Morris", available: true, avatar: "KM" },
    ],
  },
  "match-2": {
    title: "Hackney United vs Dalston Athletic",
    status: "pending",
    date: "Feb 22, 2026",
    time: "11:00",
    location: "Hackney Marshes Pitch 4",
    type: "league",
    description: "Sunday league fixture. Attendance is mandatory.",
    teams: [
      { name: "Hackney United", players: 9, totalPlayers: 11, location: "East London", level: "Competitive" },
      { name: "Dalston Athletic", players: 11, totalPlayers: 11, location: "North London", level: "Competitive" },
    ],
    availability: [
      { name: "Jamie Dawson", available: true, avatar: "JD" },
      { name: "Marcus Webb", available: true, avatar: "MW" },
      { name: "Jordan Ellis", available: false, avatar: "JE" },
      { name: "Ryan Scott", available: true, avatar: "RS" },
      { name: "Liam Foster", available: true, avatar: "LF" },
      { name: "Tyler Nash", available: true, avatar: "TN" },
      { name: "Devon King", available: false, avatar: "DK" },
    ],
  },
  "match-3": {
    title: "East End FC vs Shoreditch Rovers",
    status: "accepted",
    date: "Mar 1, 2026",
    time: "09:00",
    location: "Victoria Park Arena",
    type: "tournament",
    description: "East London Cup — group stage. Arrive 30 mins early.",
    teams: [
      { name: "East End FC", players: 7, totalPlayers: 11, location: "East London", level: "Casual" },
      { name: "Shoreditch Rovers", players: 11, totalPlayers: 11, location: "Central London", level: "Semi-Pro" },
    ],
    availability: [
      { name: "Jamie Dawson", available: true, avatar: "JD" },
      { name: "Marcus Webb", available: false, avatar: "MW" },
      { name: "Jordan Ellis", available: true, avatar: "JE" },
      { name: "Ryan Scott", available: true, avatar: "RS" },
      { name: "Liam Foster", available: false, avatar: "LF" },
    ],
  },
};

type Tab = "overview" | "availability" | "tactics";

export default function MatchDetailsPage({ params }: { params: { matchId: string } }) {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const match = matchData[params.matchId];

  if (!match) {
    return (
      <div className="flex items-center justify-center min-h-screen px-4">
        <p className="text-text-secondary">Match not found.</p>
      </div>
    );
  }

  const statusColour =
    match.status === "accepted" ? "bg-accent/20 text-accent"
    : match.status === "confirmed" ? "bg-blue-500/20 text-blue-400"
    : "bg-yellow-500/20 text-yellow-400";

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 pt-12 pb-4 border-b border-border">
        <a href="/" className="flex-shrink-0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </a>
        <div>
          <h1 className="text-base font-bold">{match.title}</h1>
          <p className="text-xs text-text-secondary">Match Details</p>
        </div>
      </div>

      <div className="px-4 pt-4 flex flex-col gap-4">
        {/* Status card */}
        <div className="bg-surface-2 border border-border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-semibold">Match Status</p>
              <p className="text-xs text-text-secondary mt-0.5">Current match information</p>
            </div>
            <span className={`text-xs font-bold px-3 py-1 rounded-full ${statusColour}`}>
              {match.status}
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              {match.time}, {match.date}
            </div>
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
              </svg>
              {match.location}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex bg-surface-2 border border-border rounded-xl p-1">
          {(["overview", "availability", "tactics"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                activeTab === tab
                  ? "bg-accent text-black"
                  : "text-text-secondary"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "overview" && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Teams</h3>
            {match.teams.map((team) => {
              const short = team.players < team.totalPlayers;
              return (
                <div key={team.name} className="bg-surface-2 border border-border rounded-xl p-4">
                  <p className="font-semibold text-sm mb-2">{team.name}</p>
                  <div className="flex items-center gap-3 text-xs text-text-secondary">
                    <span className={short ? "text-red-400 font-semibold" : ""}>
                      {team.players} players{short ? ` (need ${team.totalPlayers - team.players} more)` : ""}
                    </span>
                    <span className="w-1 h-1 rounded-full bg-border" />
                    <span>{team.location}</span>
                    <span className="w-1 h-1 rounded-full bg-border" />
                    <span>{team.level}</span>
                  </div>
                </div>
              );
            })}
            <div className="bg-surface-2 border border-border rounded-xl p-4">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">About this match</p>
              <p className="text-sm text-text-secondary">{match.description}</p>
            </div>
          </div>
        )}

        {activeTab === "availability" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Player Availability</h3>
              <span className="text-xs text-text-secondary">
                {match.availability.filter((p) => p.available).length}/{match.availability.length} available
              </span>
            </div>
            {match.availability.map((player) => (
              <div key={player.name} className="bg-surface-2 border border-border rounded-xl px-4 py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-semibold text-text-secondary">{player.avatar}</span>
                </div>
                <p className="flex-1 text-sm font-medium">{player.name}</p>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                  player.available ? "bg-accent/15 text-accent" : "bg-red-400/15 text-red-400"
                }`}>
                  {player.available ? "Available" : "Unavailable"}
                </span>
              </div>
            ))}
          </div>
        )}

        {activeTab === "tactics" && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <div className="w-16 h-16 rounded-2xl bg-surface-2 border border-border flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="1.5" strokeLinecap="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8" cy="8" r="1.5" fill="#9E9E9E" />
                <circle cx="16" cy="8" r="1.5" fill="#9E9E9E" />
                <circle cx="8" cy="16" r="1.5" fill="#9E9E9E" />
                <circle cx="16" cy="16" r="1.5" fill="#9E9E9E" />
                <circle cx="12" cy="12" r="1.5" fill="#00E676" />
              </svg>
            </div>
            <p className="text-sm font-semibold">Tactics Board</p>
            <p className="text-xs text-text-secondary text-center max-w-[220px]">
              Your captain hasn't set up tactics for this match yet.
            </p>
            <button className="px-5 py-2.5 rounded-xl bg-accent text-black text-sm font-bold mt-2">
              Set Up Tactics
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
