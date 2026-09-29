"use client";

// The questions sign-up asks, in the markup sign-up asks them in. Two screens
// ask them now — app/register for an email-and-password account and
// app/welcome for a Google one — and a second copy of this would eventually
// offer two different forms, exactly as two copies of the option lists would
// (lib/profile-options.ts).

import {
  AGE_GROUPS, EXPERIENCE_LEVELS, FOOTBALL_TYPES, GENDERS, PLAY_FREQUENCIES, POSITIONS,
} from "@/lib/profile-options";
import type { AccountType, PlayerDetails } from "@/lib/register-profile";

export function AccountTypeCards({
  value,
  onChange,
}: {
  value: AccountType | null;
  onChange: (type: AccountType) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-text-secondary">I am a…</label>
      <div className="grid grid-cols-2 gap-3">
        {/* Player card */}
        <button type="button" onClick={() => onChange("player")}
          className={`flex flex-col items-start gap-3 p-4 rounded-2xl border-2 transition-all text-left ${value === "player" ? "border-accent bg-accent/10" : "border-border bg-surface-2"}`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${value === "player" ? "bg-accent/20" : "bg-surface"}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={value === "player" ? "#0E7A3C" : "#5A6478"} strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              <path d="M2 12h20"/>
            </svg>
          </div>
          <div>
            <p className={`text-sm font-bold ${value === "player" ? "text-accent-ink" : "text-text-primary"}`}>Player</p>
            <p className="text-xs text-text-secondary mt-0.5">Join teams, find matches, track stats</p>
          </div>
          {value === "player" && (
            <div className="absolute top-2 right-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#0E7A3C"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
          )}
        </button>

        {/* Venue manager card */}
        <button type="button" onClick={() => onChange("venue_manager")}
          className={`flex flex-col items-start gap-3 p-4 rounded-2xl border-2 transition-all text-left ${value === "venue_manager" ? "border-accent bg-accent/10" : "border-border bg-surface-2"}`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${value === "venue_manager" ? "bg-accent/20" : "bg-surface"}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={value === "venue_manager" ? "#0E7A3C" : "#5A6478"} strokeWidth="2" strokeLinecap="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
          </div>
          <div>
            <p className={`text-sm font-bold ${value === "venue_manager" ? "text-accent-ink" : "text-text-primary"}`}>Venue Manager</p>
            <p className="text-xs text-text-secondary mt-0.5">List your pitch, manage bookings</p>
          </div>
        </button>
      </div>
    </div>
  );
}

export function VenueNextStepsNote() {
  return (
    <div className="bg-accent/5 border border-accent/20 rounded-xl px-4 py-3">
      <p className="text-xs text-accent-ink font-semibold mb-1">What happens next</p>
      <p className="text-xs text-text-secondary leading-relaxed">
        After signing up you&apos;ll land in your Venue Portal where you can register your pitch, set availability, and start receiving bookings from Uniter players.
      </p>
    </div>
  );
}

export function PlayerDetailsFields({
  value,
  onChange,
}: {
  value: PlayerDetails;
  onChange: (patch: Partial<PlayerDetails>) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-text-secondary">Age Group</label>
        <div className="grid grid-cols-2 gap-2">
          {AGE_GROUPS.map((ag) => (
            <button key={ag.value} type="button" onClick={() => onChange({ ageGroup: ag.value })}
              className={`px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${value.ageGroup === ag.value ? "bg-accent text-white border-accent" : "border-border bg-surface-2 text-text-secondary"}`}>
              {ag.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-text-secondary">Gender</label>
        <div className="grid grid-cols-2 gap-2">
          {GENDERS.map((g) => (
            <button key={g.value} type="button" onClick={() => onChange({ gender: g.value })}
              className={`px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${value.gender === g.value ? "bg-accent text-white border-accent" : "border-border bg-surface-2 text-text-secondary"}`}>
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-text-secondary">Position</label>
        <div className="flex flex-wrap gap-2">
          {POSITIONS.map((pos) => (
            <button key={pos} type="button" onClick={() => onChange({ position: pos })}
              className={`px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${value.position === pos ? "bg-accent text-white border-accent" : "border-border bg-surface-2 text-text-secondary"}`}>
              {pos}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-text-secondary">Experience Level</label>
        <div className="flex flex-col gap-2">
          {EXPERIENCE_LEVELS.map((level) => (
            <button key={level} type="button" onClick={() => onChange({ experience: level })}
              className={`w-full px-4 py-3 rounded-xl border text-sm font-medium text-left transition-colors ${value.experience === level ? "bg-accent text-white border-accent" : "border-border bg-surface-2 text-text-secondary"}`}>
              {level}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <label className="text-sm font-medium text-text-secondary">How often do you play?</label>
          <span className="text-xs text-text-secondary">Roughly, per month.</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {PLAY_FREQUENCIES.map((freq) => (
            <button key={freq.value} type="button" onClick={() => onChange({ gamesPerMonth: freq.value })}
              className={`px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${value.gamesPerMonth === freq.value ? "bg-accent text-white border-accent" : "border-border bg-surface-2 text-text-secondary"}`}>
              {freq.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stacked rather than chipped: these carry a hint line each, and
          the third label is too long to sit in a wrapping row. */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-text-secondary">Preferred type of football</label>
        <div className="flex flex-col gap-2">
          {FOOTBALL_TYPES.map((type) => (
            <button key={type.value} type="button" onClick={() => onChange({ footballType: type.value })}
              className={`w-full px-4 py-3 rounded-xl border text-left transition-colors ${value.footballType === type.value ? "bg-accent text-white border-accent" : "border-border bg-surface-2 text-text-secondary"}`}>
              <span className="block text-sm font-medium">{type.label}</span>
              <span className={`block text-xs mt-0.5 ${value.footballType === type.value ? "text-white/70" : "text-text-secondary"}`}>{type.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
