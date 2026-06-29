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
type Participation = { started: boolean; subbedOn: boolean; goals: number };

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
  const [participation, setParticipation] = useState<Record<string, Participation>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const { data: m } = await supabase.from("matches")
        .select("id, posting_team_id, challenging_team_id, match_date, result_submitted")
        .eq("id", params.matchId).maybeSingle();
      if (!m) { setMatch(null); return; }
      setMatch(m);
      setAlreadySubmitted(!!m.result_submitted);

      const { data: captainTeam } = await supabase.from("teams").select("id, name").eq("captain_id", user!.id).maybeSingle();
      const tid = captainTeam?.id ?? null;
      setMyTeamId(tid);
      if (captainTeam?.name) setMyTeamName(captainTeam.name);

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

        const { data: existingResult } = await supabase.from("match_results").select("team_score, opponent_score").eq("match_id", params.matchId).eq("team_id", tid).maybeSingle();
        if (existingResult) {
          setTeamScore(String(existingResult.team_score));
          setOpponentScore(String(existingResult.opponent_score));
        }
        const { data: existingPlayers } = await supabase.from("match_result_players").select("player_id, started, subbed_on, goals").eq("match_id", params.matchId).eq("team_id", tid);
        if (existingPlayers && existingPlayers.length > 0) {
          const prefill: Record<string, Participation> = {};
          for (const p of existingPlayers) {
            prefill[p.player_id] = { started: p.started, subbedOn: p.subbed_on, goals: p.goals };
          }
          setParticipation(prefill);
        }
      }
    }
    load();
  }, [user, params.matchId]);

  const setField = (playerId: string, field: keyof Participation, value: boolean | number) => {
    setParticipation((prev) => {
      const current = prev[playerId] ?? { started: false, subbedOn: false, goals: 0 };
      const updated = { ...current, [field]: value };
      if (field === "started" && value === true) updated.subbedOn = false;
      if (field === "subbedOn" && value === true) updated.started = false;
      return { ...prev, [playerId]: updated };
    });
  };

  const handleSubmit = async () => {
    if (!user || !myTeamId) return;
    if (teamScore.trim() === "" || opponentScore.trim() === "") {
      setError("Enter the final score for both teams.");
      return;
    }
    const ts = parseInt(teamScore, 10);
    const os = parseInt(opponentScore, 10);
    if (isNaN(ts) || isNaN(os) || ts < 0 || os < 0) {
      setError("Scores must be valid non-negative numbers.");
      return;
    }
    const participants = Object.entries(participation).filter(([, p]) => p.started || p.subbedOn);
    if (participants.length === 0) {
      setError("Tick at least one player who started or was subbed on.");
      return;
    }
    setSaving(true);
    setError(null);

    await supabase.from("match_results").upsert({
      match_id: params.matchId,
      team_id: myTeamId,
      team_score: ts,
      opponent_score: os,
      submitted_by: user.id,
    }, { onConflict: "match_id,team_id" });

    await supabase.from("match_result_players").upsert(
      participants.map(([playerId, p]) => ({
        match_id: params.matchId,
        team_id: myTeamId,
        player_id: playerId,
        started: p.started,
        subbed_on: p.subbedOn,
        goals: p.goals,
      })),
      { onConflict: "match_id,player_id" }
    );

    await supabase.from("matches").update({ result_submitted: true }).eq("id", params.matchId);

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
        <a href="/my-team/history" className="px-6 py-3 rounded-xl bg-accent text-black font-bold text-sm mt-2">Back to History</a>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen px-4 pt-12 pb-8">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.back()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
        </button>
        <div>
          <h1 className="text-xl font-bold">Submit Result</h1>
          <p className="text-xs text-text-secondary mt-0.5">{myTeamName} vs {opponentName}</p>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        {alreadySubmitted && (
          <div className="bg-accent/10 border border-accent/30 rounded-xl px-4 py-3">
            <p className="text-xs text-accent">A result has already been submitted for this match — saving again will update it.</p>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Score */}
        <section className="bg-surface-2 border border-border rounded-2xl p-4">
          <p className="text-sm font-semibold mb-3">Final Score</p>
          <div className="flex items-center gap-3">
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="text-xs text-text-secondary truncate">{myTeamName}</label>
              <input type="number" min={0} inputMode="numeric" value={teamScore} onChange={(e) => setTeamScore(e.target.value)}
                className="bg-background border border-border rounded-xl px-3 py-2.5 text-center text-lg font-bold outline-none focus:border-accent/50" />
            </div>
            <span className="text-text-secondary font-bold pt-5">–</span>
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="text-xs text-text-secondary truncate">{opponentName}</label>
              <input type="number" min={0} inputMode="numeric" value={opponentScore} onChange={(e) => setOpponentScore(e.target.value)}
                className="bg-background border border-border rounded-xl px-3 py-2.5 text-center text-lg font-bold outline-none focus:border-accent/50" />
            </div>
          </div>
        </section>

        {/* Squad participation + scorers */}
        <section className="bg-surface-2 border border-border rounded-2xl p-4">
          <p className="text-sm font-semibold mb-1">Who Played</p>
          <p className="text-xs text-text-secondary mb-3">Tick Started or Subbed On for each player who took part, and add their goals.</p>
          <div className="space-y-2">
            {roster.map((p) => {
              const part = participation[p.player_id] ?? { started: false, subbedOn: false, goals: 0 };
              const participated = part.started || part.subbedOn;
              return (
                <div key={p.player_id} className="bg-background border border-border rounded-xl px-3 py-2.5">
                  <p className="text-sm font-medium mb-2 truncate">{p.player_id === user?.id ? "You" : p.name}</p>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setField(p.player_id, "started", !part.started)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${part.started ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>
                      Started
                    </button>
                    <button type="button" onClick={() => setField(p.player_id, "subbedOn", !part.subbedOn)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${part.subbedOn ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>
                      Subbed On
                    </button>
                    <div className="flex items-center gap-2 ml-auto">
                      <button type="button" disabled={!participated} onClick={() => setField(p.player_id, "goals", Math.max(0, part.goals - 1))}
                        className="w-6 h-6 rounded-full bg-surface-2 border border-border flex items-center justify-center text-text-secondary disabled:opacity-30">−</button>
                      <span className="text-sm font-bold w-6 text-center">{part.goals}</span>
                      <button type="button" disabled={!participated} onClick={() => setField(p.player_id, "goals", part.goals + 1)}
                        className="w-6 h-6 rounded-full bg-surface-2 border border-border flex items-center justify-center text-text-secondary disabled:opacity-30">+</button>
                      <span className="text-[10px] text-text-secondary flex-shrink-0">goals</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <button onClick={handleSubmit} disabled={saving}
          className="w-full py-3.5 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
          {saving ? (
            <><svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Submitting…</>
          ) : "Submit Result"}
        </button>
      </div>
    </div>
  );
}
