"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useRole } from "@/contexts/RoleContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { DatePicker, TimePicker } from "@/components/DateTimePickers";

// ── Types ─────────────────────────────────────────────────────
type DateOption = {
  id: string;
  date: string;
  time: string;
  day: string;
  month: string;
  dayName: string;
};

type AvailabilityRequest = {
  id: string;
  team_id: string;
  captain_id: string;
  date_options: DateOption[];
  created_at: string;
};

type PlayerResponse = {
  player_id: string;
  available_date_ids: string[];
  profiles: { full_name: string } | null;
};

// ── Helpers ───────────────────────────────────────────────────
const AVAIL_MONTHS: Record<string, number> = {
  JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11,
};

function parseDateOption(dateStr: string, timeStr: string): DateOption {
  const d = new Date(dateStr + "T" + timeStr);
  const day = String(d.getDate()).padStart(2, "0");
  const monthNames = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const month = monthNames[d.getMonth()];
  const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const dayName = dayNames[d.getDay()];
  const display = `${dayName.slice(0,3)}, ${day} ${month} ${d.getFullYear()}`;
  return { id: crypto.randomUUID(), date: display, time: timeStr, day, month, dayName };
}

function getInitials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

function isExpired(opt: DateOption): boolean {
  const m = opt.date.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m) return false;
  const mo = AVAIL_MONTHS[m[2].toUpperCase()];
  if (mo === undefined) return false;
  const [h, min] = opt.time.split(":").map(Number);
  return new Date(Number(m[3]), mo, Number(m[1]), h, min) < new Date();
}

// ── Captain create request form ───────────────────────────────
function isWithin24h(date: string, time: string): boolean {
  if (!date || !time) return false;
  const dt = new Date(date + "T" + time);
  const diff = dt.getTime() - Date.now();
  return diff > 0 && diff < 24 * 60 * 60 * 1000;
}

