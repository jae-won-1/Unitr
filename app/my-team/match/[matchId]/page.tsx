"use client";

import { useState } from "react";
import { useTactics } from "@/contexts/TacticsContext";

const matchData: Record<string, { opponent: string; date: string; time: string; location: string; status: string }> = {
  "match-1": { opponent: "Regents FC", date: "Feb 15, 2026", time: "14:00", location: "Central Park Field 3", status: "confirmed" },
  "match-2": { opponent: "Dalston Athletic", date: "Feb 22, 2026", time: "11:00", location: "Hackney Marshes Pitch 4", status: "pending" },
};

const formations: Record<string, { position: string; x: number; y: number }[]> = {
  "4-3-3": [
    { position: "GK", x: 50, y: 88 },
    { position: "LB", x: 15, y: 70 }, { position: "CB", x: 35, y: 72 }, { position: "CB", x: 65, y: 72 }, { position: "RB", x: 85, y: 70 },
    { position: "CM", x: 25, y: 52 }, { position: "CM", x: 50, y: 50 }, { position: "CM", x: 75, y: 52 },
    { position: "LW", x: 15, y: 28 }, { position: "ST", x: 50, y: 22 }, { position: "RW", x: 85, y: 28 },
  ],
  "4-4-2": [
    { position: "GK", x: 50, y: 88 },
    { position: "LB", x: 15, y: 70 }, { position: "CB", x: 35, y: 72 }, { position: "CB", x: 65, y: 72 }, { position: "RB", x: 85, y: 70 },
    { position: "LM", x: 15, y: 50 }, { position: "CM", x: 35, y: 50 }, { position: "CM", x: 65, y: 50 }, { position: "RM", x: 85, y: 50 },
    { position: "ST", x: 35, y: 22 }, { position: "ST", x: 65, y: 22 },
  ],
  "4-2-3-1": [
    { position: "GK", x: 50, y: 88 },
    { position: "LB", x: 15, y: 70 }, { position: "CB", x: 35, y: 72 }, { position: "CB", x: 65, y: 72 }, { position: "RB", x: 85, y: 70 },
    { position: "CDM", x: 35, y: 55 }, { position: "CDM", x: 65, y: 55 },
    { position: "LW", x: 18, y: 36 }, { position: "CAM", x: 50, y: 36 }, { position: "RW", x: 82, y: 36 },
    { position: "ST", x: 50, y: 18 },
  ],
};

type Tab = "overview" | "tactics" | "media";

