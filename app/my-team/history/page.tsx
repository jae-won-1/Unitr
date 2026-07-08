"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type HistoryFixture = {
  postId: string;
  matchRowId: string | null;
  opponent: string;
  date: string;
  time: string;
  pitch: string;
};

type MatchRow = {
  id: string;
  posting_team_id: string;
  challenging_team_id: string;
  confirmed_pitch: { price?: number } | null;
  fees_settled: boolean;
  result_submitted: boolean;
  result_verified: boolean;
};

type RosterPlayer = { player_id: string; name: string };
type CollectRow = { player_id: string; share_pence: number; received: boolean };

function fmtDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

// Availability date_options store a human string like "Tue, 30 JUN 2026".
// Parse it to an ISO date so we can match a poll option to a match_date.
function parseOptionDate(dateStr: string): string | null {
  const m = /(\d{1,2})\s+([A-Z]{3})\s+(\d{4})/.exec((dateStr ?? "").toUpperCase());
  if (!m) return null;
  const [, day, mon, year] = m;
  const mm = MONTHS[mon];
  if (!mm) return null;
  return `${year}-${mm}-${day.padStart(2, "0")}`;
}

// ── Captain's per-match payment collection panel ──────────────────────────
function PaymentCollectionPanel({
  matchId, teamId, isPoster, pitchPricePence, opponent, date, settled, onSettledChange,
}: {
  matchId: string; teamId: string; isPoster: boolean; pitchPricePence: number;
  opponent: string; date: string; settled: boolean;
  onSettledChange: (matchId: string, settled: boolean) => void;
}) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [participantIds, setParticipantIds] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<CollectRow[]>([]);
  const [sending, setSending] = useState(false);
  const [busyPlayer, setBusyPlayer] = useState<string | null>(null);

  const feePence = Math.round(pitchPricePence);
  const half = Math.floor(feePence / 2);
  const teamPool = isPoster ? feePence - half : half;
  const totalWithFee = Math.round(teamPool * 1.05);

  useEffect(() => {
    async function load() {
      // Note: teams.captain_id has no FK relationship registered with profiles
      // in the Supabase schema cache, so it can't be embedded in a select —
      // doing so makes the entire query fail (PGRST200). Fetch separately.
      const [{ data: members }, { data: team }, { data: confs }, { data: statusRows }, { data: polls }] = await Promise.all([
        supabase.from("team_members").select("player_id, profiles(full_name)").eq("team_id", teamId).eq("status", "approved"),
        supabase.from("teams").select("captain_id").eq("id", teamId).maybeSingle(),
        supabase.from("match_confirmations").select("player_id, status").eq("match_id", matchId).eq("team_id", teamId),
        supabase.from("payment_collection_status").select("player_id, share_pence, received").eq("match_id", matchId).eq("team_id", teamId),
        supabase.from("availability_requests").select("id, date_options").eq("team_id", teamId),
      ]);
      const { data: captainProfile } = team?.captain_id
        ? await supabase.from("profiles").select("full_name").eq("id", team.captain_id).maybeSingle()
        : { data: null };
      const rosterList: RosterPlayer[] = [
        ...(members ?? []).map((m) => ({ player_id: m.player_id as string, name: (m.profiles as unknown as { full_name: string } | null)?.full_name ?? "Player" })),
        ...(team?.captain_id ? [{ player_id: team.captain_id as string, name: captainProfile?.full_name ?? "Captain" }] : []),
      ].filter((p, i, arr) => arr.findIndex((x) => x.player_id === p.player_id) === i);
      setRoster(rosterList);
      setRows((statusRows ?? []) as CollectRow[]);

      // Who "played" = players who submitted availability for THIS match's date.
      // Find the poll whose date_options include an entry matching match_date,
      // then collect the players who marked that option as available.
      const participants = new Set<string>();
      type Opt = { id: string; date: string };
      const pollList = (polls ?? []) as { id: string; date_options: Opt[] }[];
      let matchedPoll: { id: string; optionIds: string[] } | null = null;
      for (const poll of pollList) {
        const optionIds = (poll.date_options ?? [])
          .filter((o) => parseOptionDate(o.date) === date)
          .map((o) => o.id);
        if (optionIds.length > 0) { matchedPoll = { id: poll.id, optionIds }; break; }
      }
      if (matchedPoll) {
        const { data: resps } = await supabase.from("availability_responses")
          .select("player_id, available_date_ids").eq("request_id", matchedPoll.id);
        for (const r of resps ?? []) {
          if ((r.available_date_ids ?? []).some((id: string) => matchedPoll!.optionIds.includes(id))) {
            participants.add(r.player_id as string);
          }
        }
      }
      // Fall back to confirmed roster if no availability poll matched this date.
      if (participants.size === 0) {
        for (const c of (confs ?? []).filter((c) => c.status === "confirmed")) participants.add(c.player_id);
      }
      const participantsInRoster = new Set(rosterList.filter((p) => participants.has(p.player_id)).map((p) => p.player_id));
      setParticipantIds(participantsInRoster);
      if (!statusRows || statusRows.length === 0) {
        setChecked(new Set(participantsInRoster));
      }
      setLoading(false);
    }
    load();
  }, [matchId, teamId]);

  const requestSent = rows.length > 0;

  const handleSend = async () => {
    if (!user || checked.size === 0) return;
    setSending(true);
    const playerIds = Array.from(checked);
    const n = playerIds.length;
    const base = Math.floor(totalWithFee / n);
    const remainder = totalWithFee - base * n;

    const newRows: CollectRow[] = playerIds.map((id, i) => ({
      player_id: id,
      share_pence: base + (i < remainder ? 1 : 0),
      received: false,
    }));

    await supabase.from("payment_collection_status").insert(
      newRows.map((r) => ({ match_id: matchId, team_id: teamId, player_id: r.player_id, included: true, share_pence: r.share_pence, received: false }))
    );

    await supabase.from("messages").insert(
      newRows.map((r) => ({
        sender_id: user.id,
        receiver_id: r.player_id,
        type: "payment_reminder",
        match_id: matchId,
        body: `You owe £${(r.share_pence / 100).toFixed(2)} for the match vs ${opponent} (${fmtDate(date)}). Please pay your captain.`,
      }))
    );

    setRows(newRows);
    setSending(false);
  };

  const toggleReceived = async (playerId: string) => {
    const row = rows.find((r) => r.player_id === playerId);
    if (!row) return;
    setBusyPlayer(playerId);
    const next = !row.received;
    const updatedRows = rows.map((r) => r.player_id === playerId ? { ...r, received: next } : r);
    setRows(updatedRows);
    // Keep credited_pence in step with a manual toggle, so the player's own
    // "amount owed" total (derived from credited_pence) stays accurate.
    await supabase.from("payment_collection_status")
      .update({ received: next, credited_pence: next ? row.share_pence : 0, updated_at: new Date().toISOString() })
      .eq("match_id", matchId).eq("player_id", playerId);

    const allReceived = updatedRows.every((r) => r.received);
    if (allReceived !== settled) {
      await supabase.from("matches").update({ fees_settled: allReceived }).eq("id", matchId);
      onSettledChange(matchId, allReceived);
    }
    setBusyPlayer(null);
  };

  return (
    <div className="mt-3 bg-background border border-border rounded-xl p-3">
      <button type="button" onClick={() => setExpanded((e) => !e)} className="w-full flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`transition-transform ${expanded ? "rotate-90" : ""}`}>
            <path d="M9 18l6-6-6-6"/>
          </svg>
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Collect Payment</p>
        </div>
        {!requestSent ? (
          <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/30 px-2 py-0.5 rounded-full">Collect Payment</span>
        ) : settled ? (
          <span className="text-[10px] font-semibold bg-green-500/10 text-green-400 border border-green-500/30 px-2 py-0.5 rounded-full">Paid ✓</span>
        ) : (
          <span className="text-[10px] font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded-full">
            {rows.filter((r) => r.received).length}/{rows.length} paid
          </span>
        )}
      </button>

      {expanded && (
        loading ? (
          <div className="py-3 text-center"><div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" /></div>
        ) : !requestSent ? (
          <div className="mt-3">
            <p className="text-[11px] text-text-secondary mb-3">
              Total owed (booking + 5% fee): <span className="text-text-primary font-semibold">£{(totalWithFee / 100).toFixed(2)}</span>
              {checked.size > 0 && <> · £{(totalWithFee / checked.size / 100).toFixed(2)}/player</>}
            </p>
            {(() => {
              const played = roster.filter((p) => participantIds.has(p.player_id));
              const others = roster.filter((p) => !participantIds.has(p.player_id));
              const renderRow = (p: RosterPlayer) => {
                const isChecked = checked.has(p.player_id);
                return (
                  <button key={p.player_id} type="button"
                    onClick={() => setChecked((prev) => { const next = new Set(prev); next.has(p.player_id) ? next.delete(p.player_id) : next.add(p.player_id); return next; })}
                    className="w-full flex items-center gap-2 bg-surface-2 border border-border rounded-lg px-3 py-2 text-left">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${isChecked ? "border-accent bg-accent" : "border-border"}`}>
                      {isChecked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                    </div>
                    <p className="flex-1 text-xs font-medium truncate">{p.player_id === user?.id ? "You" : p.name}</p>
                  </button>
                );
              };
              return (
                <>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <p className="text-[10px] font-bold text-accent uppercase tracking-wider">Played</p>
                    <span className="text-[10px] text-text-secondary">submitted availability</span>
                  </div>
                  <div className="space-y-1.5 mb-3">
                    {played.length > 0
                      ? played.map(renderRow)
                      : <p className="text-[11px] text-text-secondary px-1 py-1">No availability submitted for this date — add players below.</p>}
                  </div>
                  {others.length > 0 && (
                    <>
                      <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1.5">Add from squad</p>
                      <div className="space-y-1.5 mb-3">{others.map(renderRow)}</div>
                    </>
                  )}
                </>
              );
            })()}
            <button onClick={handleSend} disabled={checked.size === 0 || sending}
              className="w-full py-2.5 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed">
              {sending ? "Sending…" : `Send Payment Request (${checked.size})`}
            </button>
          </div>
        ) : (
          <div className="mt-3 space-y-1.5">
            <p className="text-[11px] text-text-secondary mb-1">Full squad</p>
            {roster.map((p) => {
              const row = rows.find((r) => r.player_id === p.player_id);
              const name = p.player_id === user?.id ? "You" : p.name;
              return (
                <div key={p.player_id} className="flex items-center gap-2 bg-surface-2 border border-border rounded-lg px-3 py-2">
                  <p className="flex-1 min-w-0 text-xs font-medium truncate">{name}</p>
                  {row ? (
                    <>
                      <span className="text-xs font-semibold text-text-secondary flex-shrink-0">£{(row.share_pence / 100).toFixed(2)}</span>
                      <button onClick={() => toggleReceived(p.player_id)} disabled={busyPlayer === p.player_id}
                        className={`text-[10px] font-bold px-2.5 py-1 rounded-full flex-shrink-0 disabled:opacity-50 ${row.received ? "bg-accent/10 text-accent border border-accent/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}>
                        {row.received ? "Paid ✓" : "Unpaid"}
                      </button>
                    </>
                  ) : (
                    <span className="text-[10px] font-semibold text-text-secondary bg-surface border border-border px-2 py-0.5 rounded-full flex-shrink-0">Not charged</span>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}

export default function MatchHistoryPage() {
  const { user } = useAuth();
  const [fixtures, setFixtures] = useState<HistoryFixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCaptainViewer, setIsCaptainViewer] = useState(false);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [matchRows, setMatchRows] = useState<Record<string, MatchRow>>({});
  const [matchResults, setMatchResults] = useState<Record<string, { teamScore: number; opponentScore: number }>>({});

  useEffect(() => {
    if (!user) return;
    async function load() {
      // Resolve the captain id this player's history is tied to (their own
      // id if they captain a team, otherwise their team's captain).
      let captainId: string | undefined = user!.id;
      const { data: ownTeam } = await supabase.from("teams").select("id").eq("captain_id", user!.id).maybeSingle();
      let tid: string | undefined = ownTeam?.id;
      if (!ownTeam) {
        const { data: membership } = await supabase.from("team_members")
          .select("team_id").eq("player_id", user!.id).eq("status", "approved").maybeSingle();
        if (!membership?.team_id) { setLoading(false); return; }
        tid = membership.team_id;
        const { data: team } = await supabase.from("teams").select("captain_id").eq("id", membership.team_id).maybeSingle();
        captainId = team?.captain_id;
      }
      if (!captainId || !tid) { setLoading(false); return; }
      setTeamId(tid);
      setIsCaptainViewer(user!.id === captainId);

      // Matches where this team posted and was challenged
      const { data: myPosts } = await supabase.from("match_posts")
        .select("id, match_date, match_time").eq("captain_id", captainId).eq("status", "matched");

      const posterFixtures = await Promise.all(
        (myPosts ?? []).map(async (post) => {
          const { data: ch } = await supabase.from("challenges")
            .select("challenger_team_name, selected_pitch").eq("post_id", post.id).eq("status", "accepted").maybeSingle();
          return {
            postId: post.id,
            opponent: (ch as { challenger_team_name: string } | null)?.challenger_team_name ?? "Unknown",
            date: post.match_date,
            time: post.match_time,
            pitch: ((ch as { selected_pitch?: { name: string } } | null)?.selected_pitch?.name) ?? "TBC",
          };
        })
      );

      // Matches where this team challenged another team's post
      const { data: myChallenges } = await supabase.from("challenges")
        .select("post_id, selected_pitch").eq("challenger_captain_id", captainId).eq("status", "accepted");

      const challengerFixtures = await Promise.all(
        (myChallenges ?? []).map(async (c) => {
          const { data: post } = await supabase.from("match_posts")
            .select("id, team_name, match_date, match_time").eq("id", c.post_id).maybeSingle();
          return {
            postId: c.post_id,
            opponent: (post as { team_name: string } | null)?.team_name ?? "Unknown",
            date: (post as { match_date: string } | null)?.match_date ?? "",
            time: (post as { match_time: string } | null)?.match_time ?? "",
            pitch: (c.selected_pitch as { name: string } | null)?.name ?? "TBC",
          };
        })
      );

      const all = [...posterFixtures, ...challengerFixtures];

      // Only matches that have already kicked off belong in history.
      const today = new Date().toISOString().split("T")[0];
      const past = all.filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.date) && f.date < today);

      const { data: rows } = past.length > 0
        ? await supabase.from("matches").select("id, post_id, posting_team_id, challenging_team_id, confirmed_pitch, fees_settled, result_submitted, result_verified").in("post_id", past.map((f) => f.postId))
        : { data: [] };
      const byPostId = new Map((rows ?? []).map((r) => [r.post_id, r.id]));
      setMatchRows(Object.fromEntries((rows ?? []).map((r) => [r.id, r as unknown as MatchRow])));

      // Fetch all match_results for past matches, then filter client-side to the
      // current team only. Consistent with match detail page which uses the same
      // pattern — server-side eq("team_id") can return opponent rows unexpectedly.
      const allMatchIds = (rows ?? []).map((r) => r.id);
      if (allMatchIds.length > 0 && tid) {
        const { data: results } = await supabase.from("match_results")
          .select("match_id, team_id, team_score, opponent_score").in("match_id", allMatchIds);
        const myResults = (results ?? []).filter((r) => r.team_id === tid);
        setMatchResults(Object.fromEntries(myResults.map((r) => [r.match_id, { teamScore: r.team_score, opponentScore: r.opponent_score }])));
      }

      const withRows: HistoryFixture[] = past
        .map((f) => ({
          ...f,
          matchRowId: byPostId.get(f.postId) ?? null,
        }))
        .sort((a, b) => b.date.localeCompare(a.date));

      setFixtures(withRows);
      setLoading(false);
    }
    load();
  }, [user]);

  const handleSettledChange = (matchId: string, settled: boolean) => {
    setMatchRows((prev) => ({ ...prev, [matchId]: { ...prev[matchId], fees_settled: settled } }));
  };

  return (
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-8">
      <div className="flex items-center gap-3 mb-6">
        <a href="/my-team">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </a>
        <div>
          <h1 className="text-xl font-bold">Match History</h1>
          <p className="text-xs text-text-secondary">Past fixtures for your team</p>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" /></div>
      ) : fixtures.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <div className="w-16 h-16 rounded-full bg-surface-2 border border-border flex items-center justify-center">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          </div>
          <p className="font-semibold">No match history yet</p>
          <p className="text-sm text-text-secondary max-w-[240px]">Played fixtures will show up here once a confirmed match date has passed.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {fixtures.map((f) => {
            const m = f.matchRowId ? matchRows[f.matchRowId] : undefined;
            return (
              <div key={f.postId} className="bg-surface-2 border border-border rounded-2xl p-4">
                <div className="flex items-start justify-between mb-2 gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">vs {f.opponent}</p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-text-secondary">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                      {fmtDate(f.date)} · {f.time}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-text-secondary">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                      {f.pitch}
                    </div>
                  </div>
                  {f.matchRowId && m?.result_verified && matchResults[f.matchRowId] && (() => {
                    const r = matchResults[f.matchRowId];
                    const outcome = r.teamScore > r.opponentScore ? "won" : r.teamScore < r.opponentScore ? "lost" : "drew";
                    const colorClass = outcome === "won" ? "text-accent" : outcome === "lost" ? "text-red-500" : "text-text-secondary";
                    return (
                      <p className={`text-3xl font-extrabold flex-shrink-0 ${colorClass}`}>{r.teamScore} – {r.opponentScore}</p>
                    );
                  })()}
                </div>

                {f.matchRowId && (!m?.result_verified || !matchResults[f.matchRowId]) ? (
                  <a href={`/my-team/match/${f.matchRowId}/result`} className="block w-full mt-3 py-2 rounded-xl bg-red-500 text-white text-xs font-bold text-center">
                    Submit Result
                  </a>
                ) : f.matchRowId && (
                  <a href={`/my-team/match/${f.matchRowId}`} className="block w-full mt-3 py-2 rounded-xl border border-border text-xs font-semibold text-text-secondary text-center">
                    View Details
                  </a>
                )}

                {isCaptainViewer && f.matchRowId && teamId && m?.confirmed_pitch?.price && !m.fees_settled && (
                  <PaymentCollectionPanel
                    matchId={f.matchRowId}
                    teamId={teamId}
                    isPoster={m.posting_team_id === teamId}
                    pitchPricePence={Math.round((m.confirmed_pitch.price ?? 0) * 100)}
                    opponent={f.opponent}
                    date={f.date}
                    settled={m.fees_settled}
                    onSettledChange={handleSettledChange}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