function CreateRequestForm({ teamId, onCreated }: { teamId: string; onCreated: () => void }) {
  const { user } = useAuth();
  const [rows, setRows] = useState([{ date: "", time: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateRow = (i: number, field: "date" | "time", value: string) =>
    setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));

  const handleSubmit = async () => {
    if (!user) return;
    const filled = rows.filter((r) => r.date && r.time);
    if (filled.length < 1) { setError("Add at least 1 date option."); return; }
    setSaving(true);
    setError(null);

    const { data: existing } = await supabase
      .from("availability_requests").select("id").eq("team_id", teamId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (existing) {
      await fetch("/api/availability/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: existing.id, captainId: user.id }),
      });
    }

    const date_options = filled.map((r) => parseDateOption(r.date, r.time));
    const { error: insertError } = await supabase
      .from("availability_requests")
      .insert({ team_id: teamId, captain_id: user.id, date_options });

    setSaving(false);
    if (insertError) { setError(insertError.message); return; }
    onCreated();
  };

  return (
    <div className="flex flex-col gap-5 pt-2">
      <div className="bg-surface-2 border border-border rounded-xl p-4">
        <p className="text-sm font-semibold mb-1">Send availability request</p>
        <p className="text-xs text-text-secondary">Add 1–5 date options. Your squad will vote on which they can make.</p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {rows.map((row, i) => (
          <div key={i} className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-text-secondary">Date {i + 1}</span>
            <div className="flex items-center gap-2">
              <div className="w-36 flex flex-col gap-1">
                <label className="text-xs text-text-secondary">Date</label>
                <DatePicker value={row.date} onChange={(d) => updateRow(i, "date", d)} />
              </div>
              <div className="w-36 flex flex-col gap-1">
                <label className="text-xs text-text-secondary">Time</label>
                <TimePicker value={row.time} selectedDate={row.date} onChange={(t) => updateRow(i, "time", t)} />
              </div>
              {rows.length > 1 && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs invisible">_</span>
                  <button onClick={() => setRows((p) => p.filter((_, idx) => idx !== i))}
                    className="w-7 h-7 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center justify-center">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                    </svg>
                  </button>
                </div>
              )}
            </div>
            {isWithin24h(row.date, row.time) && (
              <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3 py-2.5">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#EAB308" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0 mt-0.5">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <p className="text-xs text-yellow-400">You have selected a time less than 24 hours from now. The team credits will not be reimbursed if you cannot find an opponent.</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {rows.length < 5 && (
        <button onClick={() => setRows((p) => [...p, { date: "", time: "" }])}
          className="flex items-center gap-2 text-sm text-accent font-medium py-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          Add date option
        </button>
      )}

      <button onClick={handleSubmit} disabled={saving}
        className="w-full py-3.5 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
        {saving
          ? <><svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Sending…</>
          : "Send to Squad"}
      </button>
    </div>
  );
}

// ── Captain responses view ────────────────────────────────────
function CaptainResponsesView({
  request, responses, totalMembers, onNewRequest, user,
}: {
  request: AvailabilityRequest; responses: PlayerResponse[]; totalMembers: number;
  onNewRequest: () => void; user: { id: string };
}) {
  const router = useRouter();
  const [chosenDates, setChosenDates] = useState<string[]>([]);

  const countAvailable = (id: string) => responses.filter((r) => r.available_date_ids.includes(id)).length;
  const best = request.date_options.reduce((b, d) => countAvailable(d.id) > countAvailable(b.id) ? d : b, request.date_options[0]);

  const toggleDate = (id: string) =>
    setChosenDates((p) => p.includes(id) ? p.filter((d) => d !== id) : p.length < 3 ? [...p, id] : p);

  const handleConfirm = () => {
    if (chosenDates.length === 0) return;
    const selectedOptions = request.date_options.filter((o) => chosenDates.includes(o.id));
    localStorage.setItem("unitr_confirmed_dates", JSON.stringify(selectedOptions));
    router.push("/play/create");
  };

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex items-center justify-between">
        <div className="bg-surface-2 border border-border rounded-xl p-4 flex-1">
          <p className="text-xs text-text-secondary mb-1">{responses.length}/{totalMembers} players responded</p>
          <p className="text-sm font-semibold">Select up to 3 dates to post matches</p>
        </div>
        <button onClick={async () => {
          await fetch("/api/availability/delete", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requestId: request.id, captainId: user.id }),
          });
          onNewRequest();
        }} className="ml-3 px-3 py-2 rounded-xl border border-border text-xs text-text-secondary">
          New request
        </button>
      </div>

      {chosenDates.length > 0 && (
        <div className="bg-accent/10 border border-accent/30 rounded-xl px-4 py-3 flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          <p className="text-xs text-accent font-medium">
            {chosenDates.length} date{chosenDates.length > 1 ? "s" : ""} selected
          </p>
        </div>
      )}

      {best && (
        <div className="bg-surface-2 border border-accent/20 rounded-2xl p-4 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-accent text-black flex flex-col items-center justify-center flex-shrink-0">
            <span className="text-[9px] font-bold uppercase">{best.month}</span>
            <span className="text-xl font-bold leading-none">{best.day}</span>
          </div>
          <div>
            <p className="text-xs text-accent font-semibold uppercase tracking-wider mb-0.5">Best availability</p>
            <p className="text-sm font-bold">{best.dayName} · {best.time}</p>
            <p className="text-xs text-text-secondary">{countAvailable(best.id)}/{totalMembers} available</p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {request.date_options.map((opt) => {
          const count = countAvailable(opt.id);
          const pct = totalMembers > 0 ? Math.round((count / totalMembers) * 100) : 0;
          const isBest = best?.id === opt.id;
          const idx = chosenDates.indexOf(opt.id);
          const isChosen = idx !== -1;
          const available = responses.filter((r) => r.available_date_ids.includes(opt.id));
          const unavailable = responses.filter((r) => !r.available_date_ids.includes(opt.id));

          return (
            <button key={opt.id} onClick={() => toggleDate(opt.id)}
              className={`rounded-2xl border p-4 text-left transition-all ${isChosen ? "bg-accent/10 border-accent/60" : isBest ? "bg-surface-2 border-accent/30" : "bg-surface-2 border-border"}`}>
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center flex-shrink-0 relative ${isChosen ? "bg-accent text-black" : "bg-background"}`}>
                  <span className="text-[9px] font-bold uppercase">{opt.month}</span>
                  <span className="text-xl font-bold leading-none">{opt.day}</span>
                  {isChosen && (
                    <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black border border-accent flex items-center justify-center">
                      <span className="text-[10px] font-bold text-accent">{idx + 1}</span>
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{opt.dayName}</p>
                    {isBest && <span className="text-[10px] font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded-md">Best</span>}
                  </div>
                  <p className="text-xs text-text-secondary">KO {opt.time}</p>
                </div>
                <span className="text-sm font-bold text-accent">{count}/{totalMembers}</span>
              </div>
              <div className="w-full h-1.5 bg-background rounded-full mb-2">
                <div className={`h-1.5 rounded-full transition-all ${isBest || isChosen ? "bg-accent" : "bg-border"}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {available.map((p) => {
                  const name = p.profiles?.full_name ?? "Player";
                  return <div key={p.player_id} title={name} className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border bg-accent/20 border-accent/40 text-accent">{getInitials(name)}</div>;
                })}
                {unavailable.map((p) => {
                  const name = p.profiles?.full_name ?? "Player";
                  return <div key={p.player_id} title={name} className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border bg-surface border-border text-text-secondary opacity-40">{getInitials(name)}</div>;
                })}
              </div>
            </button>
          );
        })}
      </div>

      <button disabled={chosenDates.length === 0} onClick={handleConfirm}
        className="w-full py-3.5 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed">
        {chosenDates.length === 0 ? "Select dates to post" : `Post ${chosenDates.length} Match${chosenDates.length > 1 ? "es" : ""} →`}
      </button>
    </div>
  );
}

// ── Player availability tab ───────────────────────────────────
function PlayerAvailabilityTab({ userId }: { userId: string }) {
  const [request, setRequest] = useState<AvailabilityRequest | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: membership } = await supabase.from("team_members").select("team_id")
        .eq("player_id", userId).eq("status", "approved").maybeSingle();
      if (!membership) { setLoading(false); return; }

      const { data: req } = await supabase.from("availability_requests").select("*")
        .eq("team_id", membership.team_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!req) { setLoading(false); return; }

      const active = (req.date_options as DateOption[]).filter((o) => !isExpired(o));
      if (active.length === 0) { setLoading(false); return; }
      setRequest({ ...req, date_options: active });

      const { data: existing } = await supabase.from("availability_responses").select("available_date_ids")
        .eq("request_id", req.id).eq("player_id", userId).maybeSingle();
      if (existing) { setSelected(existing.available_date_ids ?? []); setSubmitted(true); }
      setLoading(false);
    })();
  }, [userId]);

  const toggle = (id: string) =>
    setSelected((p) => p.includes(id) ? p.filter((d) => d !== id) : [...p, id]);

  const handleSubmit = async () => {
    if (!request) return;
    setSaving(true);
    await supabase.from("availability_responses").upsert(
      { request_id: request.id, player_id: userId, available_date_ids: selected },
      { onConflict: "request_id,player_id" }
    );
    setSaving(false);
    setSubmitted(true);
  };

  if (loading) return <div className="py-12 text-center text-sm text-text-secondary">Loading…</div>;
  if (!request) return (
    <div className="py-12 text-center">
      <p className="text-sm text-text-secondary">No availability request yet.</p>
      <p className="text-xs text-text-secondary mt-1">Your captain hasn&apos;t sent one yet.</p>
    </div>
  );
  if (submitted) return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <div className="w-16 h-16 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <p className="text-lg font-bold">Availability submitted!</p>
      <p className="text-sm text-text-secondary text-center max-w-[240px]">Your captain will see your response.</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="bg-accent/10 border border-accent/30 rounded-xl p-4">
        <p className="text-sm font-semibold text-accent mb-1">Action needed</p>
        <p className="text-xs text-text-secondary">Tap all the dates you can play.</p>
      </div>
      <div className="flex flex-col gap-3">
        {request.date_options.map((opt) => {
          const isSel = selected.includes(opt.id);
          return (
            <button key={opt.id} onClick={() => toggle(opt.id)}
              className={`flex items-center gap-4 p-4 rounded-2xl border transition-all text-left ${isSel ? "bg-accent/10 border-accent/60" : "bg-surface-2 border-border"}`}>
              <div className={`w-14 h-14 rounded-xl flex flex-col items-center justify-center flex-shrink-0 ${isSel ? "bg-accent text-black" : "bg-background"}`}>
                <span className="text-[10px] font-bold uppercase">{opt.month}</span>
                <span className="text-2xl font-bold leading-none">{opt.day}</span>
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">{opt.dayName}</p>
                <p className="text-xs text-text-secondary">{opt.date} · KO {opt.time}</p>
              </div>
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${isSel ? "border-accent bg-accent" : "border-border"}`}>
                {isSel && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
              </div>
            </button>
          );
        })}
      </div>
      <button onClick={handleSubmit} disabled={selected.length === 0 || saving}
        className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
        {saving ? <><svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Saving…</> : `Submit (${selected.length} selected)`}
      </button>
    </div>
  );
}

// ── Captain availability tab ──────────────────────────────────
function CaptainAvailabilityTab({ userId }: { userId: string }) {
  const [teamId, setTeamId] = useState<string | null>(null);
  const [request, setRequest] = useState<AvailabilityRequest | null | undefined>(undefined);
  const [responses, setResponses] = useState<PlayerResponse[]>([]);
  const [totalMembers, setTotalMembers] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: team } = await supabase.from("teams").select("id").eq("captain_id", userId).maybeSingle();
      if (!team) { setLoading(false); return; }
      setTeamId(team.id);

      const { count } = await supabase.from("team_members").select("*", { count: "exact", head: true })
        .eq("team_id", team.id).eq("status", "approved");
      setTotalMembers(count ?? 0);

      const { data: req } = await supabase.from("availability_requests").select("*")
        .eq("team_id", team.id).order("created_at", { ascending: false }).limit(1).maybeSingle();

      if (!req) { setRequest(null); setLoading(false); return; }
      const active = (req.date_options as DateOption[]).filter((o) => !isExpired(o));
      if (active.length === 0) {
        await fetch("/api/availability/delete", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: req.id, captainId: userId }),
        });
        setRequest(null); setLoading(false); return;
      }
      setRequest({ ...req, date_options: active });

      const { data: resps } = await supabase.from("availability_responses")
        .select("player_id, available_date_ids, profiles(full_name)").eq("request_id", req.id);
      setResponses((resps ?? []) as unknown as PlayerResponse[]);
      setLoading(false);
    })();
  }, [userId]);

  if (loading) return <div className="py-12 text-center text-sm text-text-secondary">Loading…</div>;
  if (!teamId) return (
    <div className="py-12 text-center">
      <p className="text-sm text-text-secondary">Register a team first.</p>
      <a href="/my-team/create" className="mt-3 inline-block px-5 py-2.5 rounded-xl bg-accent text-black font-bold text-sm">Register Team</a>
    </div>
  );
  if (!request) return <CreateRequestForm teamId={teamId} onCreated={() => setRequest(undefined)} />;

  return (
    <CaptainResponsesView
      request={request} responses={responses} totalMembers={totalMembers}
      user={{ id: userId }}
      onNewRequest={() => { setRequest(null); setResponses([]); }}
    />
  );
}

// ── Page ──────────────────────────────────────────────────────
export default function CollectAvailabilityPage() {
  const { user } = useAuth();
  const { role, roleLoading } = useRole();

  if (roleLoading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  );

  return (
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <a href="/my-team">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </a>
        <div>
          <h1 className="text-xl font-bold">
            {role === "captain" ? "Collect Availability" : "My Availability"}
          </h1>
          <p className="text-xs text-text-secondary">
            {role === "captain" ? "Send date options to your squad" : "Respond to your captain's request"}
          </p>
        </div>
      </div>

      {user && (role === "captain"
        ? <CaptainAvailabilityTab userId={user.id} />
        : <PlayerAvailabilityTab userId={user.id} />)}
    </div>
  );
}
