"use client";

// ── Manage Tournament Fixture ─────────────────────────────────────────
// The tournament-side twin of /my-team/match/[matchId]. A tournament is one
// commitment on the Calendar but several games on the day, and each of those
// games wants the same three things a friendly wants: who's coming, who starts,
// and how we're playing it.
//
// Two things are deliberately NOT duplicated from the friendly page:
//
//  * Availability is per TOURNAMENT, not per fixture. A squad answers "am I
//    playing on Saturday?" once, when the team enters (lib/event-availability.ts),
//    and that answer covers every game of the day. Asking again per fixture
//    would be the same question three times.
//  * Results belong to the organiser. Scores are entered on
//    /play/tournament/[id] and nowhere else, so there is no Submit Result here —
//    just the score once it exists.

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { FORMATION_KEYS, slotsFor, PLAY_STYLES } from "@/lib/formations";
import { loadTeamTactics, type TeamTactic } from "@/components/my-team/TacticsTab";
import AvailabilityButtons from "@/components/AvailabilityButtons";
import { fmtKickoff } from "@/lib/match-dates";
import {
  loadTournamentFixture, loadFixtureTactics, saveFixtureTactics, sideOf,
  EMPTY_TACTICS, type TeamTournamentFixture, type FixtureTactics,
} from "@/lib/tournament-match";

type Tournament = { id: string; title: string; match_date: string; start_time: string; pitch_name: string };

type SquadMember = { player_id: string; full_name: string; status: string; is_ringer: boolean };

type Tab = "info" | "attendance" | "lineup" | "tactics";
const TABS: { key: Tab; label: string }[] = [
  { key: "info", label: "Info" },
  { key: "attendance", label: "Attendance" },
  { key: "lineup", label: "Lineup" },
  { key: "tactics", label: "Tactics" },
];

const TACTICS_MISSING_MSG =
  "Fixture lineups aren't set up yet — run supabase_tournament_match_tactics.sql.";

const initialsOf = (name: string) =>
  name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

function StatusBadge({ status }: { status: string }) {
  if (status === "confirmed") return <span className="text-[10px] font-semibold bg-accent/10 text-accent-ink border border-accent/20 px-2 py-0.5 rounded-full">In</span>;
  if (status === "declined") return <span className="text-[10px] font-semibold bg-red-500/10 text-red-600 border border-red-500/20 px-2 py-0.5 rounded-full">Out</span>;
  return <span className="text-[10px] font-semibold bg-yellow-500/10 text-yellow-600 border border-yellow-500/20 px-2 py-0.5 rounded-full">Pending</span>;
}

