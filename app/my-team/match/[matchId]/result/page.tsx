"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type Match = {
  id: string;
  posting_team_id: string;
  challenging_team_id: string;
  match_date: string;
};

type RosterPlayer = { player_id: string; name: string };
type PlayerStats = { goals: number; assists: number };

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
    async function load() {
      const { data: m } = await supabase.from("matches")
        .select("id, posting_team_id, challenging_team_id, match_date")
        .eq("id", params.matchId).maybeSingle();
      if (!m) { setMatch(null); return; }
      setMatch(m);

      const { data: captainTeam } = await supabase.from("teams").select("id, name").eq("captain_id", user!.id).maybeSingle();
      let tid = captainTeam?.id ?? null;
      let resolvedName = captainTeam?.name;
      if (!tid) {
        // Fallback: generic lookup can fail if captain_id isn't set correctly.
        // Check the two teams in this match directly.
        const { data: matchTeams } = await supabase.from("teams").select("id, name, captain_id").in("id", [m.posting_team_id, m.challenging_team_id]);
        const myTeam = (matchTeams ?? []).find((t) => t.captain_id === user!.id);
        if (myTeam) { tid = myTeam.id; resolvedName = myTeam.name; }
      }
      setMyTeamId(tid);
      if (resolvedName) setMyTeamName(resolvedName);

      const oppId = m.posting_team_id === tid ? m.challenging_team_id : m.posting_team_id;
      const { data: oppTeam } = await supabase.from("teams").select("name").eq("id", oppId).maybeSingle();
      if (oppTeam?.name) setOpponentName(oppTeam.name);

      if (tid) {
        const [{ data: members }, { data: team }] = await Promise.all([
          supabase.from("team_members").select("player_id, profiles(full_name)").eq("team_id", tid).eq("status", "approved"),
          supabase.from("teams").select("captain_id").eq("id", tid).maybeSingle(),
        ]);
        const { data: captainProfile } = team?.captain_id
          ? await supabase.from("profiles").select("full_name").eq("id", team.captain_id).maybeSingle()
          : { data: null };
        const rosterList: RosterPlayer[] = [
          ...(team?.captain_id ? [{ player_id: team.captain_id as string, name: captainProfile?.full_name ?? "Captain" }] : []),
          ...(members ?? []).map((mm) => ({ player_id: mm.player_id as string, name: (mm.profiles as unknown as { full_name: string } | null)?.full_name ?? "Player" })),
        ].filter((p, i, arr) => arr.findIndex((x) => x.player_id === p.player_id) === i);
        setRoster(rosterList);

        const { data: existingResult } = await supabase.from("match_results")
          .select("team_score, opponent_score").eq("match_id", params.matchId).eq("team_id", tid).maybeSingle();
        setAlreadySubmitted(!!existingResult);
        if (existingResult) {
          setTeamScore(String(existingResult.team_score));
          setOpponentScore(String(existingResult.opponent_score));
        }
        const { data: existingPlayers } = await supabase.from("match_result_players")
          .select("player_id, goals, assists").eq("match_id", params.matchId).eq("team_id", tid);
        if (existingPlayers && existingPlayers.length > 0) {
          const prefill: Record<string, PlayerStats> = {};
          for (const p of existingPlayers) {
            if (p.goals > 0 || p.assists > 0) {
              prefill[p.player_id] = { goals: p.goals, assists: p.assists ?? 0 };
            }
          }
          setStats(prefill);
        }
      }
    }
    load();
  }, [user, params.matchId]);

  const setStat = (playerId: string, field: keyof PlayerStats, value: number) => {
    setStats((prev) => ({
      ...prev,
      [playerId]: { ...(prev[playerId] ?? { goals: 0, assists: 0 }), [field]: value },
    }));
  };

  const totalGoals = Object.values(stats).reduce((s, p) => s + p.goals, 0);
  const totalAssists = Object.values(stats).reduce((s, p) => s + p.assists, 0);
  const ts = parseInt(teamScore, 10);

  const handleSubmit = async () => {
    if (!user || !myTeamId || !match) return;
    const m = match;
    if (teamScore.trim() === "" || opponentScore.trim() === "") {
      setError("Enter the final score for both teams.");
      return;
    }
    if (isNaN(ts) || isNaN(parseInt(opponentScore, 10)) || ts < 0 || parseInt(opponentScore, 10) < 0) {
      setError("Scores must be valid non-negative numbers.");
      return;
    }
    if (totalGoals !== ts) {
      setError(`Goals scored by players (${totalGoals}) must add up exactly to your team's score (${ts}).`);
      return;
    }
    if (totalAssists > ts) {
      setError(`Total assists (${totalAssists}) can't exceed total goals (${ts}).`);
      return;
    }

    setSaving(true);
    setError(null);
    const os = parseInt(opponentScore, 10);

    await supabase.from("match_results").upsert({
      match_id: params.matchId,
      team_id: myTeamId,
      team_score: ts,
      opponent_score: os,
      submitted_by: user.id,
    }, { onConflict: "match_id,team_id" });

    // Delete old player rows then insert fresh ones (only players with any stat).
    await supabase.from("match_result_players").delete()
      .eq("match_id", params.matchId).eq("team_id", myTeamId);

    const playerRows = Object.entries(stats)
      .filter(([, p]) => p.goals > 0 || p.assists > 0)
      .map(([playerId, p]) => ({
        match_id: params.matchId,
        team_id: myTeamId,
        player_id: playerId,
        started: false,
        subbed_on: false,
        goals: p.goals,
        assists: p.assists,
      }));
    if (playerRows.length > 0) {
      await supabase.from("match_result_players").insert(playerRows);
    }

    const oppTeamId = m.posting_team_id === myTeamId ? m.challenging_team_id : m.posting_team_id;
    const { data: oppResult } = await supabase.from("match_results")
      .select("team_score, opponent_score, submitted_by").eq("match_id", params.matchId).eq("team_id", oppTeamId).maybeSingle();

    if (oppResult) {
      const scoresMatch = oppResult.team_score === os && oppResult.opponent_score === ts;
      if (scoresMatch) {
        await supabase.from("matches").update({ result_submitted: true, result_verified: true }).eq("id", params.matchId);
      } else {
        await supabase.from("match_results").delete().eq("match_id", params.matchId);
        await supabase.from("matches").update({ result_submitted: false, result_verified: false }).eq("id", params.matchId);
        const msg = `⚠️ Score conflict for your match on ${m.match_date}. Please re-submit the correct result.`;
        await supabase.from("messages").insert([
          { sender_id: user.id, receiver_id: oppResult.submitted_by, type: "score_conflict", body: msg },
          { sender_id: user.id, receiver_id: user.id, type: "score_conflict", body: `⚠️ Score conflict on ${m.match_date}. Your submission differed from the opponent's. Please re-submit.` },
        ]);
        setSaving(false);
        setError("Score conflict: the opponent submitted a different result. Both submissions have been cleared — please coordinate and re-submit.");
        return;
      }
    }

    setSaving(false);
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
