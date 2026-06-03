"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTactics } from "@/contexts/TacticsContext";
import { supabase } from "@/lib/supabase";

type PitchInfo = { id?: string; name: string; address?: string; price: number };

type Match = {
  id: string;
  postingTeamId: string;
  challengingTeamId: string;
  postingTeamName: string;
  challengingTeamName: string;
  confirmedPitch: PitchInfo;
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
};

type Tab = "overview" | "squad" | "payment" | "tactics";

const formations: Record<string, { position: string; x: number; y: number }[]> = {
  "4-3-3": [
    { position: "GK", x: 50, y: 88 },
    { position: "LB", x: 15, y: 70 }, { position: "CB", x: 35, y: 72 }, { position: "CB", x: 65, y: 72 }, { position: "RB", x: 85, y: 70 },
    { position: "CM", x: 25, y: 52 }, { position: "CM", x: 50, y: 50 }, { position: "CM", x: 75, y: 52 },
    { position: "LW", x: 15, y: 28 }, { position: "ST", x: 50, y: 22 }, { position: "RW", x: 85, y: 28 },
  ],
  "4-4-2": [
    { position: "GK", x: 50, y: 88 },
    { position: "LB", x: 15, y: 70 }, { position: "CB", x: 35, y: 72 }, { position: "CB", x: 65, y: 72 }, { position: "RB", x: 85, y: 70 },
    { position: "LM", x: 15, y: 50 }, { position: "CM", x: 35, y: 50 }, { position: "CM", x: 65, y: 50 }, { position: "RM", x: 85, y: 50 },
    { position: "ST", x: 35, y: 22 }, { position: "ST", x: 65, y: 22 },
  ],
  "4-2-3-1": [
    { position: "GK", x: 50, y: 88 },
    { position: "LB", x: 15, y: 70 }, { position: "CB", x: 35, y: 72 }, { position: "CB", x: 65, y: 72 }, { position: "RB", x: 85, y: 70 },
    { position: "CDM", x: 35, y: 55 }, { position: "CDM", x: 65, y: 55 },
    { position: "LW", x: 18, y: 36 }, { position: "CAM", x: 50, y: 36 }, { position: "RW", x: 82, y: 36 },
    { position: "ST", x: 50, y: 18 },
  ],
  "3-5-2": [
    { position: "GK", x: 50, y: 88 },
    { position: "CB", x: 25, y: 72 }, { position: "CB", x: 50, y: 74 }, { position: "CB", x: 75, y: 72 },
    { position: "LWB", x: 10, y: 52 }, { position: "CM", x: 30, y: 50 }, { position: "CM", x: 50, y: 55 }, { position: "CM", x: 70, y: 50 }, { position: "RWB", x: 90, y: 52 },
    { position: "ST", x: 35, y: 22 }, { position: "ST", x: 65, y: 22 },
  ],
};

function ConfirmBadge({ status }: { status: string }) {
  if (status === "confirmed") return <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/20 px-2 py-0.5 rounded-full">In</span>;
  if (status === "declined") return <span className="text-[10px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full">Out</span>;
  return <span className="text-[10px] font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-2 py-0.5 rounded-full">Pending</span>;
}

