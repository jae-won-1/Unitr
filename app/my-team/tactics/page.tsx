"use client";

import { useState } from "react";
import { useTactics } from "@/contexts/TacticsContext";

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
  "3-5-2": [
    { position: "GK", x: 50, y: 88 },
    { position: "CB", x: 25, y: 72 }, { position: "CB", x: 50, y: 74 }, { position: "CB", x: 75, y: 72 },
    { position: "LWB", x: 10, y: 52 }, { position: "CM", x: 30, y: 50 }, { position: "CDM", x: 50, y: 55 }, { position: "CM", x: 70, y: 50 }, { position: "RWB", x: 90, y: 52 },
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

const formationKeys = Object.keys(formations);

export default function TacticsPage() {
  const { tactics, saveTactics } = useTactics();
  const [formation, setFormation] = useState(tactics.formation);
  const [notes, setNotes] = useState(tactics.notes);
  const [style, setStyle] = useState<string | null>(tactics.style);
  const [pressing, setPressing] = useState<string | null>(tactics.pressing);

  const players = formations[formation] ?? formations["4-3-3"];

  return (
    <div className="flex flex-col min-h-screen px-4 pt-12 pb-8">
      <div className="flex items-center gap-3 mb-6">
        <a href="/my-team">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </a>
        <div>
          <h1 className="text-xl font-bold">Tactics Board</h1>
          <p className="text-xs text-text-secondary">Set your team's default formation and style</p>
        </div>
      </div>

      {/* Formation selector */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
        {formationKeys.map((f) => (
          <button key={f} onClick={() => setFormation(f)} className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${formation === f ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>{f}</button>
        ))}
      </div>

      {/* Pitch */}
      <div className="relative w-full rounded-2xl overflow-hidden mb-5" style={{ paddingBottom: "130%", background: "linear-gradient(180deg, #1a5c1a 0%, #1e6b1e 25%, #1a5c1a 50%, #1e6b1e 75%, #1a5c1a 100%)" }}>
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 130" preserveAspectRatio="none">
          {/* Pitch markings */}
          <rect x="5" y="5" width="90" height="120" rx="1" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
          <line x1="5" y1="65" x2="95" y2="65" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
          <circle cx="50" cy="65" r="10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
          <circle cx="50" cy="65" r="0.8" fill="rgba(255,255,255,0.6)"/>
          {/* Top penalty box */}
          <rect x="22" y="5" width="56" height="20" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
          <rect x="34" y="5" width="32" height="10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
          <circle cx="50" cy="20" r="0.8" fill="rgba(255,255,255,0.4)"/>
          {/* Bottom penalty box */}
          <rect x="22" y="105" width="56" height="20" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
          <rect x="34" y="115" width="32" height="10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
          <circle cx="50" cy="110" r="0.8" fill="rgba(255,255,255,0.4)"/>
        </svg>

        {/* Player dots */}
        {players.map((p, i) => (
          <div
            key={i}
            className="absolute flex flex-col items-center"
            style={{ left: `${p.x}%`, top: `${p.y}%`, transform: "translate(-50%, -50%)" }}
          >
            <div className="w-8 h-8 rounded-full bg-accent border-2 border-white flex items-center justify-center shadow-lg">
              <span className="text-[9px] font-bold text-black leading-none text-center">{p.position}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Play style */}
      <section className="mb-4">
        <p className="text-sm font-semibold mb-2">Play Style</p>
        <div className="flex gap-2 flex-wrap">
          {["Possession", "Counter-Attack", "High Press", "Direct Play"].map((s) => (
            <button key={s} onClick={() => setStyle(s === style ? null : s)} className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${style === s ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>{s}</button>
          ))}
        </div>
      </section>

      {/* Pressing */}
      <section className="mb-4">
        <p className="text-sm font-semibold mb-2">Pressing Intensity</p>
        <div className="flex gap-2">
          {["Low", "Medium", "High"].map((p) => (
            <button key={p} onClick={() => setPressing(p === pressing ? null : p)} className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-colors ${pressing === p ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>{p}</button>
          ))}
        </div>
      </section>

      {/* Notes */}
      <section className="mb-5">
        <p className="text-sm font-semibold mb-2">Tactical Notes</p>
        <textarea
          rows={3}
          placeholder="Add notes for your team (e.g. set piece routines, defensive shape)..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/50 resize-none"
        />
      </section>

      <button
        onClick={() => saveTactics({ formation, style, pressing, notes })}
        className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm"
      >
        Save Team Tactics
      </button>
    </div>
  );
}
