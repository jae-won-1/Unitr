"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useRole } from "@/contexts/RoleContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { DatePicker, TimePicker } from "@/components/DateTimePickers";

// ── Types ─────────────────────────────────────────────────────
type CalEvent = {
  date: string; // YYYY-MM-DD
  label: string;
  sublabel?: string;
  type: "fixture" | "availability";
};

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
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_LABELS = ["M","T","W","T","F","S","S"];
const MONTHS_SHORT: Record<string, string> = {
  JAN:"01",FEB:"02",MAR:"03",APR:"04",MAY:"05",JUN:"06",
  JUL:"07",AUG:"08",SEP:"09",OCT:"10",NOV:"11",DEC:"12",
};

function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate(); }
function firstWeekday(y: number, m: number) { return (new Date(y, m, 1).getDay() + 6) % 7; } // Mon=0

function parseDisplayDate(s: string): string | null {
  const m = s.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m) return null;
  const mm = MONTHS_SHORT[m[2].toUpperCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
}

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

const AVAIL_MONTHS: Record<string, number> = {
  JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11,
};
function isExpired(opt: DateOption): boolean {
  const m = opt.date.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m) return false;
  const mo = AVAIL_MONTHS[m[2].toUpperCase()];
  if (mo === undefined) return false;
  const [h, min] = opt.time.split(":").map(Number);
  return new Date(Number(m[3]), mo, Number(m[1]), h, min) < new Date();
}