function MediaRow({ item, onRemove }: { item: { id: string; type: string; label: string }; onRemove: () => void }) {
  return (
    <div className="bg-surface-2 border border-border rounded-xl px-4 py-3 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${item.type === "video" ? "bg-purple-500/15 border border-purple-500/30" : "bg-blue-500/15 border border-blue-500/30"}`}>
        {item.type === "video"
          ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2" strokeLinecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{item.label}</p>
        <p className="text-xs text-text-secondary capitalize">{item.type}</p>
      </div>
      <button onClick={onRemove} className="text-xs text-red-400 flex-shrink-0">Remove</button>
    </div>
  );
}

export default function ManageMatchPage({ params }: { params: { matchId: string } }) {
  const match = matchData[params.matchId];
  const [tab, setTab] = useState<Tab>("overview");
  const [formation, setFormation] = useState("4-3-3");
  const { tactics, saveTactics } = useTactics();
  const [style, setStyle] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const matchMedia = tactics.media.filter((m) => m.matchId === params.matchId);
  const teamMedia = tactics.media.filter((m) => !m.matchId);

  if (!match) return (
    <div className="flex items-center justify-center min-h-screen">
      <p className="text-text-secondary">Match not found.</p>
    </div>
  );

  const players = formations[formation];

  return (
    <div className="flex flex-col min-h-screen px-4 pt-12 pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <a href="/my-team">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </a>
        <div className="flex-1">
          <h1 className="text-base font-bold">vs {match.opponent}</h1>
          <p className="text-xs text-text-secondary">{match.date} · {match.time} · {match.location}</p>
        </div>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${match.status === "confirmed" ? "bg-accent/15 text-accent" : "bg-yellow-400/15 text-yellow-400"}`}>
          {match.status}
        </span>
      </div>

      {/* Tabs */}
      <div className="flex bg-surface-2 border border-border rounded-xl p-1 mb-5">
        {(["overview", "tactics", "media"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`flex-1 py-2 rounded-lg text-sm font-semibold capitalize transition-colors ${tab === t ? "bg-accent text-black" : "text-text-secondary"}`}>{t}</button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab === "overview" && (
        <div className="space-y-4">

          {/* Payment countdown — shown when match is confirmed */}
          {match.status === "confirmed" && (
            <div className="bg-accent/10 border border-accent/40 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-bold text-accent">Payment Pending</p>
                <span className="text-lg font-bold text-accent tabular-nums">02:47:13</span>
              </div>
              <p className="text-xs text-text-secondary mb-3">Payment will be taken automatically in 3 hours after confirmation. Non-refundable once charged.</p>
              <div className="w-full h-1.5 bg-background rounded-full mb-3">
                <div className="h-1.5 bg-accent rounded-full" style={{ width: "91%" }} />
              </div>
              <div className="bg-background rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-secondary">Venue</span>
                  <span className="font-semibold">{match.location}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-secondary">Pitch fee</span>
                  <span className="font-semibold">£80/hr</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-secondary">Players</span>
                  <span className="font-semibold">22 (11 per side)</span>
                </div>
                <div className="flex items-center justify-between text-xs border-t border-border pt-2 mt-1">
                  <span className="font-semibold">Per player</span>
                  <span className="font-bold text-accent">£3.64</span>
                </div>
              </div>
              <p className="text-[10px] text-text-secondary mt-2">
                Backup venue: <span className="text-text-primary">Hackney Marshes Pitch 3</span> — applies automatically if primary pitch is unavailable.
              </p>
            </div>
          )}

          <div className="bg-surface-2 border border-border rounded-2xl p-4">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">Match Info</p>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-text-secondary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                {match.date} · {match.time}
              </div>
              <div className="flex items-center gap-2 text-text-secondary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                {match.location}
              </div>
            </div>
          </div>

          {/* Confirmed players */}
          <div className="bg-surface-2 border border-border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Confirmed Players</p>
              <span className="text-xs text-accent font-semibold">9/11</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {["MW", "JE", "RS", "LF", "DK", "SO", "BT", "KM", "CP"].map((av) => (
                <div key={av} className="w-9 h-9 rounded-full bg-accent/15 border border-accent/30 flex items-center justify-center">
                  <span className="text-[10px] font-bold text-accent">{av}</span>
                </div>
              ))}
              {["TN", "DF"].map((av) => (
                <div key={av} className="w-9 h-9 rounded-full bg-surface border border-border flex items-center justify-center opacity-40">
                  <span className="text-[10px] font-semibold text-text-secondary">{av}</span>
                </div>
              ))}
            </div>
          </div>

          <a href={`/match/${params.matchId}`} className="block w-full py-3 rounded-xl border border-border text-sm font-semibold text-center text-text-secondary">
            View Full Match Details
          </a>
        </div>
      )}

      {/* ── TACTICS ── */}
      {tab === "tactics" && (
        <div className="space-y-4">
          {/* Formation picker */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {Object.keys(formations).map((f) => (
              <button key={f} onClick={() => setFormation(f)} className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${formation === f ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>{f}</button>
            ))}
          </div>

          {/* Pitch */}
          <div className="relative w-full rounded-2xl overflow-hidden" style={{ paddingBottom: "130%", background: "linear-gradient(180deg, #1a5c1a 0%, #1e6b1e 25%, #1a5c1a 50%, #1e6b1e 75%, #1a5c1a 100%)" }}>
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 130" preserveAspectRatio="none">
              <rect x="5" y="5" width="90" height="120" rx="1" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
              <line x1="5" y1="65" x2="95" y2="65" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
              <circle cx="50" cy="65" r="10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
              <circle cx="50" cy="65" r="0.8" fill="rgba(255,255,255,0.6)"/>
              <rect x="22" y="5" width="56" height="20" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
              <rect x="34" y="5" width="32" height="10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
              <rect x="22" y="105" width="56" height="20" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
              <rect x="34" y="115" width="32" height="10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
            </svg>
            {players.map((p, i) => (
              <div key={i} className="absolute flex flex-col items-center" style={{ left: `${p.x}%`, top: `${p.y}%`, transform: "translate(-50%, -50%)" }}>
                <div className="w-8 h-8 rounded-full bg-accent border-2 border-white flex items-center justify-center shadow-lg">
                  <span className="text-[9px] font-bold text-black leading-none text-center">{p.position}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Play style */}
          <div>
            <p className="text-sm font-semibold mb-2">Match Plan</p>
            <div className="flex gap-2 flex-wrap">
              {["Possession", "Counter-Attack", "High Press", "Direct Play", "Park the Bus"].map((s) => (
                <button key={s} onClick={() => setStyle(s === style ? null : s)} className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${style === s ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>{s}</button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <p className="text-sm font-semibold mb-2">Match Notes</p>
            <textarea
              rows={3}
              placeholder={`Notes specific to vs ${match.opponent} (weaknesses, set pieces, key threats)...`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/50 resize-none"
            />
          </div>

          <button className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm">
            Save Match Tactics
          </button>
        </div>
      )}

      {/* ── MEDIA ── */}
      {tab === "media" && (
        <div className="space-y-5">
          <p className="text-xs text-text-secondary">Attach images or videos to present tactics to your squad for this match.</p>

          {/* Match-specific media */}
          <div>
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
              Match Media — vs {match.opponent}
            </p>
            {matchMedia.length === 0 ? (
              <p className="text-xs text-text-secondary italic">No match-specific media added yet.</p>
            ) : (
              <div className="space-y-2">
                {matchMedia.map((item) => (
                  <MediaRow key={item.id} item={item} onRemove={() => saveTactics({ media: tactics.media.filter((m) => m.id !== item.id) })} />
                ))}
              </div>
            )}
          </div>

          {/* Team tactics media */}
          <div>
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
              From Team Tactics Board
            </p>
            {teamMedia.length === 0 ? (
              <p className="text-xs text-text-secondary italic">No team media set. Add via Tactics Board.</p>
            ) : (
              <div className="space-y-2">
                {teamMedia.map((item) => (
                  <MediaRow key={item.id} item={item} onRemove={() => saveTactics({ media: tactics.media.filter((m) => m.id !== item.id) })} />
                ))}
              </div>
            )}
          </div>

          {/* Upload buttons — saved as match-specific */}
          <div>
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Add to This Match</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => saveTactics({ media: [...tactics.media, { id: String(Date.now()), type: "image", label: "New image tactic", matchId: params.matchId }] })}
                className="flex flex-col items-center gap-2 bg-surface-2 border border-dashed border-border rounded-xl py-5 text-text-secondary"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span className="text-xs font-semibold">Upload Image</span>
              </button>
              <button
                onClick={() => saveTactics({ media: [...tactics.media, { id: String(Date.now() + 1), type: "video", label: "New video tactic", matchId: params.matchId }] })}
                className="flex flex-col items-center gap-2 bg-surface-2 border border-dashed border-border rounded-xl py-5 text-text-secondary"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                <span className="text-xs font-semibold">Upload Video</span>
              </button>
            </div>
          </div>

          <button className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm">
            Share with Squad
          </button>
        </div>
      )}
    </div>
  );
}
