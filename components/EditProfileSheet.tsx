"use client";

import { useState } from "react";
import {
  AGE_GROUPS, EXPERIENCE_LEVELS, FOOTBALL_TYPES, GENDERS, PLAY_FREQUENCIES,
  POSITIONS, type Option, type ProfileFields, saveProfileFields,
} from "@/lib/profile-options";

// ── Edit profile ────────────────────────────────────────────────────────
// Everything registration asked a player, editable afterwards. Until now the
// Edit Profile button on /profile did nothing at all, so a position picked in
// a hurry at sign-up was permanent.
//
// The one question that changes shape here is position: a player covers
// several, and only being able to name one is why every squad list reads like
// a team of specialists. The first one picked stays primary — it is what the
// cards with room for a single line show — so the chips keep their order.
//
// Sheet, not a page: it is a form over the profile it edits, and the profile
// underneath is the context for it. z-[60] per the house floor — the TopBar
// and BottomNav are z-40 chrome and would otherwise paint over the bottom.

function ChipRow({ options, selected, onToggle }: {
  options: string[]; selected: string[]; onToggle: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onToggle(o)}
          className={`px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${
            selected.includes(o) ? "bg-accent text-white border-accent" : "border-border bg-surface-2 text-text-secondary"
          }`}>
          {o}
        </button>
      ))}
    </div>
  );
}

function OptionGrid({ options, value, onPick, columns = 2 }: {
  options: Option[]; value: string; onPick: (v: string) => void; columns?: 1 | 2;
}) {
  return (
    <div className={columns === 2 ? "grid grid-cols-2 gap-2" : "flex flex-col gap-2"}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button key={o.value} type="button" onClick={() => onPick(o.value)}
            className={`px-4 py-3 rounded-xl border text-sm font-medium text-left transition-colors ${
              on ? "bg-accent text-white border-accent" : "border-border bg-surface-2 text-text-secondary"
            }`}>
            <span className="block">{o.label}</span>
            {o.hint && (
              <span className={`block text-xs mt-0.5 ${on ? "text-white/70" : "text-text-secondary"}`}>{o.hint}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-sm font-medium text-text-secondary">{label}</label>
        {hint && <span className="text-xs text-text-secondary">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export default function EditProfileSheet({ userId, initial, onClose, onSaved }: {
  userId: string;
  initial: ProfileFields;
  onClose: () => void;
  onSaved: (fields: ProfileFields) => void;
}) {
  const [fullName, setFullName] = useState(initial.full_name);
  const [positions, setPositions] = useState<string[]>(initial.positions);
  const [experience, setExperience] = useState(initial.experience);
  const [ageGroup, setAgeGroup] = useState(initial.age_group);
  const [gender, setGender] = useState(initial.gender);
  const [gamesPerMonth, setGamesPerMonth] = useState(initial.games_per_month);
  const [footballType, setFootballType] = useState(initial.preferred_football_type);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Order matters: the first position picked is the primary one, so a position
  // that is already on keeps its place and a new one goes on the end.
  const togglePosition = (p: string) =>
    setPositions((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const valid = fullName.trim().length > 0 && positions.length > 0;

  const handleSave = async () => {
    if (!valid) return;
    setSaving(true); setError(null); setNote(null);

    const fields: ProfileFields = {
      full_name: fullName.trim(),
      positions,
      experience,
      games_per_month: gamesPerMonth,
      preferred_football_type: footballType,
      age_group: ageGroup,
      gender,
    };
    const res = await saveProfileFields(userId, fields);
    setSaving(false);

    if (res.error) { setError("Couldn't save your profile. Please try again."); return; }
    // Name, primary position and experience save either way; the rest need
    // their migrations, so the sheet stays open and says what actually
    // happened rather than closing on a half-truth.
    if (!res.extrasSaved) {
      setNote("Saved your name, position and experience — the rest needs supabase_multi_select_preferences.sql (and the other profile-field migrations) run in Supabase.");
      onSaved({
        ...fields,
        positions: positions.slice(0, 1),
        games_per_month: "", preferred_football_type: "", age_group: "", gender: "",
      });
      return;
    }
    onSaved(fields);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-scrim" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-surface border-t border-border rounded-t-2xl p-5 pb-8 max-h-[90dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <p className="font-bold text-base">Edit profile</p>
          <button onClick={onClose} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <p className="text-xs text-text-secondary mb-4">
          What you told us when you signed up. Captains see this when they&rsquo;re looking for players.
        </p>

        <div className="flex flex-col gap-5">
          <Field label="Full name">
            <input type="text" autoCapitalize="words" value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Jamie Dawson"
              className="bg-background border border-border rounded-btn px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60" />
          </Field>

          <Field label="Position" hint="Pick every one you play.">
            <ChipRow options={POSITIONS} selected={positions} onToggle={togglePosition} />
            <p className="text-xs text-text-secondary">
              {positions.length > 1
                ? `${positions[0]} is your main position — it's the one shown where there's only room for one.`
                : "Listing more than one position gets you into more squads."}
            </p>
          </Field>

          <Field label="Experience level">
            <OptionGrid columns={1}
              options={EXPERIENCE_LEVELS.map((l) => ({ value: l, label: l }))}
              value={experience} onPick={setExperience} />
          </Field>

          <Field label="Age group">
            <OptionGrid options={AGE_GROUPS} value={ageGroup} onPick={setAgeGroup} />
          </Field>

          <Field label="Gender">
            <OptionGrid options={GENDERS} value={gender} onPick={setGender} />
          </Field>

          <Field label="How often do you play?" hint="Roughly, per month.">
            <OptionGrid options={PLAY_FREQUENCIES} value={gamesPerMonth} onPick={setGamesPerMonth} />
          </Field>

          <Field label="Preferred type of football">
            <OptionGrid columns={1} options={FOOTBALL_TYPES} value={footballType} onPick={setFootballType} />
          </Field>

          {!valid && (
            <p className="text-xs text-text-secondary">Your name and at least one position are needed.</p>
          )}
          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-btn px-3 py-2.5">{error}</p>
          )}
          {note && (
            <p className="text-xs text-text-secondary bg-surface-2 border border-border rounded-btn px-3 py-2.5">{note}</p>
          )}

          <div className="flex gap-2">
            <button onClick={onClose}
              className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold text-text-secondary">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving || !valid}
              className="flex-1 py-3 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {saving ? (
                <>
                  <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                  Saving…
                </>
              ) : "Save Profile"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
