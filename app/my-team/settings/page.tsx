"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import InviteLinkPanel from "@/components/my-team/InviteLinkPanel";

// Team Settings is cut back to the joining fee for now. The team profile
// fields (history, play style, photo) still live on `teams` and are still
// rendered by /my-team/[teamId] — only the editors are gone from this page,
// so nothing already saved is lost.
type Team = {
  id: string;
  name: string;
  captain_id: string;
  joining_fee_pence?: number | null;
};

export default function TeamSettingsPage() {
  const { user } = useAuth();
  const [team, setTeam] = useState<Team | null | undefined>(undefined);
  const [joiningFee, setJoiningFee] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    // select("*") rather than named columns so the page still loads when the
    // joining-fees migration hasn't been run (a named select of a missing
    // column fails the whole query).
    supabase.from("teams").select("*")
      .eq("captain_id", user.id).maybeSingle()
      .then(({ data }) => {
        setTeam(data ?? null);
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
    setError(null);
    const { error: saveErr } = await supabase.from("teams").update({
      joining_fee_pence: joiningFeePence,
    }).eq("id", team.id);
    setSaving(false);
    // The fee is the only thing this page saves now, so a missing column is a
    // hard failure rather than something to save around — say so plainly
    // instead of reporting a save that didn't happen.
    if (saveErr) {
      setError(/joining_fee_pence/.test(saveErr.message)
        ? "Run supabase_joining_fees.sql in Supabase first — the fee column isn't there yet."
        : "Couldn't save the joining fee. Please try again.");
      return;
    }
    setSaved(true);
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
          <p className="text-xs text-text-secondary mt-0.5">Invite link and joining fee for {team.name}</p>
        </div>
      </header>

      <InviteLinkPanel teamId={team.id} teamName={team.name} />

      <div className="flex flex-col gap-5">
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

        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-btn px-3 py-2.5">{error}</p>
        )}

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
          ) : saved ? "Saved ✓" : "Save Joining Fee"}
        </button>
      </div>
    </div>
  );
}