export default function ManageMatchPage({ params }: { params: { matchId: string } }) {
  const { user } = useAuth();
  const { tactics, saveTactics } = useTactics();
  const [match, setMatch] = useState<Match | null | undefined>(undefined);
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [confirmations, setConfirmations] = useState<Confirmation[]>([]);
  const [myConfirmStatus, setMyConfirmStatus] = useState<string | null>(null);
  const [countdown, setCountdown] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [formation, setFormation] = useState("4-3-3");
  const [style, setStyle] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [showPayModal, setShowPayModal] = useState(false);
  const [paymentDone, setPaymentDone] = useState(false);

  const matchMedia = tactics.media.filter((m) => m.matchId === params.matchId);
  const teamMedia = tactics.media.filter((m) => !m.matchId);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const { data: m } = await supabase.from("matches").select("*").eq("id", params.matchId).maybeSingle();
      if (!m) { setMatch(null); return; }

      const [{ data: pt }, { data: ct }] = await Promise.all([
        supabase.from("teams").select("name").eq("id", m.posting_team_id).maybeSingle(),
        supabase.from("teams").select("name").eq("id", m.challenging_team_id).maybeSingle(),
      ]);

      setMatch({
        id: m.id,
        postingTeamId: m.posting_team_id,
        challengingTeamId: m.challenging_team_id,
        postingTeamName: pt?.name ?? "Unknown",
        challengingTeamName: ct?.name ?? "Unknown",
        confirmedPitch: m.confirmed_pitch as PitchInfo,
        match_date: m.match_date,
        match_time: m.match_time,
        status: m.status,
        created_at: m.created_at,
      });

      const { data: captainTeam } = await supabase.from("teams").select("id").eq("captain_id", user.id).maybeSingle();
      let tid = captainTeam?.id ?? null;
      if (!tid) {
        const { data: mem } = await supabase.from("team_members").select("team_id")
          .eq("player_id", user.id).eq("status", "approved").maybeSingle();
        tid = mem?.team_id ?? null;
      }
      setMyTeamId(tid);

      const { data: confs } = await supabase
        .from("match_confirmations")
        .select("player_id, team_id, status, profiles(full_name)")
        .eq("match_id", m.id);

      const mapped = (confs ?? []).map((c) => ({
        player_id: c.player_id,
        team_id: c.team_id,
        status: c.status,
        full_name: (c.profiles as { full_name: string } | null)?.full_name ?? "Unknown",
      }));
      setConfirmations(mapped);
      setMyConfirmStatus(mapped.find((c) => c.player_id === user.id)?.status ?? null);
    }
    load();
  }, [user, params.matchId]);

  // Live countdown: 3h from match creation
  useEffect(() => {
    if (!match) return;
    const deadline = new Date(match.created_at).getTime() + 3 * 60 * 60 * 1000;
    function tick() {
      const r = deadline - Date.now();
      if (r <= 0) { setCountdown("Expired"); return; }
      const h = Math.floor(r / 3600000);
      const min = Math.floor((r % 3600000) / 60000);
      const s = Math.floor((r % 60000) / 1000);
      setCountdown(`${h}h ${String(min).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`);
    }
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [match]);

  const handleConfirmAttendance = async (newStatus: "confirmed" | "declined") => {
    if (!user || !myTeamId) return;
    await supabase.from("match_confirmations").upsert({
      match_id: params.matchId,
      player_id: user.id,
      team_id: myTeamId,
      status: newStatus,
    }, { onConflict: "match_id,player_id" });
    setMyConfirmStatus(newStatus);
    setConfirmations((prev) => prev.map((c) => c.player_id === user.id ? { ...c, status: newStatus } : c));
  };

  if (match === undefined) {
    return <div className="flex items-center justify-center min-h-screen"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;
  }
  if (match === null) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-4 gap-4 text-center">
        <p className="text-text-secondary">Match not found.</p>
        <a href="/my-team" className="text-sm text-accent font-medium">Back to My Team</a>
      </div>
    );
  }

  const confirmedCount = confirmations.filter((c) => c.status === "confirmed").length;
  const totalPlayers = confirmations.length > 0 ? confirmations.length : 22;
  const effectivePlayers = confirmedCount > 0 ? confirmedCount : totalPlayers;
  const perPlayer = ((match.confirmedPitch.price * 1.05) / effectivePlayers).toFixed(2);
  const myTeamName = myTeamId === match.postingTeamId ? match.postingTeamName : match.challengingTeamName;
  const opponentTeamId = myTeamId === match.postingTeamId ? match.challengingTeamId : match.postingTeamId;
  const opponentName = myTeamId === match.postingTeamId ? match.challengingTeamName : match.postingTeamName;
  const myTeamConfs = confirmations.filter((c) => c.team_id === myTeamId);
  const opponentConfs = confirmations.filter((c) => c.team_id === opponentTeamId);
  const players = formations[formation];

  return (
    <div className="flex flex-col min-h-screen px-4 pt-12 pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <a href="/my-team">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </a>
        <div className="flex-1">
          <h1 className="text-base font-bold">{myTeamName} vs {opponentName}</h1>
          <p className="text-xs text-text-secondary">{match.match_date} · {match.match_time}</p>
        </div>
        <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/30 px-2 py-1 rounded-full">Confirmed</span>
      </div>

      {/* Tabs */}
      <div className="flex bg-surface-2 border border-border rounded-xl p-1 mb-5 gap-0.5">
        {(["overview", "squad", "payment", "tactics"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold capitalize transition-colors ${tab === t ? "bg-accent text-black" : "text-text-secondary"}`}>
            {t}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="bg-accent/10 border border-accent/30 rounded-2xl p-4 space-y-2.5">
            <p className="text-sm font-bold text-accent mb-1">Match Details</p>
            {[
              { label: "My Team", value: myTeamName },
              { label: "Opponent", value: opponentName },
              { label: "Date", value: match.match_date },
              { label: "Kick-off", value: match.match_time },
              { label: "Venue", value: match.confirmedPitch.name },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between text-xs">
                <span className="text-text-secondary">{label}</span>
                <span className="font-semibold">{value}</span>
              </div>
            ))}
          </div>

          {/* Payment countdown */}
          <div className="bg-surface-2 border border-border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-semibold">Payment Deadline</p>
              <span className={`text-sm font-bold tabular-nums ${countdown === "Expired" ? "text-red-400" : "text-accent"}`}>{countdown}</span>
            </div>
            <p className="text-xs text-text-secondary mb-3">
              {confirmedCount}/{confirmations.length} players confirmed · £{perPlayer}/player
            </p>
            <button onClick={() => setTab("payment")}
              className="w-full py-2.5 rounded-xl bg-accent text-black font-bold text-sm">
              Pay Your Share
            </button>
          </div>

          {/* Attendance */}
          {myConfirmStatus !== null && (
            <div className="bg-surface-2 border border-border rounded-2xl p-4">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">Your Attendance</p>
              <div className="flex gap-2">
                <button onClick={() => handleConfirmAttendance("confirmed")}
                  className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-colors ${myConfirmStatus === "confirmed" ? "bg-accent text-black" : "bg-surface border border-border text-text-secondary"}`}>
                  ✓ I&apos;m In
                </button>
                <button onClick={() => handleConfirmAttendance("declined")}
                  className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-colors ${myConfirmStatus === "declined" ? "bg-red-500/20 text-red-400 border border-red-500/30" : "bg-surface border border-border text-text-secondary"}`}>
                  ✕ Can&apos;t Make It
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── SQUAD ── */}
      {tab === "squad" && (
        <div className="space-y-5">
          {/* My team */}
          <div>
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">{myTeamName}</p>
            {myTeamConfs.length === 0 ? (
              <p className="text-xs text-text-secondary py-4 text-center">No players listed.</p>
            ) : (
              <div className="space-y-2">
                {myTeamConfs.map((c) => {
                  const initials = c.full_name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                  const isMe = c.player_id === user?.id;
                  return (
                    <div key={c.player_id} className="bg-surface-2 border border-border rounded-xl px-4 py-3 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-accent">{initials}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{c.full_name}{isMe ? " (You)" : ""}</p>
                      </div>
                      {isMe ? (
                        <div className="flex gap-1.5">
                          <button onClick={() => handleConfirmAttendance("confirmed")}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${myConfirmStatus === "confirmed" ? "bg-accent text-black" : "bg-surface border border-border text-text-secondary"}`}>
                            In
                          </button>
                          <button onClick={() => handleConfirmAttendance("declined")}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${myConfirmStatus === "declined" ? "bg-red-500/20 text-red-400 border border-red-500/30" : "bg-surface border border-border text-text-secondary"}`}>
                            Out
                          </button>
                        </div>
                      ) : (
                        <ConfirmBadge status={c.status} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Opponent team */}
          <div>
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">{opponentName}</p>
            {opponentConfs.length === 0 ? (
              <p className="text-xs text-text-secondary py-4 text-center">No players listed.</p>
            ) : (
              <div className="space-y-2">
                {opponentConfs.map((c) => {
                  const initials = c.full_name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                  return (
                    <div key={c.player_id} className="bg-surface-2 border border-border rounded-xl px-4 py-3 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-text-secondary">{initials}</span>
                      </div>
                      <p className="flex-1 text-sm font-medium truncate">{c.full_name}</p>
                      <ConfirmBadge status={c.status} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PAYMENT ── */}
      {tab === "payment" && (
        <div className="space-y-4">
          <div className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
            <p className="text-sm font-semibold">Payment Breakdown</p>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-text-secondary">
                <span>Pitch hire (1hr)</span>
                <span className="font-semibold text-text-primary">£{match.confirmedPitch.price}</span>
              </div>
              <div className="flex justify-between text-text-secondary">
                <span>Unitr fee (5%)</span>
                <span className="font-semibold text-text-primary">£{(match.confirmedPitch.price * 0.05).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-text-secondary">
                <span>Players confirmed</span>
                <span className="font-semibold text-text-primary">{confirmedCount} players</span>
              </div>
              <div className="flex justify-between border-t border-border pt-2">
                <span className="font-semibold text-text-primary">Your share</span>
                <span className="font-bold text-accent text-sm">£{perPlayer}</span>
              </div>
            </div>
            <p className="text-[10px] text-text-secondary">Split updates live as players confirm. Final charge at deadline.</p>
          </div>

          <div className="bg-surface-2 border border-border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold">Payment Deadline</p>
              <span className={`text-sm font-bold tabular-nums ${countdown === "Expired" ? "text-red-400" : "text-accent"}`}>{countdown}</span>
            </div>
            <div className="w-full h-1.5 bg-background rounded-full mb-2">
              <div className="h-1.5 bg-accent rounded-full transition-all"
                style={{ width: `${Math.min(100, confirmations.length > 0 ? (confirmedCount / confirmations.length) * 100 : 0)}%` }} />
            </div>
            <p className="text-xs text-text-secondary">{confirmedCount} of {confirmations.length} players confirmed</p>
          </div>

          {paymentDone ? (
            <div className="bg-accent/10 border border-accent/30 rounded-2xl p-6 text-center">
              <div className="w-14 h-14 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center mx-auto mb-3">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <p className="font-bold text-accent mb-1">Payment Confirmed!</p>
              <p className="text-xs text-text-secondary">£{perPlayer} · Your spot is secured.</p>
            </div>
          ) : (
            <button onClick={() => setShowPayModal(true)}
              className="w-full py-3.5 rounded-xl bg-accent text-black font-bold text-sm">
              Pay £{perPlayer} via Stripe
            </button>
          )}
        </div>
      )}

      {/* ── TACTICS ── */}
      {tab === "tactics" && (
        <div className="space-y-4">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {Object.keys(formations).map((f) => (
              <button key={f} onClick={() => setFormation(f)}
                className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${formation === f ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>{f}</button>
            ))}
          </div>

          <div className="relative w-full rounded-2xl overflow-hidden" style={{ paddingBottom: "130%", background: "linear-gradient(180deg, #1a5c1a 0%, #1e6b1e 25%, #1a5c1a 50%, #1e6b1e 75%, #1a5c1a 100%)" }}>
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 130" preserveAspectRatio="none">
              <rect x="5" y="5" width="90" height="120" rx="1" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
              <line x1="5" y1="65" x2="95" y2="65" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
              <circle cx="50" cy="65" r="10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
              <circle cx="50" cy="65" r="0.8" fill="rgba(255,255,255,0.6)"/>
              <rect x="22" y="5" width="56" height="20" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
              <rect x="34" y="5" width="32" height="10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
              <rect x="22" y="105" width="56" height="20" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
              <rect x="34" y="115" width="32" height="10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5"/>
            </svg>
            {players.map((p, i) => (
              <div key={i} className="absolute flex flex-col items-center" style={{ left: `${p.x}%`, top: `${p.y}%`, transform: "translate(-50%, -50%)" }}>
                <div className="w-8 h-8 rounded-full bg-accent border-2 border-white flex items-center justify-center shadow-lg">
                  <span className="text-[9px] font-bold text-black leading-none">{p.position}</span>
                </div>
              </div>
            ))}
          </div>

          <div>
            <p className="text-sm font-semibold mb-2">Match Plan</p>
            <div className="flex gap-2 flex-wrap">
              {["Possession", "Counter-Attack", "High Press", "Direct Play", "Park the Bus"].map((s) => (
                <button key={s} onClick={() => setStyle(s === style ? null : s)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${style === s ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>{s}</button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold mb-2">Match Notes</p>
            <textarea rows={3}
              placeholder={`Instructions vs ${opponentName} — weaknesses, set pieces, key threats…`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/50 resize-none"
            />
          </div>

          <div>
            <p className="text-sm font-semibold mb-2">Media</p>
            {[...matchMedia, ...teamMedia].length === 0 ? (
              <p className="text-xs text-text-secondary italic mb-3">No media added yet.</p>
            ) : (
              <div className="space-y-2 mb-3">
                {[...matchMedia, ...teamMedia].map((item) => (
                  <div key={item.id} className="bg-surface-2 border border-border rounded-xl px-4 py-3 flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${item.type === "video" ? "bg-purple-500/15 border border-purple-500/30" : "bg-blue-500/15 border border-blue-500/30"}`}>
                      {item.type === "video"
                        ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2" strokeLinecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.label}</p>
                      <p className="text-xs text-text-secondary capitalize">{item.type}</p>
                    </div>
                    <button onClick={() => saveTactics({ media: tactics.media.filter((m) => m.id !== item.id) })} className="text-xs text-red-400">Remove</button>
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => saveTactics({ media: [...tactics.media, { id: String(Date.now()), type: "image", label: "New image tactic", matchId: params.matchId }] })}
                className="flex flex-col items-center gap-2 bg-surface-2 border border-dashed border-border rounded-xl py-4 text-text-secondary">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span className="text-xs font-semibold">Upload Image</span>
              </button>
              <button onClick={() => saveTactics({ media: [...tactics.media, { id: String(Date.now() + 1), type: "video", label: "New video tactic", matchId: params.matchId }] })}
                className="flex flex-col items-center gap-2 bg-surface-2 border border-dashed border-border rounded-xl py-4 text-text-secondary">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                <span className="text-xs font-semibold">Upload Video</span>
              </button>
            </div>
          </div>

          <button className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm">
            Save &amp; Share with Squad
          </button>
        </div>
      )}

      {/* Payment modal */}
      {showPayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-5">
          <div className="w-full max-w-sm bg-[#141414] border border-border rounded-2xl p-6 text-center">
            <p className="font-bold text-lg mb-1">Confirm Payment</p>
            <p className="text-sm text-text-secondary mb-5">£{perPlayer} will be charged in test mode.</p>
            <div className="bg-surface-2 border border-border rounded-xl p-3 mb-5 text-left space-y-1.5 text-xs">
              <div className="flex justify-between"><span className="text-text-secondary">Venue</span><span className="font-semibold">{match.confirmedPitch.name}</span></div>
              <div className="flex justify-between"><span className="text-text-secondary">Match</span><span className="font-semibold">{match.match_date}</span></div>
              <div className="flex justify-between"><span className="text-text-secondary">Amount</span><span className="font-bold text-accent">£{perPlayer}</span></div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowPayModal(false)}
                className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold text-text-secondary">Cancel</button>
              <button onClick={() => { setShowPayModal(false); setPaymentDone(true); }}
                className="flex-1 py-3 rounded-xl bg-accent text-black font-bold text-sm">Confirm</button>
            </div>
            <p className="text-[10px] text-text-secondary mt-3">Test mode · No real charge</p>
          </div>
        </div>
      )}
    </div>
  );
}