// The same pitch the friendly page draws. Only the markings live here — the
// dots are the caller's, placed from slotsFor(), so there is exactly one source
// of slot order (lib/formations.ts) and a lineup can't be read back against a
// different one.
function PitchBoard({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative w-full rounded-2xl overflow-hidden" style={{ paddingBottom: "130%", background: "linear-gradient(180deg,#1a5c1a 0%,#1e6b1e 25%,#1a5c1a 50%,#1e6b1e 75%,#1a5c1a 100%)" }}>
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 130" preserveAspectRatio="none">
        <rect x="5" y="5" width="90" height="120" rx="1" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
        <line x1="5" y1="65" x2="95" y2="65" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
        <circle cx="50" cy="65" r="10" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
        <rect x="22" y="5" width="56" height="18" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
        <rect x="22" y="107" width="56" height="18" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
      </svg>
      {children}
    </div>
  );
}

export default function ManageTournamentFixturePage({ params }: { params: { fixtureId: string } }) {
  const { user } = useAuth();

  const [fixture, setFixture] = useState<TeamTournamentFixture | null | undefined>(undefined);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [myTeamName, setMyTeamName] = useState<string>("Your team");
  const [isCaptain, setIsCaptain] = useState(false);
  const [squad, setSquad] = useState<SquadMember[]>([]);
  const [tab, setTab] = useState<Tab>("info");

  const [tactics, setTactics] = useState<FixtureTactics>({ ...EMPTY_TACTICS });
  const [tacticsAvailable, setTacticsAvailable] = useState(true);
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [presets, setPresets] = useState<TeamTactic[] | null>([]);
  const [presetPickerOpen, setPresetPickerOpen] = useState(false);

  // ── Fixture + the team the viewer is here as ──────────────────────
  useEffect(() => {
    if (!user) return;
    const uid = user.id;
    (async () => {
      const fx = await loadTournamentFixture(params.fixtureId);
      if (!fx) { setFixture(null); return; }
      setFixture(fx);

      const { data: om } = await supabase.from("open_matches")
        .select("id, title, match_date, start_time, pitch_name")
        .eq("id", fx.openMatchId).maybeSingle();
      setTournament((om ?? null) as Tournament | null);

      // Same resolution the friendly page uses: captain first, then an approved
      // membership. A captain is a squad member too, so both paths land on a team.
      const { data: captainTeam } = await supabase.from("teams")
        .select("id, name").eq("captain_id", uid).maybeSingle();
      let tid = captainTeam?.id ?? null;
      let tname: string | null = captainTeam?.name ?? null;
      if (!tid) {
        const { data: mem } = await supabase.from("team_members")
          .select("team_id").eq("player_id", uid).eq("status", "approved").maybeSingle();
        tid = mem?.team_id ?? null;
        if (tid) {
          const { data: t } = await supabase.from("teams").select("name").eq("id", tid).maybeSingle();
          tname = t?.name ?? null;
        }
      }
      setMyTeamId(tid);
      setIsCaptain(Boolean(captainTeam && captainTeam.id === tid));
      if (tname) setMyTeamName(tname);
    })();
  }, [user, params.fixtureId]);

  // ── The squad's answers ───────────────────────────────────────────
  // Against the TOURNAMENT, not this fixture — one answer covers the day.
  const loadSquad = useCallback(async () => {
    if (!fixture || !myTeamId) return;
    type ConfRow = { player_id: string; status: string; is_ringer?: boolean; profiles: { full_name: string } | null };
    // is_ringer arrives with supabase_ringers.sql; selecting a column that
    // isn't there fails the whole query, so fall back to the older shape.
    const withRinger = await supabase.from("match_confirmations")
      .select("player_id, status, is_ringer, profiles(full_name)")
      .eq("open_match_id", fixture.openMatchId).eq("team_id", myTeamId);
    const rows = (withRinger.data ?? (await supabase.from("match_confirmations")
      .select("player_id, status, profiles(full_name)")
      .eq("open_match_id", fixture.openMatchId).eq("team_id", myTeamId)).data) as ConfRow[] | null;

    setSquad((rows ?? []).map((c) => ({
      player_id: c.player_id,
      full_name: (c.profiles as unknown as { full_name: string } | null)?.full_name ?? "Player",
      status: c.status,
      is_ringer: Boolean(c.is_ringer),
    })));
  }, [fixture, myTeamId]);

  useEffect(() => { loadSquad(); }, [loadSquad]);

  // ── This team's plan for this fixture ─────────────────────────────
  useEffect(() => {
    if (!myTeamId) return;
    loadFixtureTactics(params.fixtureId, myTeamId).then((t) => {
      if (t === null) { setTacticsAvailable(false); return; }
      setTacticsAvailable(true);
      setTactics(t);
    });
  }, [params.fixtureId, myTeamId]);

  useEffect(() => {
    if (!myTeamId) return;
    loadTeamTactics(myTeamId).then(setPresets);
  }, [myTeamId]);

  const handleSave = async () => {
    if (!myTeamId) return;
    setSaving(true);
    setSaveError(null);
    const ok = await saveFixtureTactics(params.fixtureId, myTeamId, tactics);
    setSaving(false);
    if (!ok) setSaveError(TACTICS_MISSING_MSG);
  };

  if (fixture === undefined) {
    return <div className="flex items-center justify-center min-h-screen"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;
  }
  if (fixture === null) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-4 gap-4 text-center">
        <p className="text-text-secondary">Fixture not found.</p>
        <a href="/calendar" className="text-sm text-accent-ink font-medium">Back to Calendar</a>
      </div>
    );
  }

  const side = sideOf(fixture, myTeamId);
  const opponentName = side === "home" ? fixture.awayTeamName : side === "away" ? fixture.homeTeamName : null;
  const played = fixture.status === "played" && fixture.homeScore != null && fixture.awayScore != null;
  const myScore = side === "home" ? fixture.homeScore : fixture.awayScore;
  const oppScore = side === "home" ? fixture.awayScore : fixture.homeScore;

  const kickoff = tournament
    ? fmtKickoff(tournament.match_date, fixture.scheduledTime ?? tournament.start_time)
    : (fixture.scheduledTime ?? "");

  // Who can be put on the board: anyone who hasn't ruled themselves out. Same
  // rule as the friendly — a captain builds a shape before every reply lands,
  // and a pending player is still a candidate, badged as one below.
  const candidates = squad.filter((s) => s.status !== "declined");
  const nameById = new Map(squad.map((s) => [s.player_id, s.full_name]));
  const slots = slotsFor(tactics.formation);
  const canEdit = isCaptain && side !== null && tacticsAvailable;

  const setTac = (patch: Partial<FixtureTactics>) => setTactics((prev) => ({ ...prev, ...patch }));

  const header = side ? `${myTeamName} vs ${opponentName}` : `${fixture.homeTeamName} vs ${fixture.awayTeamName}`;

  return (
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-8">
      {/* Back goes to the tournament, not My Team: the fixture only makes sense
          inside its schedule, and that's where the score gets entered. */}
      <div className="flex items-center gap-3 mb-5">
        <a href={`/play/tournament/${fixture.openMatchId}`} aria-label="Back to tournament">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </a>
        <div className="flex-1 min-w-0">
          <h1 className="text-[17px] font-extrabold truncate">{header}</h1>
          <p className="text-[11px] text-text-secondary truncate">{tournament?.title ?? "Tournament"}</p>
        </div>
      </div>

      {side === null ? (
        <div className="bg-surface border border-border shadow-card rounded-card p-6 text-center space-y-2">
          <p className="text-sm font-semibold">Your team isn&apos;t in this fixture</p>
          <p className="text-xs text-text-secondary">
            {fixture.homeTeamName} play {fixture.awayTeamName}
            {kickoff ? ` · ${kickoff}` : ""}.
            {fixture.refereeName ? ` Referee: ${fixture.refereeName}.` : ""}
          </p>
          <a href={`/play/tournament/${fixture.openMatchId}`} className="inline-block text-sm text-accent-ink font-semibold">
            See the full schedule
          </a>
        </div>
      ) : (
        <>
          {/* One answer for the whole tournament — it sits above the tabs for
              the same reason it does on a friendly: it's what most people open
              this page to do, and it stays changeable until kickoff. */}
          {!played && myTeamId && user && (
            <div className="mb-4">
              <p className="text-[11px] text-text-secondary mb-1.5">
                Can you make this tournament? Your answer covers every game of the day.
              </p>
              <AvailabilityButtons
                openMatchId={fixture.openMatchId}
                playerId={user.id}
                teamId={myTeamId}
                onChanged={(status) => setSquad((prev) =>
                  prev.some((s) => s.player_id === user.id)
                    ? prev.map((s) => (s.player_id === user.id ? { ...s, status } : s))
                    : [...prev, { player_id: user.id, full_name: "You", status, is_ringer: false }]
                )}
              />
            </div>
          )}

          <div className="flex items-center gap-2 overflow-x-auto pb-1 mb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TABS.map((t) => (
              <button key={t.key} type="button" onClick={() => setTab(t.key)}
                className={`flex-shrink-0 px-4 py-2.5 rounded-[11px] text-xs border transition-colors ${
                  tab === t.key ? "bg-accent text-white border-accent font-bold" : "bg-surface text-text-secondary border-border font-semibold"}`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* ══ INFO ══════════════════════════════════════════════ */}
          {tab === "info" && (
            <div className="space-y-4">
              <div className="bg-surface border border-border shadow-card rounded-card pt-5 pb-4 px-4 space-y-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col items-center gap-2 flex-1">
                    <div className="w-12 h-12 rounded-full bg-[#E7F8EC] border border-[#B7E8C6] flex items-center justify-center">
                      <span className="text-sm font-extrabold text-accent-ink">{initialsOf(myTeamName)}</span>
                    </div>
                    <p className="text-xs font-bold text-center leading-tight">{myTeamName}</p>
                  </div>
                  <div className="flex flex-col items-center px-3">
                    {played ? (
                      <>
                        <p className="text-5xl font-extrabold tracking-tighter leading-none mb-1">{myScore} – {oppScore}</p>
                        <p className="text-[11px] text-text-secondary">Full time</p>
                      </>
                    ) : (
                      <p className="text-[13px] text-text-secondary font-medium">No result yet</p>
                    )}
                  </div>
                  <div className="flex flex-col items-center gap-2 flex-1">
                    <div className="w-12 h-12 rounded-full bg-surface-2 border border-border flex items-center justify-center">
                      <span className="text-sm font-extrabold text-text-secondary">{initialsOf(opponentName ?? "")}</span>
                    </div>
                    <p className="text-xs font-bold text-center leading-tight">{opponentName}</p>
                  </div>
                </div>

                <div className="border-t border-border pt-3 flex flex-col items-center gap-0.5">
                  {kickoff && <p className="text-xs font-medium text-text-secondary">{kickoff}</p>}
                  {tournament?.pitch_name && <p className="text-xs font-medium text-text-secondary">{tournament.pitch_name}</p>}
                  <p className="text-[11px] text-text-secondary">
                    {side === "home" ? "Home" : "Away"} · Game {fixture.slotIndex + 1}
                  </p>
                </div>

                <div className="border-t border-border pt-3 flex items-center gap-1.5 justify-center">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2" strokeLinecap="round"><path d="M4 4h16v12H5.17L4 17.17V4z"/></svg>
                  <span className="text-[11px] text-text-secondary">
                    Ref: {fixture.refereeName
                      ? <span className="text-text-primary font-medium">{fixture.refereeName}</span>
                      : "unassigned"}
                    {fixture.refereeTeamName ? ` (${fixture.refereeTeamName})` : ""}
                  </span>
                </div>
              </div>

              <div className="bg-surface border border-border shadow-card rounded-card p-4">
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5">The rest of the day</p>
                <p className="text-xs text-text-secondary">
                  Scores, referees and standings for every game are on the tournament page —
                  the organiser enters them there.
                </p>
                <a href={`/play/tournament/${fixture.openMatchId}`}
                  className="block w-full mt-3 py-2.5 rounded-xl border border-border text-sm font-semibold text-text-secondary text-center">
                  Open the schedule
                </a>
              </div>
            </div>
          )}

          {/* ══ ATTENDANCE ════════════════════════════════════════ */}
          {tab === "attendance" && (
            <div className="space-y-4">
              <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">
                {myTeamName} · your squad
              </p>
              <div className="grid grid-cols-3 gap-2">
                {([
                  ["Attendees", squad.filter((s) => s.status === "confirmed").length],
                  ["Awaiting reply", squad.filter((s) => s.status !== "confirmed" && s.status !== "declined").length],
                  ["Unavailable", squad.filter((s) => s.status === "declined").length],
                ] as const).map(([label, n]) => (
                  <div key={label} className="bg-surface border border-border rounded-btn p-3 text-center">
                    <p className="text-2xl font-extrabold">{n}</p>
                    <p className="text-[10px] text-text-secondary mt-0.5 leading-tight">{label}</p>
                  </div>
                ))}
              </div>

              <p className="text-[11px] text-text-secondary">
                These are answers for the tournament as a whole — the squad answers once for the day,
                not once per game.
              </p>

              <div className="bg-surface-2 border border-accent/30 rounded-2xl p-4">
                {squad.length === 0 ? (
                  <p className="text-xs text-text-secondary">
                    Nobody has answered yet. Availability rows are written when your team enters the tournament.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {squad.map((s) => (
                      <div key={s.player_id} className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                          <span className="text-[10px] font-semibold text-text-secondary">{initialsOf(s.full_name)}</span>
                        </div>
                        <p className="flex-1 text-sm truncate">{s.full_name}</p>
                        {s.is_ringer && (
                          <span className="text-[10px] font-semibold bg-blue-500/10 text-blue-600 border border-blue-500/20 px-2 py-0.5 rounded-full">Ringer</span>
                        )}
                        <StatusBadge status={s.status} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══ LINEUP ════════════════════════════════════════════ */}
          {tab === "lineup" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">{myTeamName} · Starting Lineup</p>
                <span className="text-[10px] text-text-secondary">{canEdit ? "Tap a position to assign" : "Set by captain"}</span>
              </div>

              {!tacticsAvailable && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3 py-2.5">
                  <p className="text-xs text-yellow-600">{TACTICS_MISSING_MSG}</p>
                </div>
              )}

              {canEdit && (
                <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {FORMATION_KEYS.map((f) => (
                    <button key={f} type="button" onClick={() => setTac({ formation: f })}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border ${
                        tactics.formation === f ? "bg-accent text-white border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>
                      {f}
                    </button>
                  ))}
                </div>
              )}

              <PitchBoard>
                {slots.map((pos, i) => {
                  const pid = tactics.lineup[i];
                  const nm = pid ? (nameById.get(pid) ?? "") : "";
                  return (
                    <button key={i} type="button" disabled={!canEdit}
                      onClick={() => { if (canEdit) setPickerSlot(i); }}
                      className="absolute flex flex-col items-center gap-0.5"
                      style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%,-50%)" }}>
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center shadow-lg border-2 ${pid ? "bg-white border-white/80" : "bg-black/30 border-dashed border-white/50"}`}>
                        <span className={`text-[10px] font-bold leading-none ${pid ? "text-text-primary" : "text-white/80"}`}>
                          {pid && nm ? initialsOf(nm) : pos.position}
                        </span>
                      </div>
                      <span className="text-[9px] font-semibold text-white drop-shadow-md bg-black/40 rounded px-1 truncate max-w-[48px] text-center">
                        {pid && nm ? nm.split(" ")[0] : pos.position}
                      </span>
                    </button>
                  );
                })}
              </PitchBoard>

              <div className="bg-surface border border-border rounded-btn p-3">
                <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-2">
                  Available players ({candidates.filter((c) => c.status === "confirmed").length} of {candidates.length} confirmed)
                </p>
                {candidates.length === 0 ? (
                  <p className="text-xs text-text-secondary">Nobody available for this tournament yet.</p>
                ) : (
                  <div className="space-y-2">
                    {candidates.map((p) => {
                      const inLineup = Object.values(tactics.lineup).includes(p.player_id);
                      return (
                        <div key={p.player_id} className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                            <span className="text-[10px] font-semibold text-text-secondary">{initialsOf(p.full_name)}</span>
                          </div>
                          <p className="flex-1 text-sm truncate">{p.full_name}</p>
                          {p.is_ringer && (
                            <span className="text-[10px] font-semibold bg-blue-500/10 text-blue-600 border border-blue-500/20 px-2 py-0.5 rounded-full">Ringer</span>
                          )}
                          {p.status !== "confirmed" && (
                            <span className="text-[10px] font-semibold bg-yellow-500/10 text-yellow-600 border border-yellow-500/20 px-2 py-0.5 rounded-full">Pending</span>
                          )}
                          {inLineup
                            ? <span className="text-[10px] font-semibold bg-accent/10 text-accent-ink border border-accent/20 px-2 py-0.5 rounded-full">Starting</span>
                            : <span className="text-[10px] font-semibold text-text-secondary">Bench</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {saveError && <p className="text-xs text-red-600">{saveError}</p>}

              {canEdit ? (
                <button type="button" onClick={handleSave} disabled={saving}
                  className="w-full py-2.5 rounded-btn bg-accent text-white text-sm font-bold disabled:opacity-50">
                  {saving ? "Saving…" : "Save Lineup"}
                </button>
              ) : Object.keys(tactics.lineup).length === 0 ? (
                <p className="text-xs text-text-secondary text-center">The captain hasn&apos;t set the lineup for this game yet.</p>
              ) : null}
            </div>
          )}

          {/* ══ TACTICS ═══════════════════════════════════════════ */}
          {tab === "tactics" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold mb-0.5">Match plan</p>
                  <p className="text-xs text-text-secondary">
                    {canEdit ? "Private to your team — nobody else in the tournament sees it." : "Set by your captain."}
                  </p>
                </div>
                <button type="button"
                  disabled={!canEdit || presets === null || presets.length === 0}
                  onClick={() => setPresetPickerOpen(true)}
                  title={
                    !isCaptain ? "Only the captain can set tactics"
                    : presets === null ? "Saved setups aren't set up yet — run supabase_team_tactics.sql."
                    : presets.length === 0 ? "No saved setups yet — create one in My Team > Tactics."
                    : undefined
                  }
                  className="flex-shrink-0 px-3 py-2 rounded-lg border border-border text-xs font-semibold text-text-secondary disabled:opacity-40 disabled:cursor-not-allowed">
                  Load saved
                </button>
              </div>

              {!tacticsAvailable && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3 py-2.5">
                  <p className="text-xs text-yellow-600">{TACTICS_MISSING_MSG}</p>
                </div>
              )}

              <div className="bg-surface border border-border shadow-card rounded-card p-4 space-y-4">
                <div>
                  <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Formation</p>
                  <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {FORMATION_KEYS.map((f) => (
                      <button key={f} type="button" disabled={!canEdit} onClick={() => setTac({ formation: f })}
                        className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border disabled:opacity-60 ${
                          tactics.formation === f ? "bg-accent text-white border-accent" : "bg-surface text-text-secondary border-border"}`}>
                        {f}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Play style</p>
                  <div className="flex flex-wrap gap-2">
                    {PLAY_STYLES.map((s) => (
                      <button key={s} type="button" disabled={!canEdit}
                        onClick={() => setTac({ style: tactics.style === s ? null : s })}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border disabled:opacity-60 ${
                          tactics.style === s ? "bg-accent text-white border-accent" : "bg-surface text-text-secondary border-border"}`}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Instructions</p>
                  {canEdit ? (
                    <textarea value={tactics.notes} onChange={(e) => setTac({ notes: e.target.value })} rows={5}
                      placeholder="What the squad needs to do in this game."
                      className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent resize-none placeholder:text-text-secondary" />
                  ) : tactics.notes ? (
                    <p className="text-sm text-text-secondary whitespace-pre-wrap">{tactics.notes}</p>
                  ) : (
                    <p className="text-xs text-text-secondary">No instructions set yet.</p>
                  )}
                </div>
              </div>

              {saveError && <p className="text-xs text-red-600">{saveError}</p>}

              {canEdit && (
                <button type="button" onClick={handleSave} disabled={saving}
                  className="w-full py-3 rounded-btn bg-accent text-white text-sm font-bold disabled:opacity-50">
                  {saving ? "Saving…" : "Save Tactics"}
                </button>
              )}

              {presetPickerOpen && presets && (
                <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-scrim" onClick={() => setPresetPickerOpen(false)}>
                  <div className="w-full max-w-lg bg-surface rounded-t-2xl md:rounded-2xl max-h-[70dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-center pt-3 pb-1 md:hidden"><div className="w-10 h-1 rounded-full bg-border" /></div>
                    <div className="p-4 space-y-2">
                      <p className="font-bold text-base mb-2">Load a saved setup</p>
                      {presets.map((p) => (
                        <button key={p.id} type="button"
                          onClick={() => {
                            // A copy, not a live link — editing this game's plan
                            // must never rewrite the team's template.
                            setTac({ formation: p.formation, style: p.style, notes: p.notes ?? "" });
                            setPresetPickerOpen(false);
                          }}
                          className="w-full text-left bg-surface border border-border rounded-btn p-3">
                          <p className="text-sm font-semibold">{p.title}</p>
                          <p className="text-[11px] text-text-secondary mt-0.5">
                            {[p.situation, p.formation, p.style].filter(Boolean).join(" · ")}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Lineup player picker (captain) */}
      {pickerSlot !== null && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-scrim" onClick={() => setPickerSlot(null)}>
          <div className="w-full max-w-md bg-surface border-t border-border rounded-t-2xl p-5 max-h-[70dvh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
              <p className="font-bold text-base">Assign {slots[pickerSlot]?.position}</p>
              <button type="button" onClick={() => setPickerSlot(null)} aria-label="Close">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="space-y-2 overflow-y-auto">
              {tactics.lineup[pickerSlot] && (
                <button type="button"
                  onClick={() => {
                    setTactics((prev) => {
                      const lineup = { ...prev.lineup };
                      delete lineup[pickerSlot];
                      return { ...prev, lineup };
                    });
                    setPickerSlot(null);
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-xl border border-red-500/30 text-red-600 text-sm font-semibold">
                  Clear this position
                </button>
              )}
              {candidates.length === 0 && <p className="text-sm text-text-secondary py-2">No available players to assign.</p>}
              {candidates.map((p) => {
                const assignedEntry = Object.entries(tactics.lineup).find(([, pid]) => pid === p.player_id);
                const here = assignedEntry !== undefined && Number(assignedEntry[0]) === pickerSlot;
                return (
                  <button key={p.player_id} type="button"
                    onClick={() => {
                      setTactics((prev) => {
                        const lineup = { ...prev.lineup };
                        // One slot per player — drop any prior slot they held.
                        for (const k of Object.keys(lineup)) if (lineup[Number(k)] === p.player_id) delete lineup[Number(k)];
                        lineup[pickerSlot] = p.player_id;
                        return { ...prev, lineup };
                      });
                      setPickerSlot(null);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left ${here ? "bg-accent/10 border-accent" : "bg-surface-2 border-border"}`}>
                    <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] font-semibold text-text-secondary">{initialsOf(p.full_name)}</span>
                    </div>
                    <p className="flex-1 text-sm truncate">{p.full_name}</p>
                    {assignedEntry !== undefined && (
                      <span className="text-[10px] text-text-secondary">{here ? "Here" : slots[Number(assignedEntry[0])]?.position}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