// ── Calendar grid ─────────────────────────────────────────────
function CalendarGrid({
  year, month, selectedDay, eventsByDate, todayStr,
  onSelectDay,
}: {
  year: number; month: number; selectedDay: number | null;
  eventsByDate: Map<string, CalEvent[]>; todayStr: string;
  onSelectDay: (d: number) => void;
}) {
  const total = daysInMonth(year, month);
  const offset = firstWeekday(year, month);
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <>
      <div className="grid grid-cols-7 mb-1">
        {DAY_LABELS.map((d, i) => (
          <div key={i} className="text-center text-[11px] font-semibold text-text-secondary py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const isToday = dateStr === todayStr;
          const isSelected = selectedDay === day;
          const evts = eventsByDate.get(dateStr) ?? [];
          const hasFixture = evts.some((e) => e.type === "fixture");
          const hasAvail = evts.some((e) => e.type === "availability");

          return (
            <button key={i} onClick={() => onSelectDay(day)}
              className="flex flex-col items-center py-1 rounded-xl transition-colors active:bg-surface-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors
                ${isSelected ? "bg-accent text-black"
                  : isToday ? "border-2 border-accent text-accent"
                  : "text-text-primary"}`}>
                {day}
              </div>
              <div className="flex gap-0.5 mt-0.5 h-1.5 items-center">
                {hasFixture && (
                  <div className={`w-1.5 h-1.5 rounded-full ${isSelected ? "bg-black" : "bg-accent"}`} />
                )}
                {hasAvail && (
                  <div className={`w-1.5 h-1.5 rounded-full ${isSelected ? "bg-black/60" : "bg-blue-400"}`} />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

// ── Availability collection form (captain) ────────────────────
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
                <TimePicker value={row.time} onChange={(t) => updateRow(i, "time", t)} />
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

// ── Captain availability responses view ───────────────────────
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
      if (active.length === 0) { setRequest(null); setLoading(false); return; }
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
export default function CalendarPage() {
  const { user } = useAuth();
  const { role, roleLoading } = useRole();
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  const [tab, setTab] = useState<"calendar" | "availability">("calendar");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  useEffect(() => {
    if (!user || !role) return;
    (async () => {
      const evts: CalEvent[] = [];
      let captainId = user.id;
      let teamId: string | null = null;

      if (role === "captain") {
        const { data: team } = await supabase.from("teams").select("id").eq("captain_id", user.id).maybeSingle();
        teamId = team?.id ?? null;
      } else {
        const { data: mem } = await supabase.from("team_members")
          .select("team_id, teams(captain_id)").eq("player_id", user.id).eq("status", "approved").maybeSingle();
        if (mem) {
          teamId = (mem as any).team_id;
          captainId = (mem as any).teams?.captain_id ?? user.id;
        }
      }

      // Fixtures as poster
      const { data: myPosts } = await supabase.from("match_posts")
        .select("id, match_date, match_time").eq("captain_id", captainId).eq("status", "matched");
      for (const post of myPosts ?? []) {
        const { data: ch } = await supabase.from("challenges")
          .select("challenger_team_name").eq("post_id", post.id).eq("status", "accepted").maybeSingle();
        evts.push({
          date: post.match_date,
          label: `vs ${(ch as any)?.challenger_team_name ?? "Opponent"}`,
          sublabel: post.match_time,
          type: "fixture",
        });
      }

      // Fixtures as challenger
      const { data: myChallenges } = await supabase.from("challenges")
        .select("post_id").eq("challenger_captain_id", captainId).eq("status", "accepted");
      for (const c of myChallenges ?? []) {
        const { data: post } = await supabase.from("match_posts")
          .select("team_name, match_date, match_time").eq("id", c.post_id).maybeSingle();
        if (post) {
          evts.push({
            date: (post as any).match_date,
            label: `vs ${(post as any).team_name ?? "Opponent"}`,
            sublabel: (post as any).match_time,
            type: "fixture",
          });
        }
      }

      // Availability request dates
      if (teamId) {
        const { data: req } = await supabase.from("availability_requests").select("date_options")
          .eq("team_id", teamId).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (req) {
          for (const opt of (req.date_options as DateOption[]) ?? []) {
            const parsed = parseDisplayDate(opt.date);
            if (parsed) {
              evts.push({ date: parsed, label: "Availability slot", sublabel: opt.time, type: "availability" });
            }
          }
        }
      }

      setEvents(evts);
      setEventsLoading(false);
    })();
  }, [user, role]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const e of events) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    return map;
  }, [events]);

  const selectedDateStr = selectedDay
    ? `${year}-${String(month + 1).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`
    : null;
  const selectedEvents = selectedDateStr ? (eventsByDate.get(selectedDateStr) ?? []) : [];

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear((y) => y - 1); } else setMonth((m) => m - 1); setSelectedDay(null); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear((y) => y + 1); } else setMonth((m) => m + 1); setSelectedDay(null); };

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
          <h1 className="text-xl font-bold">Calendar</h1>
          <p className="text-xs text-text-secondary">Fixtures &amp; availability</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex bg-surface-2 border border-border rounded-xl p-1 gap-1 mb-5">
        {(["calendar", "availability"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold capitalize transition-colors ${tab === t ? "bg-accent text-black" : "text-text-secondary"}`}>
            {t === "calendar" ? "Calendar" : role === "captain" ? "Collect Availability" : "My Availability"}
          </button>
        ))}
      </div>

      {tab === "calendar" ? (
        <>
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-4">
            <button onClick={prevMonth} className="w-9 h-9 flex items-center justify-center rounded-full bg-surface-2 border border-border">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <h2 className="text-base font-bold">{MONTH_NAMES[month]} {year}</h2>
            <button onClick={nextMonth} className="w-9 h-9 flex items-center justify-center rounded-full bg-surface-2 border border-border">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mb-4 px-1">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-accent" />
              <span className="text-[11px] text-text-secondary">Fixture</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-blue-400" />
              <span className="text-[11px] text-text-secondary">Availability slot</span>
            </div>
          </div>

          {/* Calendar */}
          <CalendarGrid
            year={year} month={month} selectedDay={selectedDay}
            eventsByDate={eventsByDate} todayStr={todayStr}
            onSelectDay={(d) => setSelectedDay(d === selectedDay ? null : d)}
          />

          {/* Divider */}
          <div className="border-t border-border my-5" />

          {/* Day events */}
          <div>
            <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
              {selectedDay ? `${MONTH_NAMES[month]} ${selectedDay}` : "Select a day"}
            </h3>
            {!selectedDay ? (
              <p className="text-sm text-text-secondary">Tap any date to see events.</p>
            ) : eventsLoading ? (
              <div className="py-4 text-center"><div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" /></div>
            ) : selectedEvents.length === 0 ? (
              <div className="bg-surface-2 border border-border rounded-2xl px-4 py-5 text-center">
                <p className="text-sm text-text-secondary">No events</p>
              </div>
            ) : (
              <div className="space-y-2">
                {selectedEvents.map((e, i) => (
                  <div key={i} className={`bg-surface-2 border rounded-2xl px-4 py-3.5 flex items-center gap-3 ${e.type === "fixture" ? "border-accent/30" : "border-blue-400/30"}`}>
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${e.type === "fixture" ? "bg-accent" : "bg-blue-400"}`} />
                    <div className="flex-1">
                      <p className="text-sm font-semibold">{e.label}</p>
                      <p className="text-xs text-text-secondary mt-0.5">
                        {e.sublabel ? `${e.sublabel} · ` : ""}{e.type === "fixture" ? "Confirmed fixture" : "Availability slot"}
                      </p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${e.type === "fixture" ? "bg-accent/10 text-accent" : "bg-blue-400/10 text-blue-400"}`}>
                      {e.type === "fixture" ? "Match" : "Avail"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        user && (role === "captain"
          ? <CaptainAvailabilityTab userId={user.id} />
          : <PlayerAvailabilityTab userId={user.id} />)
      )}
    </div>
  );
}
