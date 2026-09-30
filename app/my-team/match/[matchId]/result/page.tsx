"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import {
  loadResultForm, validateResult, submitMatchResult, totalOf, SCORE_CONFLICT_MESSAGE,
  type ResultMatch as Match, type RosterPlayer, type PlayerStats,
} from "@/lib/submit-result";

function Counter({
  value, onChange, disabled, min = 0, max,
}: { value: number; onChange: (n: number) => void; disabled?: boolean; min?: number; max?: number }) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min ?? 0, value - 1))}
        className="w-7 h-7 rounded-full bg-surface-2 border border-border flex items-center justify-center text-text-secondary disabled:opacity-30 text-sm">−</button>
      <span className="text-sm font-bold w-5 text-center">{value}</span>
      <button type="button" disabled={disabled || (max !== undefined && value >= max)}
        onClick={() => onChange(value + 1)}
        className="w-7 h-7 rounded-full bg-surface-2 border border-border flex items-center justify-center text-text-secondary disabled:opacity-30 text-sm">+</button>
    </div>
  );
}

export default function SubmitResultPage({ params }: { params: { matchId: string } }) {
  const router = useRouter();
  const { user } = useAuth();
  const [match, setMatch] = useState<Match | null | undefined>(undefined);
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [myTeamName, setMyTeamName] = useState("Your Team");
  const [opponentName, setOpponentName] = useState("Opponent");
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [teamScore, setTeamScore] = useState("");
  const [opponentScore, setOpponentScore] = useState("");
  const [stats, setStats] = useState<Record<string, PlayerStats>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);

  useEffect(() => {
    if (!user) return;
    // The load, the rules and the write all live in lib/submit-result.ts,
    // shared with the mobile app.
    async function load() {
      const form = await loadResultForm(params.matchId, user!.id);
      if (!form) { setMatch(null); return; }
      setMatch(form.match);
      setMyTeamId(form.myTeamId);
      setMyTeamName(form.myTeamName);
      setOpponentName(form.opponentName);
      setRoster(form.roster);
      setAlreadySubmitted(!!form.existing);
      if (form.existing) {
        setTeamScore(String(form.existing.teamScore));
        setOpponentScore(String(form.existing.opponentScore));
      }
      setStats(form.stats);
    }
    load();
  }, [user, params.matchId]);

  const setStat = (playerId: string, field: keyof PlayerStats, value: number) => {
    setStats((prev) => ({
      ...prev,
      [playerId]: { ...(prev[playerId] ?? { goals: 0, assists: 0 }), [field]: value },
    }));
  };

  const totalGoals = totalOf(stats, "goals");
  const totalAssists = totalOf(stats, "assists");
  const ts = parseInt(teamScore, 10);

  const handleSubmit = async () => {
    if (!user || !myTeamId || !match) return;
    const invalid = validateResult(teamScore, opponentScore, stats);
    if (invalid) { setError(invalid); return; }

    setSaving(true);
    setError(null);
    const { conflict } = await submitMatchResult({
      match, myTeamId, userId: user.id,
      teamScore: ts, opponentScore: parseInt(opponentScore, 10), stats,
    });
    setSaving(false);
    if (conflict) { setError(SCORE_CONFLICT_MESSAGE); return; }
    router.push("/my-team/history");
  };

  if (match === undefined) {
    return <div className="flex items-center justify-center min-h-screen"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;
  }
  if (!match) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center gap-3">
        <p className="font-semibold">Match not found</p>
        <a href="/my-team/history" className="px-6 py-3 rounded-btn bg-accent text-white font-bold text-sm mt-2">Back to History</a>
      </div>
    );
  }

  const goalsLeft = ts - totalGoals;

  return (
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-8">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.back()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
        </button>
        <div>
          <h1 className="text-xl font-extrabold">Submit Result</h1>
          <p className="text-xs text-text-secondary mt-0.5">{myTeamName} vs {opponentName}</p>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        {alreadySubmitted && (
          <div className="bg-accent/10 border border-accent/30 rounded-xl px-4 py-3">
            <p className="text-xs text-accent-ink">A result has already been submitted — saving again will update it.</p>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Score */}
        <section className="bg-surface border border-border shadow-card rounded-card p-4">
          <p className="text-sm font-semibold mb-3">Final Score</p>
          <div className="flex items-end gap-3">
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-text-primary">Your Team</label>
              <input type="number" min={0} inputMode="numeric" value={teamScore}
                onChange={(e) => setTeamScore(e.target.value)}
                className="bg-background border border-border rounded-xl px-3 py-2.5 text-center text-2xl font-extrabold outline-none focus:border-accent/50" />
            </div>
            <span className="text-text-secondary font-bold pb-3">–</span>
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-text-primary">Opponent</label>
              <input type="number" min={0} inputMode="numeric" value={opponentScore}
                onChange={(e) => setOpponentScore(e.target.value)}
                className="bg-background border border-border rounded-xl px-3 py-2.5 text-center text-2xl font-extrabold outline-none focus:border-accent/50" />
            </div>
          </div>
        </section>

        {/* Goals */}
        <section className="bg-surface border border-border shadow-card rounded-card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-semibold">Goalscorers</p>
            {!isNaN(ts) && ts > 0 && (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${goalsLeft === 0 ? "bg-accent/10 text-accent-ink" : "bg-yellow-500/10 text-yellow-600"}`}>
                {goalsLeft === 0 ? "✓ All accounted for" : `${goalsLeft} goal${goalsLeft !== 1 ? "s" : ""} left`}
              </span>
            )}
          </div>
          <p className="text-xs text-text-secondary mb-3">
            Goals per player must add up to your team&apos;s score exactly.
          </p>
          <div className="space-y-2">
            {roster.map((p) => {
              const playerStats = stats[p.player_id] ?? { goals: 0, assists: 0 };
              return (
                <div key={p.player_id} className="flex items-center gap-3 bg-background border border-border rounded-xl px-3 py-2.5">
                  <p className="flex-1 text-sm font-medium truncate">{p.player_id === user?.id ? "You" : p.name}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-text-secondary">⚽</span>
                    <Counter
                      value={playerStats.goals}
                      onChange={(n) => setStat(p.player_id, "goals", n)}
                      max={isNaN(ts) ? undefined : ts - totalGoals + playerStats.goals}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Assists */}
        <section className="bg-surface border border-border shadow-card rounded-card p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-semibold">Assists</p>
            <span className="text-xs text-text-secondary">{totalAssists} total</span>
          </div>
          <p className="text-xs text-text-secondary mb-3">
            Assists don&apos;t need to match exactly — total must not exceed goals scored.
          </p>
          <div className="space-y-2">
            {roster.map((p) => {
              const playerStats = stats[p.player_id] ?? { goals: 0, assists: 0 };
              return (
                <div key={p.player_id} className="flex items-center gap-3 bg-background border border-border rounded-xl px-3 py-2.5">
                  <p className="flex-1 text-sm font-medium truncate">{p.player_id === user?.id ? "You" : p.name}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-text-secondary">🅰️</span>
                    <Counter
                      value={playerStats.assists}
                      onChange={(n) => setStat(p.player_id, "assists", n)}
                      max={isNaN(ts) ? undefined : ts - totalAssists + playerStats.assists}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <button onClick={handleSubmit} disabled={saving}
          className="w-full py-3.5 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
          {saving ? (
            <><svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Submitting…</>
          ) : "Submit Result"}
        </button>
      </div>
    </div>
  );
}
