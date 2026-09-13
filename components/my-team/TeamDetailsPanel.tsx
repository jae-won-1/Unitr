"use client";

import { useEffect, useState } from "react";
import {
  TEAM_FORMATS, TEAM_LEVELS, loadTeamDetails, saveTeamDetails, teamFormats,
} from "@/lib/team-options";

// ── Team details ────────────────────────────────────────────────────────
// Everything /my-team/create asked when the team was registered, editable
// afterwards. A team renames itself, moves across town or starts playing 5s as
// well as 11s, and until now the only way to change any of it was the SQL
// editor.
//
// One difference from the registration form: players per side is a
// multi-select here. A team that plays both is the normal case, and saying so
// is what puts it in front of both sets of opponents. The first one picked
// stays the team's primary format — it is what a tactics board sizes itself
// from — so the chips keep their order and the first is named below them.

type TeamRow = {
  id: string;
  name: string;
  location: string | null;
  level: string | null;
  description: string | null;
  format: string | null;
  formats?: string[] | null;
};

export default function TeamDetailsPanel({ teamId, onRenamed }: {
  teamId: string;
  onRenamed?: (name: string) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [level, setLevel] = useState("");
  const [formats, setFormats] = useState<string[]>([]);
  const [description, setDescription] = useState("");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const team = await loadTeamDetails<TeamRow>(teamId, "id, name, location, level, description, format");
      if (cancelled || !team) { setLoaded(true); return; }
      setName(team.name ?? "");
      setLocation(team.location ?? "");
      setLevel(team.level ?? "");
      setFormats(teamFormats(team));
      setDescription(team.description ?? "");
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [teamId]);

  // Order matters: the first format picked is the primary one, so a format
  // that is already on keeps its place and a new one goes on the end.
  const toggleFormat = (f: string) => {
    setSaved(false);
    setFormats((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  };

  // Any edit retires the "Saved ✓" label, so the button never claims the form
  // on screen is the form that was saved.
  const edit = <T,>(set: (v: T) => void) => (v: T) => { setSaved(false); set(v); };

  const valid = name.trim().length > 0 && location.trim().length > 0 && !!level && formats.length > 0;

  const handleSave = async () => {
    if (!valid) return;
    setSaving(true); setSaved(false); setError(null); setNote(null);

    const res = await saveTeamDetails(teamId, {
      name: name.trim(), location: location.trim(), level, description: description.trim(), formats,
    });
    setSaving(false);

    if (res.error) { setError("Couldn't save your team details. Please try again."); return; }
    setSaved(true);
    onRenamed?.(name.trim());
    // The primary format saved either way; only the extra ones need the
    // migration, so say what actually happened rather than reporting a failure.
    if (!res.formatsSaved && formats.length > 1) {
      setNote("Saved — but only your first format was kept. Run supabase_multi_select_preferences.sql in Supabase to play more than one.");
    }
  };

  if (!loaded) {
    return (
      <div className="bg-surface border border-border shadow-card rounded-card p-4 mb-6 flex justify-center py-8">
        <div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border shadow-card rounded-card p-4 mb-6">
      <p className="text-sm font-bold mb-1">Team details</p>
      <p className="text-xs text-text-secondary mb-4">
        What you set when you registered the team. Players see this on your team page and when
        they&rsquo;re looking for a squad to join.
      </p>

      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-secondary">Team name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => edit(setName)(e.target.value)}
            placeholder="e.g. Hackney United"
            className="bg-background border border-border rounded-btn px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-secondary">Location</label>
          <input
            type="text"
            value={location}
            onChange={(e) => edit(setLocation)(e.target.value)}
            placeholder="e.g. Hackney, London"
            className="bg-background border border-border rounded-btn px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-secondary">Level</label>
          <div className="flex gap-2 flex-wrap">
            {TEAM_LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => edit(setLevel)(l)}
                className={`px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                  level === l ? "bg-accent text-white border-accent" : "bg-surface-2 border-border text-text-secondary"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            {/* The column stays `format` — it is read across the Transfer
                Market, TeamsPanel and the match composers. Label only. */}
            <label className="text-sm font-medium text-text-secondary">Preferred players per side</label>
            <span className="text-xs text-text-secondary">Pick as many as you play.</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            {TEAM_FORMATS.map((f) => {
              const on = formats.includes(f);
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => toggleFormat(f)}
                  className={`px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                    on ? "bg-accent text-white border-accent" : "bg-surface-2 border-border text-text-secondary"
                  }`}
                >
                  {f}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-text-secondary">
            {formats.length > 1
              ? `${formats[0]} is your main format — the one your tactics board and default line-up are built for.`
              : "Teams that play more than one format are seen by more opponents."}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-secondary">
            Description <span className="text-text-secondary font-normal">(optional)</span>
          </label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => edit(setDescription)(e.target.value)}
            placeholder="Tell players what your team is about..."
            className="bg-background border border-border rounded-btn px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60 resize-none"
          />
        </div>

        {!valid && (
          <p className="text-xs text-text-secondary">
            Name, location, level and at least one format are needed.
          </p>
        )}
        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-btn px-3 py-2.5">{error}</p>
        )}
        {note && (
          <p className="text-xs text-text-secondary bg-surface-2 border border-border rounded-btn px-3 py-2.5">{note}</p>
        )}

        <button
          onClick={handleSave}
          disabled={saving || !valid}
          className="w-full py-3.5 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              Saving…
            </>
          ) : saved ? "Saved ✓" : "Save Team Details"}
        </button>
      </div>
    </div>
  );
}
