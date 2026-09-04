"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  FORMATIONS, DEFAULT_FORMATION, slotsFor, PLAY_STYLES,
  teamSizeFromFormat, formationKeysFor, resolveFormation, formatLabelForSize,
} from "@/lib/formations";
import { loadTeamTactics, type TeamTactic } from "@/components/my-team/TacticsTab";
import AvailabilityButtons from "@/components/AvailabilityButtons";
import { loadLeadership } from "@/lib/team-leadership";

// `format` rides along on the pitch option the opponent picked ("7-a-side"),
// so a confirmed friendly knows how many a side it is without needing a column
// of its own. Older posts predate it — the posting team's format is the fallback.
type PitchInfo = { id?: string; name: string; address?: string; price: number; format?: string };

type Match = {
  id: string;
  postId: string;
  postingTeamId: string;
  challengingTeamId: string;
  postingTeamName: string;
  challengingTeamName: string;
  confirmedPitch: PitchInfo;
  // How many a side, as a format string. Pitch first, posting team second.
  format: string | null;
  match_date: string;
  match_time: string;
  status: string;
  created_at: string;
};

type Confirmation = {
  player_id: string;
  team_id: string;
  status: string;
  full_name: string;
  // A paid guest player. In the squad and the lineup, but never in the charge —
  // they've already paid Unitr their flat ringer fee (supabase_ringers.sql).
  is_ringer: boolean;
};

type OriginalPost = { match_date: string; match_time: string };

// Attendance used to run through an effectiveStatus() helper that reported
// everyone as "confirmed" unless the kickoff had moved. A squad member gets a
// pending match_confirmations row the moment a challenge is accepted
// (ChallengePanel), so that read the whole squad back as attending even when
// one player had actually said yes — the captain saw eleven names in green and
// eleven shirts that never turned up. Nothing is assumed now: a row says
// confirmed, declined, or pending, and pending means pending.

// Info · Attendance · Lineup · Tactics — mirroring how a matchday screen is
// normally read: what is this game, who's coming, who's playing, how we play.
type Tab = "info" | "attendance" | "lineup" | "tactics";
const TABS: { key: Tab; label: string }[] = [
  { key: "info", label: "Info" },
  { key: "attendance", label: "Attendance" },
  { key: "lineup", label: "Lineup" },
  { key: "tactics", label: "Tactics" },
];

type ResultPlayer = { player_id: string; name: string; started: boolean; subbed_on: boolean; goals: number };

// Formations now live in lib/formations.ts. They used to be duplicated here and
// in the team tactics page, and the two copies had drifted — dangerous, because
// a saved lineup is keyed by INDEX into this array.
const formations = FORMATIONS;

function ConfirmBadge({ status }: { status: string }) {
  if (status === "confirmed") return <span className="text-[10px] font-semibold bg-accent/10 text-accent-ink border border-accent/20 px-2 py-0.5 rounded-full">In</span>;
  if (status === "declined") return <span className="text-[10px] font-semibold bg-red-500/10 text-red-600 border border-red-500/20 px-2 py-0.5 rounded-full">Out</span>;
  return <span className="text-[10px] font-semibold bg-yellow-500/10 text-yellow-600 border border-yellow-500/20 px-2 py-0.5 rounded-full">Pending</span>;
}

