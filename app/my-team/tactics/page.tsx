"use client";

import { useState } from "react";
import { useTactics, TacticPoint } from "@/contexts/TacticsContext";

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

function getYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/\s]+)/);
  return m ? m[1] : null;
}

function VideoEmbed({ url }: { url: string }) {
  if (!url.trim()) return null;
  const ytId = getYouTubeId(url);
  if (ytId) {
    return (
      <div className="relative w-full rounded-xl overflow-hidden bg-black" style={{ paddingBottom: "56.25%" }}>
        <iframe
          className="absolute inset-0 w-full h-full"
          src={`https://www.youtube.com/embed/${ytId}`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }
  return (
    <video
      src={url}
      controls
      className="w-full rounded-xl bg-black"
      style={{ maxHeight: 220 }}
    />
  );
}

type FormState = { title: string; description: string; videoUrl: string };
const emptyForm: FormState = { title: "", description: "", videoUrl: "" };

export default function TacticsPage() {
  const { tactics, saveTactics } = useTactics();
  const [formation, setFormation] = useState(tactics.formation);
  const [notes, setNotes] = useState(tactics.notes);
  const [style, setStyle] = useState<string | null>(tactics.style);
  const [pressing, setPressing] = useState<string | null>(tactics.pressing);

  const [tacticPoints, setTacticPoints] = useState<TacticPoint[]>(tactics.tacticPoints ?? []);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);

  const players = formations[formation] ?? formations["4-3-3"];

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowAddForm(true);
  };

  const openEdit = (pt: TacticPoint) => {
    setEditingId(pt.id);
    setForm({ title: pt.title, description: pt.description, videoUrl: pt.videoUrl });
    setShowAddForm(true);
    setExpandedId(null);
  };

  const cancelForm = () => {
    setShowAddForm(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const savePoint = () => {
    if (!form.title.trim()) return;
    let updated: TacticPoint[];
    if (editingId) {
      updated = tacticPoints.map(p => p.id === editingId ? { ...p, ...form } : p);
    } else {
      updated = [...tacticPoints, { id: String(Date.now()), ...form }];
    }
    setTacticPoints(updated);
    saveTactics({ tacticPoints: updated });
    cancelForm();
  };

  const deletePoint = (id: string) => {
    const updated = tacticPoints.filter(p => p.id !== id);
    setTacticPoints(updated);
    saveTactics({ tacticPoints: updated });
    if (expandedId === id) setExpandedId(null);
  };

  const handleSaveTactics = () => {
    saveTactics({ formation, style, pressing, notes, tacticPoints });
  };

  return (
    <div className="flex flex-col min-h-screen px-4 pt-12 pb-8">
      <div className="flex items-center gap-3 mb-6">
        <a href="/my-team">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </a>
        <div>
          <h1 className="text-xl font-bold">Tactics Board</h1>
          <p className="text-xs text-text-secondary">Set your team's formation, style, and tactic points</p>
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
          <rect x="5" y="5" width="90" height="120" rx="1" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
          <line x1="5" y1="65" x2="95" y2="65" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
          <circle cx="50" cy="65" r="10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
          <circle cx="50" cy="65" r="0.8" fill="rgba(255,255,255,0.6)"/>
          <rect x="22" y="5" width="56" height="20" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
          <rect x="34" y="5" width="32" height="10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
          <circle cx="50" cy="20" r="0.8" fill="rgba(255,255,255,0.4)"/>
          <rect x="22" y="105" width="56" height="20" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
          <rect x="34" y="115" width="32" height="10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
          <circle cx="50" cy="110" r="0.8" fill="rgba(255,255,255,0.4)"/>
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
      <section className="mb-6">
        <p className="text-sm font-semibold mb-2">Tactical Notes</p>
        <textarea
          rows={3}
          placeholder="Add notes for your team (e.g. set piece routines, defensive shape)..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/50 resize-none"
        />
      </section>

      {/* ── Tactic Points ── */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-semibold">Tactic Points</p>
            <p className="text-[11px] text-text-secondary">Detailed breakdowns with descriptions and video</p>
          </div>
          {!showAddForm && (
            <button onClick={openAdd} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent/10 border border-accent/30 text-accent text-xs font-semibold">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
              Add
            </button>
          )}
        </div>

        {/* Existing tactic point cards */}
        <div className="flex flex-col gap-3">
          {tacticPoints.map((pt, idx) => {
            const isExpanded = expandedId === pt.id;
            return (
              <div key={pt.id} className="bg-surface-2 border border-border rounded-2xl overflow-hidden">
                {/* Header row */}
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 text-left"
                  onClick={() => setExpandedId(isExpanded ? null : pt.id)}>
                  <div className="w-7 h-7 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-[11px] font-bold text-accent">{idx + 1}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{pt.title}</p>
                    {!isExpanded && pt.description && (
                      <p className="text-[11px] text-text-secondary truncate mt-0.5">{pt.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {pt.videoUrl && (
                      <div className="w-5 h-5 rounded-md bg-red-500/20 flex items-center justify-center">
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="#ef4444"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                      </div>
                    )}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round" className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}><polyline points="6 9 12 15 18 9"/></svg>
                  </div>
                </button>

                {/* Expanded body */}
                {isExpanded && (
                  <div className="px-4 pb-4">
                    {pt.description && (
                      <p className="text-sm text-text-secondary leading-relaxed mb-3">{pt.description}</p>
                    )}
                    {pt.videoUrl && (
                      <div className="mb-3">
                        <VideoEmbed url={pt.videoUrl} />
                      </div>
                    )}
                    {!pt.videoUrl && (
                      <p className="text-[11px] text-text-secondary/60 mb-3 italic">No video attached</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => openEdit(pt)}
                        className="flex-1 py-2 rounded-xl bg-surface border border-border text-xs font-semibold text-text-secondary flex items-center justify-center gap-1.5">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        Edit
                      </button>
                      <button
                        onClick={() => deletePoint(pt.id)}
                        className="flex-1 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-xs font-semibold text-red-400 flex items-center justify-center gap-1.5">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {tacticPoints.length === 0 && !showAddForm && (
            <div className="bg-surface-2 border border-dashed border-border rounded-2xl px-5 py-8 text-center">
              <p className="text-sm font-semibold mb-1">No tactic points yet</p>
              <p className="text-xs text-text-secondary mb-3">Add detailed tactic breakdowns with descriptions and video for your team.</p>
              <button onClick={openAdd} className="px-4 py-2 rounded-xl bg-accent text-black text-xs font-bold">Add first tactic point</button>
            </div>
          )}
        </div>

        {/* Add / Edit form */}
        {showAddForm && (
          <div className="mt-3 bg-surface-2 border border-accent/30 rounded-2xl p-4">
            <p className="text-sm font-bold mb-4">{editingId ? "Edit Tactic Point" : "New Tactic Point"}</p>

            <div className="mb-3">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5 block">Title</label>
              <input
                type="text"
                placeholder="e.g. High press trigger, Corner routine..."
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                className="w-full bg-surface border border-border rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/50"
              />
            </div>

            <div className="mb-3">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5 block">Description</label>
              <textarea
                rows={4}
                placeholder="Explain the tactic in detail — triggers, movements, responsibilities..."
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full bg-surface border border-border rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/50 resize-none"
              />
            </div>

            <div className="mb-4">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5 block">Video URL</label>
              <input
                type="url"
                placeholder="YouTube or direct video link (optional)"
                value={form.videoUrl}
                onChange={e => setForm(f => ({ ...f, videoUrl: e.target.value }))}
                className="w-full bg-surface border border-border rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/50"
              />
              {form.videoUrl && (
                <div className="mt-2">
                  <VideoEmbed url={form.videoUrl} />
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={cancelForm}
                className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold text-text-secondary">
                Cancel
              </button>
              <button
                onClick={savePoint}
                disabled={!form.title.trim()}
                className="flex-1 py-2.5 rounded-xl bg-accent text-black text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed">
                {editingId ? "Save Changes" : "Add Tactic Point"}
              </button>
            </div>
          </div>
        )}
      </section>

      <button onClick={handleSaveTactics} className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm">
        Save Team Tactics
      </button>
    </div>
  );
}
