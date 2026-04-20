"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type DateOption = {
  id: string;
  date: string;
  time: string;
};

type PitchOption = {
  id: string;
  name: string;
  address: string;
  price: number;
  format: string;
  distance: string;
};

const rankLabels = ["1st choice", "2nd choice", "3rd choice"];

export default function CreateMatchPage() {
  const router = useRouter();
  const [dateOptions, setDateOptions] = useState<DateOption[]>([
    { id: "1", date: "", time: "" },
  ]);
  const [description, setDescription] = useState("");
  const [pitchOptions, setPitchOptions] = useState<PitchOption[]>([]);
  const [showTooltip, setShowTooltip] = useState(false);
  const [confirmedDateLabel, setConfirmedDateLabel] = useState<string | null>(null);

  // Read pre-filled date from availability page and newly selected pitch from pitches page
  useEffect(() => {
    const savedDate = localStorage.getItem("unitr_confirmed_date");
    if (savedDate) {
      const d = JSON.parse(savedDate);
      setDateOptions([{ id: "1", date: d.isoDate, time: d.time }]);
      setConfirmedDateLabel(d.display);
      localStorage.removeItem("unitr_confirmed_date");
    }

    const savedPitch = localStorage.getItem("unitr_pitch_selection");
    if (savedPitch) {
      const p: PitchOption = JSON.parse(savedPitch);
      setPitchOptions((prev) => {
        if (prev.length >= 3 || prev.find((x) => x.id === p.id)) return prev;
        return [...prev, p];
      });
      localStorage.removeItem("unitr_pitch_selection");
    }
  }, []);

  const addDateOption = () => {
    if (dateOptions.length >= 5) return;
    setDateOptions((prev) => [
      ...prev,
      { id: String(Date.now()), date: "", time: "" },
    ]);
  };

  const removeDateOption = (id: string) => {
    if (dateOptions.length === 1) return;
    setDateOptions((prev) => prev.filter((d) => d.id !== id));
  };

  const updateOption = (id: string, field: "date" | "time", value: string) => {
    setDateOptions((prev) =>
      prev.map((d) => (d.id === id ? { ...d, [field]: value } : d))
    );
    if (field === "date") setConfirmedDateLabel(null);
  };

  const removePitchOption = (id: string) => {
    setPitchOptions((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <div className="flex flex-col min-h-screen px-4 pt-12 pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>
        <div>
          <h1 className="text-xl font-bold">Create New Event</h1>
          <p className="text-xs text-text-secondary mt-0.5">Post a match for other teams to find</p>
        </div>
      </div>

      <div className="flex flex-col gap-5">

        {/* Date options */}
        <section className="bg-surface-2 border border-border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-semibold">Date Options</p>
            <span className="text-xs text-text-secondary">{dateOptions.length}/5</span>
          </div>
          {confirmedDateLabel && (
            <div className="flex items-center gap-1.5 mb-3 bg-accent/10 border border-accent/30 rounded-xl px-3 py-2">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
              <p className="text-xs text-accent font-medium">Pre-filled from team availability: <span className="font-bold">{confirmedDateLabel}</span></p>
            </div>
          )}
          <p className="text-xs text-text-secondary mb-4">
            Add up to 5 possible dates. Opponent teams will see your preferred dates when challenging.
          </p>

          <div className="flex flex-col gap-3">
            {dateOptions.map((opt, i) => (
              <div key={opt.id} className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-text-secondary">Option {i + 1}</span>
                  {dateOptions.length > 1 && (
                    <button
                      onClick={() => removeDateOption(opt.id)}
                      className="text-xs text-red-400"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <div className="flex-1 flex flex-col gap-1">
                    <label className="text-xs text-text-secondary">Date</label>
                    <input
                      type="date"
                      value={opt.date}
                      onChange={(e) => updateOption(opt.id, "date", e.target.value)}
                      className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent/50 [color-scheme:dark]"
                    />
                  </div>
                  <div className="w-28 flex flex-col gap-1">
                    <label className="text-xs text-text-secondary">Time</label>
                    <input
                      type="time"
                      value={opt.time}
                      onChange={(e) => updateOption(opt.id, "time", e.target.value)}
                      className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent/50 [color-scheme:dark]"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {dateOptions.length < 5 && (
            <button
              onClick={addDateOption}
              className="mt-4 w-full py-2.5 rounded-xl border border-dashed border-border text-sm text-text-secondary flex items-center justify-center gap-2"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add another date option
            </button>
          )}
        </section>

        {/* Collect availability CTA */}
        <section className="bg-accent/10 border border-accent/30 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-semibold text-accent">Collect Team Availability</p>
            <button onClick={() => setShowTooltip((v) => !v)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
              </svg>
            </button>
          </div>
          {showTooltip && (
            <div className="bg-surface border border-border rounded-xl p-3 mb-3 text-xs text-text-secondary space-y-1">
              <p>• Notify your players to submit availability for the date options above.</p>
              <p>• Collecting availability before posting helps find an opponent sooner.</p>
              <p>• Players receive a notification on their home page.</p>
            </div>
          )}
          <p className="text-xs text-text-secondary mb-3">
            Send your squad a notification to mark which dates they're available. The best date will be highlighted automatically.
          </p>
          <a
            href="/my-team/availability"
            className="block w-full py-2.5 rounded-xl bg-accent text-black font-bold text-sm text-center"
          >
            Send Availability Request
          </a>
        </section>

        {/* Pitch options */}
        <section className="bg-surface-2 border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
            </svg>
            <p className="text-sm font-semibold">Pitch Options</p>
            <span className="text-xs text-text-secondary ml-auto">{pitchOptions.length}/3</span>
          </div>
          <p className="text-xs text-text-secondary mb-3">
            Add up to 3 preferred pitches in order of preference. The opposing team picks from these when challenging. If your first choice has no available slots, the next option is used automatically.
          </p>

          {pitchOptions.length > 0 && (
            <div className="flex flex-col gap-2 mb-3">
              {pitchOptions.map((p, i) => (
                <div key={p.id} className="flex items-center gap-3 bg-background border border-border rounded-xl px-3 py-2.5">
                  <div className="w-7 h-7 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-[10px] font-bold text-accent">{i + 1}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{p.name}</p>
                    <p className="text-xs text-text-secondary">{p.format} · £{p.price}/hr · {p.distance}</p>
                  </div>
                  <span className="text-[10px] text-text-secondary flex-shrink-0">{rankLabels[i]}</span>
                  <button onClick={() => removePitchOption(p.id)} className="text-xs text-red-400 flex-shrink-0 ml-1">✕</button>
                </div>
              ))}
            </div>
          )}

          {pitchOptions.length < 3 && (
            <a
              href="/pitches?mode=select"
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-dashed border-border text-sm text-text-secondary"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add Pitch Option
            </a>
          )}
        </section>

        {/* Description */}
        <section className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold">Description</label>
          <textarea
            rows={4}
            placeholder="Tell teams what to expect..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/50 resize-none"
          />
        </section>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={() => router.back()}
            className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold text-text-secondary"
          >
            Cancel
          </button>
          <button className="flex-1 py-3 rounded-xl bg-accent text-black font-bold text-sm">
            Create Post
          </button>
        </div>
      </div>
    </div>
  );
}