// One team's replies, headed by whose they are. The two squads used to be one
// undifferentiated list of names, which reads fine right up until both teams
// have a Jack and you're counting shirts.
function AttendanceGroup({ title, subtitle, rows, highlight = false }: {
  title: string;
  subtitle: string;
  rows: Confirmation[];
  highlight?: boolean;
}) {
  return (
    <div className={`border rounded-2xl p-4 ${highlight ? "bg-surface-2 border-accent/30" : "bg-surface-2 border-border"}`}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-bold truncate">{title}</p>
        <span className="text-[10px] text-text-secondary flex-shrink-0 ml-2">{subtitle}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-text-secondary">No replies yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((c) => (
            <div key={c.player_id} className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                <span className="text-[10px] font-semibold text-text-secondary">
                  {c.full_name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                </span>
              </div>
              <p className="flex-1 text-sm truncate">{c.full_name}</p>
              {c.is_ringer && (
                <span className="text-[10px] font-semibold bg-blue-500/10 text-blue-600 border border-blue-500/20 px-2 py-0.5 rounded-full">Ringer</span>
              )}
              <ConfirmBadge status={c.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Ringer request (captain) ──────────────────────────────────
// Short of bodies for this match? Post the positions you need and the spots
// show up in every player's Fill In feed. Guests pay Unitr a flat fee to join
// — nothing about the team's own pitch split changes.
const RINGER_POSITIONS = ["GK", "CB", "LB", "RB", "CDM", "CM", "CAM", "LW", "RW", "ST"];
const RINGER_FEE_PENCE = 500;

type RingerRequestRow = { id: string; positions: string[]; spots: number; notes: string | null; status: string };
type RingerSignup = { player_id: string; name: string; position: string | null };

function RingerRequestPanel({ matchId, teamId, userId }: { matchId: string; teamId: string; userId: string }) {
  const [request, setRequest] = useState<RingerRequestRow | null | undefined>(undefined);
  const [signups, setSignups] = useState<RingerSignup[]>([]);
  const [positions, setPositions] = useState<string[]>([]);
  const [spots, setSpots] = useState(1);
  const [notes, setNotes] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data, error: reqErr } = await supabase.from("ringer_requests")
        .select("id, positions, spots, notes, status")
        .eq("match_id", matchId).eq("team_id", teamId).maybeSingle();
      if (reqErr) {
        // Table missing — the migration hasn't been run on this database.
        setError("Ringer requests aren't set up yet — run supabase_ringers.sql.");
        setRequest(null);
        return;
      }
      setRequest(data ?? null);
      if (data) {
        setPositions(data.positions ?? []);
        setSpots(data.spots ?? 1);
        setNotes(data.notes ?? "");
        const { data: su } = await supabase.from("ringer_signups")
          .select("player_id, position").eq("request_id", data.id);
        const ids = (su ?? []).map((s) => s.player_id);
        const { data: profs } = ids.length
          ? await supabase.from("profiles").select("id, full_name").in("id", ids)
          : { data: [] as { id: string; full_name: string }[] };
        const nameById = new Map((profs ?? []).map((p) => [p.id, p.full_name as string]));
        setSignups((su ?? []).map((s) => ({
          player_id: s.player_id,
          name: nameById.get(s.player_id) ?? "Player",
          position: s.position,
        })));
      }
    }
    load();
  }, [matchId, teamId]);

  const togglePosition = (p: string) =>
    setPositions((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    const { data, error: saveErr } = await supabase.from("ringer_requests").upsert({
      match_id: matchId,
      team_id: teamId,
      posted_by: userId,
      positions,
      spots,
      notes: notes.trim() || null,
      price_pence: RINGER_FEE_PENCE,
      status: "open",
    }, { onConflict: "match_id,team_id" }).select("id, positions, spots, notes, status").maybeSingle();
    if (saveErr || !data) setError(saveErr?.message ?? "Couldn't post the request.");
    else { setRequest(data); setExpanded(false); }
    setBusy(false);
  };

  const handleClose = async () => {
    if (!request) return;
    setBusy(true);
    await supabase.from("ringer_requests").update({ status: "cancelled" }).eq("id", request.id);
    setRequest({ ...request, status: "cancelled" });
    setBusy(false);
  };

  const isLive = request?.status === "open";
  const spotsLeft = request ? Math.max(0, request.spots - signups.length) : 0;

  return (
    <div className="mt-4 bg-surface border border-border shadow-card rounded-card p-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-semibold">Need a ringer?</p>
        {isLive && (
          <span className="text-[10px] font-semibold bg-accent/10 text-accent-ink border border-accent/30 px-2 py-0.5 rounded-full">
            {spotsLeft} spot{spotsLeft === 1 ? "" : "s"} left
          </span>
        )}
      </div>
      <p className="text-xs text-text-secondary mb-3">
        Post the positions you&apos;re short and players can buy in for £{(RINGER_FEE_PENCE / 100).toFixed(2)}.
        Ringers join your squad but aren&apos;t part of your team&apos;s payment split.
      </p>

      {signups.length > 0 && (
        <div className="bg-background border border-border rounded-xl p-3 mb-3 space-y-2">
          <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">Joined</p>
          {signups.map((s) => (
            <div key={s.player_id} className="flex items-center gap-2">
              <p className="flex-1 text-sm truncate">{s.name}</p>
              <span className="text-[10px] font-semibold bg-blue-500/10 text-blue-600 border border-blue-500/20 px-2 py-0.5 rounded-full">Paid</span>
            </div>
          ))}
        </div>
      )}

      {request === undefined ? (
        <div className="py-2 text-center"><div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" /></div>
      ) : expanded || !request || request.status !== "open" ? (
        <div className="space-y-3">
          <div>
            <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-2">Positions needed</p>
            <div className="flex flex-wrap gap-1.5">
              {RINGER_POSITIONS.map((p) => (
                <button key={p} type="button" onClick={() => togglePosition(p)}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${positions.includes(p) ? "bg-accent text-white border-accent" : "bg-background text-text-secondary border-border"}`}>
                  {p}
                </button>
              ))}
            </div>
            {positions.length === 0 && <p className="text-[10px] text-text-secondary mt-1.5">None selected — the post will say &quot;any position&quot;.</p>}
          </div>

          <div className="flex items-center gap-3">
            <p className="text-xs text-text-secondary flex-1">Players needed</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setSpots((s) => Math.max(1, s - 1))}
                className="w-8 h-8 rounded-lg border border-border text-text-secondary font-bold">−</button>
              <span className="w-6 text-center text-sm font-bold">{spots}</span>
              <button type="button" onClick={() => setSpots((s) => Math.min(11, s + 1))}
                className="w-8 h-8 rounded-lg border border-border text-text-secondary font-bold">+</button>
            </div>
          </div>

          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            placeholder="Anything they should know? (e.g. bring dark shirt)"
            className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm placeholder:text-text-secondary" />

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-2">
            {request?.status === "open" && (
              <button type="button" onClick={() => setExpanded(false)} disabled={busy}
                className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold text-text-secondary disabled:opacity-50">
                Cancel
              </button>
            )}
            <button type="button" onClick={handleSave} disabled={busy || !!error}
              className="flex-[2] py-2.5 rounded-btn bg-accent text-white text-sm font-bold disabled:opacity-50">
              {busy ? "Posting…" : request ? "Update Request" : "Post Ringer Request"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-text-secondary">
            Live · {request.positions.length === 0 ? "Any position" : request.positions.join(", ")} · {request.spots} needed
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setExpanded(true)}
              className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold text-text-secondary">Edit</button>
            <button type="button" onClick={handleClose} disabled={busy}
              className="flex-1 py-2.5 rounded-xl border border-red-500/30 text-sm font-semibold text-red-600 disabled:opacity-50">
              {busy ? "…" : "Close Request"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Match tasks ───────────────────────────────────────────────
// The jobs around a fixture that aren't football — bring the kit, collect the
// ball, give Danny a lift. Captains were putting these in announcements, where
// they scroll away and nothing can be ticked off.
//
// A task with no assignee is for the whole squad, and completion is per-player:
// "everyone bring £5" needs ten separate ticks, not one.
type TaskRow = { id: string; title: string; detail: string | null; assignee_id: string | null };

const TASKS_MISSING_MSG = "Match tasks aren't set up yet — run supabase_match_tasks.sql.";

function MatchTasks({
  matchId, teamId, userId, isCaptain, squad,
}: {
  matchId: string;
  teamId: string;
  userId: string;
  isCaptain: boolean;
  squad: { player_id: string; full_name: string }[];
}) {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [doneByTask, setDoneByTask] = useState<Record<string, Set<string>>>({});
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("match_tasks")
      .select("id, title, detail, assignee_id")
      .eq("match_id", matchId).eq("team_id", teamId)
      .order("created_at", { ascending: true });

    if (error) { setUnavailable(true); setLoading(false); return; }

    const rows = (data ?? []) as TaskRow[];
    const { data: done } = rows.length
      ? await supabase.from("match_task_done").select("task_id, player_id").in("task_id", rows.map((r) => r.id))
      : { data: [] };

    const map: Record<string, Set<string>> = {};
    for (const d of done ?? []) {
      (map[d.task_id] ??= new Set()).add(d.player_id);
    }
    setTasks(rows);
    setDoneByTask(map);
    setUnavailable(false);
    setLoading(false);
  }, [matchId, teamId]);

  useEffect(() => { load(); }, [load]);

  async function addTask() {
    if (!title.trim()) return;
    setBusy(true);
    await supabase.from("match_tasks").insert({
      match_id: matchId, team_id: teamId, title: title.trim(),
      detail: detail.trim() || null, assignee_id: assignee || null, created_by: userId,
    });
    setTitle(""); setDetail(""); setAssignee(""); setAdding(false); setBusy(false);
    load();
  }

  async function removeTask(id: string) {
    await supabase.from("match_tasks").delete().eq("id", id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  // Un-ticking is a delete, not a flag flip — absence of a row is the only
  // "not done", so there's no third state to get out of sync.
  async function toggleDone(taskId: string) {
    const mine = doneByTask[taskId]?.has(userId);
    setDoneByTask((prev) => {
      const next = { ...prev };
      const set = new Set(next[taskId] ?? []);
      if (mine) set.delete(userId); else set.add(userId);
      next[taskId] = set;
      return next;
    });
    if (mine) {
      await supabase.from("match_task_done").delete().eq("task_id", taskId).eq("player_id", userId);
    } else {
      await supabase.from("match_task_done").upsert(
        { task_id: taskId, player_id: userId }, { onConflict: "task_id,player_id" },
      );
    }
  }

  if (loading) return null;

  const nameOf = (id: string) => squad.find((s) => s.player_id === id)?.full_name ?? "Player";

  return (
    <div className="bg-surface border border-border shadow-card rounded-card p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Tasks</p>
        <button
          type="button"
          disabled={!isCaptain || unavailable}
          onClick={() => setAdding(!adding)}
          title={!isCaptain ? "Only the captain can set tasks" : unavailable ? TASKS_MISSING_MSG : undefined}
          className="text-xs font-bold text-accent-ink disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {adding ? "Cancel" : "+ Add"}
        </button>
      </div>

      {unavailable ? (
        <p className="text-xs text-text-secondary">{TASKS_MISSING_MSG}</p>
      ) : (
        <>
          {adding && (
            <div className="space-y-2 mb-3 pb-3 border-b border-border">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Bring the away kit"
                className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm placeholder:text-text-secondary outline-none focus:border-accent" />
              <input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Any detail (optional)"
                className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm placeholder:text-text-secondary outline-none focus:border-accent" />
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)}
                className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-accent">
                <option value="">Everyone</option>
                {squad.map((s) => <option key={s.player_id} value={s.player_id}>{s.full_name}</option>)}
              </select>
              <button type="button" onClick={addTask} disabled={busy || !title.trim()}
                className="w-full py-2.5 rounded-btn bg-accent text-white text-sm font-bold disabled:opacity-50">
                {busy ? "Adding…" : "Add task"}
              </button>
            </div>
          )}

          {tasks.length === 0 ? (
            <p className="text-xs text-text-secondary">
              {isCaptain ? "Nothing to sort yet. Add what the squad needs to bring or do." : "Your captain hasn't set any tasks."}
            </p>
          ) : (
            <div className="space-y-2">
              {tasks.map((t) => {
                const mineDone = doneByTask[t.id]?.has(userId) ?? false;
                const doneCount = doneByTask[t.id]?.size ?? 0;
                // A task aimed at someone else is information, not a to-do.
                const isMine = !t.assignee_id || t.assignee_id === userId;
                return (
                  <div key={t.id} className="flex items-start gap-3">
                    <button type="button" disabled={!isMine} onClick={() => toggleDone(t.id)}
                      className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        mineDone ? "bg-accent border-accent" : "border-border"} ${isMine ? "" : "opacity-30"}`}>
                      {mineDone && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm ${mineDone ? "line-through text-text-secondary" : ""}`}>{t.title}</p>
                      {t.detail && <p className="text-[11px] text-text-secondary">{t.detail}</p>}
                      <p className="text-[10px] text-text-secondary mt-0.5">
                        {t.assignee_id ? nameOf(t.assignee_id) : `Everyone · ${doneCount} done`}
                      </p>
                    </div>
                    {isCaptain && (
                      <button type="button" onClick={() => removeTask(t.id)} className="text-[11px] text-text-secondary flex-shrink-0">
                        Remove
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function ManageMatchPage({ params }: { params: { matchId: string } }) {
  const { user } = useAuth();
  const [match, setMatch] = useState<Match | null | undefined>(undefined);
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [confirmations, setConfirmations] = useState<Confirmation[]>([]);
  const [tab, setTab] = useState<Tab>("info");
  const [originalPost, setOriginalPost] = useState<OriginalPost | null | undefined>(undefined);
  const [formation, setFormation] = useState(DEFAULT_FORMATION);
  const [style, setStyle] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [lineup, setLineup] = useState<Record<number, string>>({});
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [savingTactics, setSavingTactics] = useState(false);
  const [isCaptain, setIsCaptain] = useState(false);
  const [resultVerified, setResultVerified] = useState(false);
  const [myResult, setMyResult] = useState<{ teamScore: number; opponentScore: number } | null>(null);
  const [oppResult, setOppResult] = useState<{ teamScore: number; opponentScore: number } | null>(null);
  const [myResultPlayers, setMyResultPlayers] = useState<ResultPlayer[]>([]);
  const [oppResultPlayers, setOppResultPlayers] = useState<ResultPlayer[]>([]);
  // Saved team presets, for the "load from saved" picker on the Tactics tab.
  // null means supabase_team_tactics.sql hasn't been applied.
  const [presets, setPresets] = useState<TeamTactic[] | null>([]);
  const [presetPickerOpen, setPresetPickerOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    const currentUser = user;
    async function load() {
      const { data: m } = await supabase.from("matches").select("*").eq("id", params.matchId).maybeSingle();
      if (!m) { setMatch(null); return; }

      const [{ data: pt }, { data: ct }] = await Promise.all([
        supabase.from("teams").select("name, format").eq("id", m.posting_team_id).maybeSingle(),
        supabase.from("teams").select("name").eq("id", m.challenging_team_id).maybeSingle(),
      ]);

      setMatch({
        id: m.id,
        postId: m.post_id,
        postingTeamId: m.posting_team_id,
        challengingTeamId: m.challenging_team_id,
        postingTeamName: pt?.name ?? "Unknown",
        challengingTeamName: ct?.name ?? "Unknown",
        confirmedPitch: m.confirmed_pitch as PitchInfo,
        format: (m.confirmed_pitch as PitchInfo | null)?.format || pt?.format || null,
        match_date: m.match_date,
        match_time: m.match_time,
        status: m.status,
        created_at: m.created_at,
      });

      // "Captain" on this page means whoever runs the team — a co-captain
      // manages a match exactly as the captain does.
      const led = await loadLeadership(currentUser.id);
      setMyTeamId(led?.teamId ?? null);
      setIsCaptain(Boolean(led?.canManage));

      // is_ringer arrives with supabase_ringers.sql. Before that migration the
      // column doesn't exist and selecting it fails the whole query, taking the
      // squad list with it — so fall back to the pre-ringer shape.
      type ConfRow = { player_id: string; team_id: string; status: string; is_ringer?: boolean; profiles: { full_name: string } | null };
      const withRinger = await supabase
        .from("match_confirmations")
        .select("player_id, team_id, status, is_ringer, profiles(full_name)")
        .eq("match_id", m.id);
      const confs = (withRinger.data ?? (await supabase
        .from("match_confirmations")
        .select("player_id, team_id, status, profiles(full_name)")
        .eq("match_id", m.id)).data) as ConfRow[] | null;

      const mapped = (confs ?? []).map((c) => ({
        player_id: c.player_id,
        team_id: c.team_id,
        status: c.status,
        full_name: (c.profiles as unknown as { full_name: string } | null)?.full_name ?? "Unknown",
        is_ringer: Boolean((c as { is_ringer?: boolean }).is_ringer),
      }));
      setConfirmations(mapped);
    }
    load();
  }, [user, params.matchId]);

  // Was the confirmed slot a different time/date than the team originally posted/polled for?
  // (e.g. an alt-time backup pitch got picked) — if so, players need to give a final confirmation.
  useEffect(() => {
    if (!match?.postId) return;
    supabase.from("match_posts").select("match_date, match_time").eq("id", match.postId).maybeSingle()
      .then(({ data }) => setOriginalPost(data ?? null));
  }, [match?.postId]);

  // Load this team's private match tactics/lineup (separate from the opposing captain's)
  useEffect(() => {
    if (!myTeamId || !match) return;
    supabase.from("match_tactics").select("*").eq("match_id", match.id).eq("team_id", myTeamId).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setFormation(data.formation ?? DEFAULT_FORMATION);
          setStyle(data.style ?? null);
          setNotes(data.notes ?? "");
          setLineup((data.lineup ?? {}) as Record<number, string>);
        }
      });
  }, [myTeamId, match]);

  // The team's saved presets, so a captain can pull one in rather than
  // rebuilding the same shape for the fourth time this season.
  useEffect(() => {
    if (!myTeamId) return;
    loadTeamTactics(myTeamId).then(setPresets);
  }, [myTeamId]);

  // Load submitted results + players for both teams whenever the match and team are known.
  useEffect(() => {
    if (!match || !myTeamId) return;
    const currentMatch = match;
    const tid = myTeamId;
    async function loadResults() {
      const [{ data: results }, { data: players }] = await Promise.all([
        supabase.from("match_results").select("team_id, team_score, opponent_score").eq("match_id", params.matchId),
        supabase.from("match_result_players").select("team_id, player_id, started, subbed_on, goals").eq("match_id", params.matchId),
      ]);

      // Fetch names for all players in the result.
      const playerIds = [...new Set((players ?? []).map((p) => p.player_id))];
      const { data: profiles } = playerIds.length > 0
        ? await supabase.from("profiles").select("id, full_name").in("id", playerIds)
        : { data: [] };
      const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name as string]));

      // Check if result is verified via DB (both teams submitted matching scores).
      const { data: matchMeta } = await supabase.from("matches").select("result_verified").eq("id", params.matchId).maybeSingle();
      setResultVerified(!!matchMeta?.result_verified);

      const oppId = tid === currentMatch.postingTeamId ? currentMatch.challengingTeamId : currentMatch.postingTeamId;

      const myRes = (results ?? []).find((r) => r.team_id === tid);
      const oppRes = (results ?? []).find((r) => r.team_id === oppId);
      setMyResult(myRes ? { teamScore: myRes.team_score, opponentScore: myRes.opponent_score } : null);
      setOppResult(oppRes ? { teamScore: oppRes.team_score, opponentScore: oppRes.opponent_score } : null);

      const toPlayer = (p: { player_id: string; started: boolean; subbed_on: boolean; goals: number }): ResultPlayer => ({
        player_id: p.player_id,
        name: nameById.get(p.player_id) ?? "Player",
        started: p.started,
        subbed_on: p.subbed_on,
        goals: p.goals,
      });
      setMyResultPlayers((players ?? []).filter((p) => p.team_id === tid).map(toPlayer));
      setOppResultPlayers((players ?? []).filter((p) => p.team_id === oppId).map(toPlayer));
    }
    loadResults();
  }, [match, myTeamId, params.matchId]);


  const handleSaveMatchTactics = async () => {
    if (!myTeamId || !match) return;
    setSavingTactics(true);
    await supabase.from("match_tactics").upsert({
      match_id: match.id,
      team_id: myTeamId,
      // The resolved key, not the raw state: a preset or an older row can carry
      // a formation from a different size, and writing that back would leave a
      // lineup nobody can see.
      formation: resolveFormation(formation, teamSizeFromFormat(match.format)),
      style,
      notes,
      lineup,
    }, { onConflict: "match_id,team_id" });
    setSavingTactics(false);
  };

  // Copies a saved preset's values in. Deliberately a copy, not a live link:
  // once loaded, editing this match's plan must not rewrite the team's template.
  const applyPreset = (p: TeamTactic) => {
    setFormation(p.formation);
    setStyle(p.style);
    setNotes(p.notes ?? "");
    setPresetPickerOpen(false);
  };

  if (match === undefined) {
    return <div className="flex items-center justify-center min-h-screen"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;
  }
  if (match === null) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-4 gap-4 text-center">
        <p className="text-text-secondary">Match not found.</p>
        <a href="/my-team" className="text-sm text-accent-ink font-medium">Back to My Team</a>
      </div>
    );
  }

  const timeChanged = originalPost
    ? (originalPost.match_time !== match.match_time || originalPost.match_date !== match.match_date)
    : false;
  const myTeamName = myTeamId === match.postingTeamId ? match.postingTeamName : match.challengingTeamName;
  const opponentTeamId = myTeamId === match.postingTeamId ? match.challengingTeamId : match.postingTeamId;
  const opponentName = myTeamId === match.postingTeamId ? match.challengingTeamName : match.postingTeamName;
  // Everything on the lineup board is keyed off how many a side this game is:
  // which formations are offered, how many dots the pitch gets, and which
  // formation is shown when the stored one belongs to another size (a team that
  // saved 4-3-3 and then got matched onto a 5-a-side pitch).
  const teamSize = teamSizeFromFormat(match.format);
  const formationKeys = formationKeysFor(teamSize);
  const activeFormation = resolveFormation(formation, teamSize);
  const players = slotsFor(activeFormation, teamSize);

  // Who's pickable for the lineup: anyone who hasn't ruled themselves out.
  // Not the confirmed-only set — a captain builds a shape before the last
  // replies land, and a pending player is still a candidate. Each row carries
  // its own badge below so the difference stays visible.
  const myParticipants = confirmations.filter(
    (c) => c.team_id === myTeamId && c.status !== "declined"
  );

  // ── Attendance tab figures ───────────────────────────────────
  // Split by team. The trio of counters stays about who WE can field — the
  // opposing squad is the other captain's problem — but their replies are
  // listed underneath, because "have they got a team?" is a fair question the
  // day before a friendly.
  const myTeamConfs = confirmations.filter((c) => c.team_id === myTeamId);
  const oppTeamConfs = confirmations.filter((c) => c.team_id === opponentTeamId);
  const attIn = myTeamConfs.filter((c) => c.status === "confirmed");
  const attOut = myTeamConfs.filter((c) => c.status === "declined");
  const attPending = myTeamConfs.filter((c) => c.status !== "confirmed" && c.status !== "declined");
  const oppIn = oppTeamConfs.filter((c) => c.status === "confirmed").length;

  // ── Result-view derived data ──────────────────────────────────
  const pitchPositions = slotsFor(activeFormation, teamSize);
  const myStarters = myResultPlayers.filter((p) => p.started);
  const myBench    = myResultPlayers.filter((p) => p.subbed_on);
  const myScorers  = myResultPlayers.filter((p) => p.goals > 0);
  const oppScorers = oppResultPlayers.filter((p) => p.goals > 0);
  const hasResult  = !!myResult || !!oppResult;
  const myS = myResult?.teamScore ?? 0;
  const oppS = myResult?.opponentScore ?? 0;
  const myInitials  = myTeamName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const oppInitials = opponentName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const fmtMatchDate = /^\d{4}-\d{2}-\d{2}$/.test(match.match_date)
    ? new Date(match.match_date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric" })
    : match.match_date;
  const playerNameMap = new Map<string, string>([
    ...confirmations.map((c): [string, string] => [c.player_id, c.full_name]),
    ...myResultPlayers.map((p): [string, string] => [p.player_id, p.name]),
  ]);
  // Returns initials + first name for the player assigned to pitch slot i
  // (from match_tactics lineup), falling back to result-order if no lineup.
  const slotPlayer = (i: number): { initials: string; firstName: string } | null => {
    const pid = lineup[i] ?? myStarters[i]?.player_id;
    if (!pid) return null;
    const n = playerNameMap.get(pid) ?? myResultPlayers.find((p) => p.player_id === pid)?.name ?? "";
    if (!n) return null;
    return { initials: n.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase(), firstName: n.split(" ")[0] };
  };

  return (
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <a href="/my-team">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </a>
        <div className="flex-1">
          <h1 className="text-[17px] font-extrabold">{myTeamName} vs {opponentName}</h1>
        </div>
      </div>

      {/* Availability sits above the tabs, not inside one. It's the single
          question every player opens this page to answer, and it stays
          answerable right up to kickoff — plans change. Hidden once the game
          has been played and a result exists. */}
      {!hasResult && myTeamId && user && (
        <div className="mb-4">
          {/* Your own tap has to move your own row in the attendance list, or
              the tab a scroll away still calls you Pending. */}
          <AvailabilityButtons
            matchId={params.matchId} playerId={user.id} teamId={myTeamId}
            onChanged={(status) => setConfirmations((prev) =>
              prev.some((c) => c.player_id === user.id)
                ? prev.map((c) => (c.player_id === user.id ? { ...c, status } : c))
                : [...prev, { player_id: user.id, team_id: myTeamId, status, full_name: "You", is_ringer: false }]
            )}
          />
        </div>
      )}

      {/* ── Tabs ── */}
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
      {/* ── Score block ── */}
      <div className="bg-surface border border-border shadow-card rounded-card pt-5 pb-4 px-4 space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex flex-col items-center gap-2 flex-1">
            <div className="w-12 h-12 rounded-full bg-[#E7F8EC] border border-[#B7E8C6] flex items-center justify-center">
              <span className="text-sm font-extrabold text-accent-ink">{myInitials}</span>
            </div>
            <p className="text-xs font-bold text-center leading-tight">{myTeamName}</p>
          </div>
          <div className="flex flex-col items-center px-3">
            {hasResult ? (
              <>
                <p className="text-5xl font-extrabold tracking-tighter leading-none mb-1">{myS} – {oppS}</p>
                <p className="text-[11px] text-text-secondary">{resultVerified ? "Full time" : "Pending"}</p>
              </>
            ) : (
              <p className="text-[13px] text-text-secondary font-medium">No result yet</p>
            )}
          </div>
          <div className="flex flex-col items-center gap-2 flex-1">
            <div className="w-12 h-12 rounded-full bg-surface-2 border border-border flex items-center justify-center">
              <span className="text-sm font-extrabold text-text-secondary">{oppInitials}</span>
            </div>
            <p className="text-xs font-bold text-center leading-tight">{opponentName}</p>
          </div>
        </div>

        <div className="border-t border-border pt-3 flex flex-col items-center gap-0.5">
          <p className="text-xs font-medium text-text-secondary">{fmtMatchDate} · {match.match_time}</p>
          <p className="text-xs font-medium text-text-secondary">{match.confirmedPitch.name}</p>
        </div>

        {(myScorers.length > 0 || oppScorers.length > 0) && (
          <div className="border-t border-border pt-3 flex gap-2 text-[11px]">
            <div className="flex-1 space-y-0.5">
              {myScorers.map((p) => (
                <p key={p.player_id} className="text-text-secondary">⚽ {p.name}{p.goals > 1 ? ` ×${p.goals}` : ""}</p>
              ))}
            </div>
            <div className="flex-1 space-y-0.5 text-right">
              {oppScorers.map((p) => (
                <p key={p.player_id} className="text-text-secondary">{p.name}{p.goals > 1 ? ` ×${p.goals}` : ""} ⚽</p>
              ))}
            </div>
          </div>
        )}

        {!myResult && isCaptain && (
          <a href={`/my-team/match/${params.matchId}/result`}
            className="block w-full py-3.5 rounded-btn bg-danger text-white text-sm font-bold text-center">
            Submit Result
          </a>
        )}
        {myResult && !resultVerified && !oppResult && (
          <p className="text-[11px] text-yellow-600 text-center">Waiting for {opponentName} to submit their result</p>
        )}
      </div>

      {myTeamId && user && (
        <MatchTasks
          matchId={params.matchId} teamId={myTeamId} userId={user.id} isCaptain={isCaptain}
          squad={myTeamConfs.map((c) => ({ player_id: c.player_id, full_name: c.full_name }))}
        />
      )}
      </div>
      )}

      {/* ══ ATTENDANCE ════════════════════════════════════════ */}
      {tab === "attendance" && (
        <div className="space-y-4">
          <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">
            {myTeamName} · your squad
          </p>
          <div className="grid grid-cols-3 gap-2">
            {([["Attendees", attIn.length], ["Awaiting reply", attPending.length], ["Unavailable", attOut.length]] as const).map(([label, n]) => (
              <div key={label} className="bg-surface border border-border rounded-btn p-3 text-center">
                <p className="text-2xl font-extrabold">{n}</p>
                <p className="text-[10px] text-text-secondary mt-0.5 leading-tight">{label}</p>
              </div>
            ))}
          </div>

          {timeChanged && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3 py-2.5">
              <p className="text-xs text-yellow-600">
                Kickoff moved since this match was posted — replies below may predate the change.
                Worth asking your squad to confirm again.
              </p>
            </div>
          )}

          {myTeamConfs.length === 0 && oppTeamConfs.length === 0 ? (
            <div className="bg-surface border border-border shadow-card rounded-card p-6 text-center">
              <p className="text-sm font-semibold mb-1">No squad yet</p>
              <p className="text-xs text-text-secondary">Attendance appears once the match is confirmed and your squad is attached.</p>
            </div>
          ) : (
            <>
              <AttendanceGroup
                title={myTeamName} subtitle="Your squad" rows={myTeamConfs} highlight
              />
              <AttendanceGroup
                title={opponentName} subtitle={`${oppIn} confirmed`} rows={oppTeamConfs}
              />
            </>
          )}
        </div>
      )}

      {/* ══ LINEUP ════════════════════════════════════════════ */}
      {tab === "lineup" && (
      <div className="space-y-4">
      {/* ── Pre-match starting lineup board ──────────────────────
          Captain assigns confirmed players to positions; everyone else
          sees the captain's picks read-only. Hidden once a result exists
          (the result view below takes over). */}
      {!hasResult && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">{myTeamName} · Starting Lineup · {formatLabelForSize(teamSize)}</p>
            <span className="text-[10px] text-text-secondary">{isCaptain ? "Tap a position to assign" : "Set by captain"}</span>
          </div>

          {isCaptain && (
            <div className="flex gap-2 overflow-x-auto pb-2 mb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {formationKeys.map((f) => (
                <button key={f} type="button" onClick={() => setFormation(f)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border ${activeFormation === f ? "bg-accent text-white border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>
                  {f}
                </button>
              ))}
            </div>
          )}

          <div className="relative w-full rounded-2xl overflow-hidden" style={{ paddingBottom: "130%", background: "linear-gradient(180deg,#1a5c1a 0%,#1e6b1e 25%,#1a5c1a 50%,#1e6b1e 75%,#1a5c1a 100%)" }}>
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 130" preserveAspectRatio="none">
              <rect x="5" y="5" width="90" height="120" rx="1" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
              <line x1="5" y1="65" x2="95" y2="65" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
              <circle cx="50" cy="65" r="10" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
              <rect x="22" y="5" width="56" height="18" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
              <rect x="22" y="107" width="56" height="18" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
            </svg>
            {players.map((pos, i) => {
              const pid = lineup[i];
              const nm = pid ? (playerNameMap.get(pid) ?? "") : "";
              const initials = nm ? nm.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() : "";
              const firstName = nm ? nm.split(" ")[0] : "";
              return (
                <button key={i} type="button" disabled={!isCaptain}
                  onClick={() => { if (isCaptain) setPickerSlot(i); }}
                  className="absolute flex flex-col items-center gap-0.5"
                  style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%,-50%)" }}>
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center shadow-lg border-2 ${pid ? "bg-white border-white/80" : "bg-black/30 border-dashed border-white/50"}`}>
                    <span className={`text-[10px] font-bold leading-none ${pid ? "text-text-primary" : "text-white/80"}`}>{pid ? initials : pos.position}</span>
                  </div>
                  <span className="text-[9px] font-semibold text-white drop-shadow-md bg-black/40 rounded px-1 truncate max-w-[48px] text-center">{pid ? firstName : pos.position}</span>
                </button>
              );
            })}
          </div>

          {/* Players in the matchday squad + who's starting */}
          <div className="mt-3 bg-surface border border-border rounded-btn p-3">
            <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-2">
              Available players ({myParticipants.filter((p) => p.status === "confirmed").length} of {myParticipants.length} confirmed)
            </p>
            {myParticipants.length === 0 ? (
              <p className="text-xs text-text-secondary">Nobody available for this match yet.</p>
            ) : (
              <div className="space-y-2">
                {myParticipants.map((p) => {
                  const inLineup = Object.values(lineup).includes(p.player_id);
                  const init = p.full_name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                  return (
                    <div key={p.player_id} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-semibold text-text-secondary">{init}</span>
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

          {isCaptain ? (
            <button type="button" onClick={handleSaveMatchTactics} disabled={savingTactics}
              className="w-full mt-3 py-2.5 rounded-btn bg-accent text-white text-sm font-bold disabled:opacity-50">
              {savingTactics ? "Saving…" : "Save Lineup"}
            </button>
          ) : Object.keys(lineup).length === 0 ? (
            <p className="text-xs text-text-secondary text-center mt-3">The captain hasn&apos;t set the lineup yet.</p>
          ) : null}

          {isCaptain && myTeamId && user && (
            <RingerRequestPanel matchId={params.matchId} teamId={myTeamId} userId={user.id} />
          )}
        </div>
      )}

      {myStarters.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">{myTeamName} · Starting XI</p>
          <div className="relative w-full rounded-2xl overflow-hidden" style={{ paddingBottom: "130%", background: "linear-gradient(180deg,#1a5c1a 0%,#1e6b1e 25%,#1a5c1a 50%,#1e6b1e 75%,#1a5c1a 100%)" }}>
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 130" preserveAspectRatio="none">
              <rect x="5" y="5" width="90" height="120" rx="1" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
              <line x1="5" y1="65" x2="95" y2="65" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
              <circle cx="50" cy="65" r="10" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
              <rect x="22" y="5" width="56" height="18" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
              <rect x="22" y="107" width="56" height="18" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
            </svg>
            {pitchPositions.map((pos, i) => {
              const sp = slotPlayer(i);
              if (!sp) return null;
              return (
                <div key={i} className="absolute flex flex-col items-center gap-0.5"
                  style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%,-50%)" }}>
                  <div className="w-9 h-9 rounded-full bg-white border-2 border-white/80 flex items-center justify-center shadow-lg">
                    <span className="text-[10px] font-bold text-text-primary leading-none">{sp.initials}</span>
                  </div>
                  <span className="text-[9px] font-semibold text-white drop-shadow-md bg-black/40 rounded px-1 truncate max-w-[48px] text-center">{sp.firstName}</span>
                </div>
              );
            })}
          </div>

          {myBench.length > 0 && (
            <div className="mt-3 bg-surface border border-border rounded-btn p-3">
              <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-2">Bench</p>
              <div className="space-y-2">
                {myBench.map((p) => {
                  const init = p.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
                  return (
                    <div key={p.player_id} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-semibold text-text-secondary">{init}</span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-1">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="#22c55e"><path d="M12 2l10 20H2z"/></svg>
                        <p className="text-sm">{p.name}</p>
                      </div>
                      {p.goals > 0 && <span className="text-[11px] text-text-secondary">⚽ {p.goals}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {oppResultPlayers.length > 0 && (
        <div className="bg-surface border border-border shadow-card rounded-card p-4">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">{opponentName}</p>
          {oppResultPlayers.filter((p) => p.started).map((p) => {
            const init = p.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
            return (
              <div key={p.player_id} className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-semibold text-text-secondary">{init}</span>
                </div>
                <p className="flex-1 text-sm">{p.name}</p>
                {p.goals > 0 && <span className="text-[11px] text-text-secondary">⚽ {p.goals}</span>}
              </div>
            );
          })}
          {oppResultPlayers.filter((p) => p.subbed_on).length > 0 && (
            <>
              <div className="border-t border-border pt-2 mt-1 mb-2">
                <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">Bench</p>
              </div>
              {oppResultPlayers.filter((p) => p.subbed_on).map((p) => {
                const init = p.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
                return (
                  <div key={p.player_id} className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] font-semibold text-text-secondary">{init}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-1">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="#22c55e"><path d="M12 2l10 20H2z"/></svg>
                      <p className="text-sm">{p.name}</p>
                    </div>
                    {p.goals > 0 && <span className="text-[11px] text-text-secondary">⚽ {p.goals}</span>}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
      </div>
      )}

      {/* ══ TACTICS ═══════════════════════════════════════════ */}
      {tab === "tactics" && (
        <div className="space-y-4">
          {/* Load from saved — the reason team_tactics exists. A captain who
              has already worked out how they press shouldn't rebuild it every
              Saturday. Copies values in; editing here never writes back. */}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold mb-0.5">Match plan</p>
              <p className="text-xs text-text-secondary">
                {isCaptain ? "Private to your team — the opposition never sees it." : "Set by your captain."}
              </p>
            </div>
            <button
              type="button"
              disabled={!isCaptain || presets === null || presets.length === 0}
              onClick={() => setPresetPickerOpen(true)}
              title={
                !isCaptain ? "Only the captain can set tactics"
                : presets === null ? "Saved setups aren't set up yet — run supabase_team_tactics.sql."
                : presets.length === 0 ? "No saved setups yet — create one in My Team > Tactics."
                : undefined
              }
              className="flex-shrink-0 px-3 py-2 rounded-lg border border-border text-xs font-semibold text-text-secondary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Load saved
            </button>
          </div>

          <div className="bg-surface border border-border shadow-card rounded-card p-4 space-y-4">
            <div>
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Formation</p>
              <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {formationKeys.map((f) => (
                  <button key={f} type="button" disabled={!isCaptain} onClick={() => setFormation(f)}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border disabled:opacity-60 ${
                      activeFormation === f ? "bg-accent text-white border-accent" : "bg-surface text-text-secondary border-border"}`}>
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Play style</p>
              <div className="flex flex-wrap gap-2">
                {PLAY_STYLES.map((s) => (
                  <button key={s} type="button" disabled={!isCaptain} onClick={() => setStyle(style === s ? null : s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border disabled:opacity-60 ${
                      style === s ? "bg-accent text-white border-accent" : "bg-surface text-text-secondary border-border"}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Instructions</p>
              {isCaptain ? (
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5}
                  placeholder="What the squad needs to do in this game."
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent resize-none placeholder:text-text-secondary" />
              ) : notes ? (
                <p className="text-sm text-text-secondary whitespace-pre-wrap">{notes}</p>
              ) : (
                <p className="text-xs text-text-secondary">No instructions set yet.</p>
              )}
            </div>
          </div>

          {isCaptain && (
            <button type="button" onClick={handleSaveMatchTactics} disabled={savingTactics}
              className="w-full py-3 rounded-btn bg-accent text-white text-sm font-bold disabled:opacity-50">
              {savingTactics ? "Saving…" : "Save Tactics"}
            </button>
          )}

          {presetPickerOpen && presets && (
            <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-scrim" onClick={() => setPresetPickerOpen(false)}>
              <div className="w-full max-w-lg bg-surface rounded-t-2xl md:rounded-2xl max-h-[70dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-center pt-3 pb-1 md:hidden"><div className="w-10 h-1 rounded-full bg-border" /></div>
                <div className="p-4 space-y-2">
                  <p className="font-bold text-base mb-2">Load a saved setup</p>
                  {presets.map((p) => (
                    <button key={p.id} type="button" onClick={() => applyPreset(p)}
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

      {/* Lineup player picker (captain) */}
      {pickerSlot !== null && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim" onClick={() => setPickerSlot(null)}>
          <div className="w-full max-w-md bg-surface border-t border-border rounded-t-2xl p-5 max-h-[70dvh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
              <p className="font-bold text-base">Assign {players[pickerSlot]?.position}</p>
              <button type="button" onClick={() => setPickerSlot(null)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="space-y-2 overflow-y-auto">
              {lineup[pickerSlot] && (
                <button type="button"
                  onClick={() => { setLineup((prev) => { const n = { ...prev }; delete n[pickerSlot]; return n; }); setPickerSlot(null); }}
                  className="w-full text-left px-3 py-2.5 rounded-xl border border-red-500/30 text-red-600 text-sm font-semibold">
                  Clear this position
                </button>
              )}
              {myParticipants.length === 0 && <p className="text-sm text-text-secondary py-2">No confirmed players to assign.</p>}
              {myParticipants.map((p) => {
                const assignedEntry = Object.entries(lineup).find(([, pid]) => pid === p.player_id);
                const here = assignedEntry !== undefined && Number(assignedEntry[0]) === pickerSlot;
                const init = p.full_name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                return (
                  <button key={p.player_id} type="button"
                    onClick={() => {
                      setLineup((prev) => {
                        const n = { ...prev };
                        // One slot per player — drop any prior slot they held.
                        for (const k of Object.keys(n)) if (n[Number(k)] === p.player_id) delete n[Number(k)];
                        n[pickerSlot] = p.player_id;
                        return n;
                      });
                      setPickerSlot(null);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left ${here ? "bg-accent/10 border-accent" : "bg-surface-2 border-border"}`}>
                    <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] font-semibold text-text-secondary">{init}</span>
                    </div>
                    <p className="flex-1 text-sm truncate">{p.full_name}</p>
                    {assignedEntry !== undefined && (
                      <span className="text-[10px] text-text-secondary">{here ? "Here" : players[Number(assignedEntry[0])]?.position}</span>
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
