"use client";

import { useEffect, useState, useMemo } from "react";
import { useRole } from "@/contexts/RoleContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

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

// ── Page ──────────────────────────────────────────────────────
export default function CalendarPage() {
  const { user } = useAuth();
  const { role, roleLoading } = useRole();
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

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
    </div>
  );
}
