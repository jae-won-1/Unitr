"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type Team = {
  id: string;
  name: string;
  captain_id: string;
  history: string | null;
  play_style: string | null;
  photo_url: string | null;
  joining_fee_pence?: number | null;
};

export default function TeamSettingsPage() {
  const { user } = useAuth();
  const [team, setTeam] = useState<Team | null | undefined>(undefined);
  const [history, setHistory] = useState("");
  const [playStyle, setPlayStyle] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [joiningFee, setJoiningFee] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!user) return;
    // select("*") rather than named columns so the page still loads when the
    // joining-fees migration hasn't been run (a named select of a missing
    // column fails the whole query).
    supabase.from("teams").select("*")
      .eq("captain_id", user.id).maybeSingle()
      .then(({ data }) => {
        setTeam(data ?? null);
        setHistory(data?.history ?? "");
        setPlayStyle(data?.play_style ?? "");
        setPhotoUrl(data?.photo_url ?? "");
        const feePence = data?.joining_fee_pence ?? 0;
        setJoiningFee(feePence > 0 ? (feePence / 100).toFixed(2).replace(/\.00$/, "") : "");
      });
  }, [user]);

  const joiningFeePence = joiningFee ? Math.round(parseFloat(joiningFee) * 100) : 0;
  const feeValid = Number.isFinite(joiningFeePence) && joiningFeePence >= 0;

  const handleSave = async () => {
    if (!team || !feeValid) return;
    setSaving(true);
    setSaved(false);
    let { error } = await supabase.from("teams").update({
      history: history || null,
      play_style: playStyle || null,
      photo_url: photoUrl || null,
      joining_fee_pence: joiningFeePence,
    }).eq("id", team.id);
    // Missing-migration guard: save the rest even if the fee column isn't there.
    if (error && /joining_fee_pence/.test(error.message)) {
      ({ error } = await supabase.from("teams").update({
        history: history || null,
        play_style: playStyle || null,
        photo_url: photoUrl || null,
      }).eq("id", team.id));
    }
    setSaving(false);
    setSaved(!error);
  };

  if (team === undefined) {
    return <div className="flex items-center justify-center min-h-screen"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;
  }

  if (!team) {
    return (
      <div className="flex items-center justify-center min-h-screen px-4">
        <p className="text-text-secondary">Only the team captain can edit team settings.</p>
      </div>
    );
  }

  const initials = team.name.split(" ").map((w) => w[0]).join("").slice(0, 2);

  return (
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-8">
      <header className="flex items-center gap-3 mb-8">
        <a href="/my-team" className="w-9 h-9 rounded-full bg-surface-2 border border-border flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </a>
        <div>
          <h1 className="text-xl font-extrabold">Team Settings</h1>
          <p className="text-xs text-text-secondary mt-0.5">Profile and joining fee for {team.name}</p>
        </div>
      </header>

      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-secondary">Team Photo <span className="text-text-secondary font-normal">(image URL)</span></label>
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-accent/10 border-2 border-accent flex items-center justify-center overflow-hidden flex-shrink-0">
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl} alt={team.name} className="w-full h-full object-cover" />
              ) : (
                <span className="text-lg font-bold text-accent-ink">{initials}</span>
              )}
            </div>
            <input
              type="text"
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
              placeholder="https://…"
              className="flex-1 bg-surface border border-border rounded-btn px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-secondary">Play Style</label>
          <input
            type="text"
            value={playStyle}
            onChange={(e) => setPlayStyle(e.target.value)}
            placeholder="e.g. High press, quick transitions"
            className="bg-surface border border-border rounded-btn px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-secondary">Team History</label>
          <textarea
            rows={5}
            value={history}
            onChange={(e) => setHistory(e.target.value)}
            placeholder="How the team started, honours, notable seasons…"
            className="bg-surface border border-border rounded-btn px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60 resize-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-secondary">Joining fee</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-text-secondary">£</span>
            <input
              type="number"
              min={0}
              step={1}
              inputMode="decimal"
              value={joiningFee}
              onChange={(e) => setJoiningFee(e.target.value)}
              placeholder="0 — no joining fee"
              className="w-full bg-surface border border-border rounded-btn pl-8 pr-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60"
            />
          </div>
          <p className="text-xs text-text-secondary">
            Paid once by each new player, into your team&rsquo;s credit balance for pitch and
            tournament fees. Changing it only affects players who join from now on — the squad
            you already have keeps the fee they signed up under.
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || !feeValid}
          className="w-full py-3.5 rounded-btn bg-accent text-white font-bold text-sm mt-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              Saving…
            </>
          ) : saved ? "Saved ✓" : "Save Team Settings"}
        </button>
      </div>
    </div>
  );
}
