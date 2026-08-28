"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import CalendarSheet from "@/components/CalendarSheet";
import FixtureDetailSheet, { type ViewerTeam } from "@/components/FixtureDetailSheet";
import {
  KIND_LABEL, KIND_STYLE, loadCalendarEntries,
  type CalendarEntry, type EntryKind,
} from "@/lib/calendar-entries";
import { fmtKickoff } from "@/lib/match-dates";
import AvailabilityButtons from "@/components/AvailabilityButtons";

// The Calendar owns every commitment the viewer has, upcoming and past. It
// replaced the Play page, whose discovery feed the home screen had already
// absorbed (components/GameFeed.tsx) — what was missing was the other half of
// the question: not "what could I join" but "what am I actually in".
//
// Upcoming always comes first, then Past. Both sections stay on screen even when
// empty so the page has a fixed shape and nothing appears to vanish when a
// filter narrows the list.

type Filter = "all" | EntryKind;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "friendly", label: "Friendlies" },
  { key: "tournament", label: "Tournaments" },
  { key: "my_post", label: "Your posts" },
  { key: "ringer", label: "Ringer" },
  { key: "booking", label: "Pitch bookings" },
];

function isFilter(v: string | null): v is Filter {
  return v != null && FILTERS.some((f) => f.key === v);
}

function fmtDay(dateKey: string): string {
  const d = new Date(`${dateKey}T12:00:00`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

// ── Card ──────────────────────────────────────────────────────────────
// The card body is a button and the availability row contains buttons, and
// buttons cannot nest — so the outer element is a div and the tappable region
// is an inner button that fills it. Making the whole card one button (as it was
// before availability landed here) is what forces that split.
function EntryCard({ entry, viewerId, teamId, onOpen }: {
  entry: CalendarEntry;
  viewerId: string | null;
  teamId: string | null;
  onOpen: (e: CalendarEntry) => void;
}) {
  const style = KIND_STYLE[entry.kind];
  // Only confirmed friendlies have a matches row to hang a confirmation off.
  // Tournaments, bookings and ringer entries carry matchId: null.
  const canRespond =
    entry.isUpcoming && entry.kind === "friendly" && entry.matchId && viewerId && teamId;

  return (
    <div className={`bg-surface border border-border border-l-4 ${style.rule} shadow-card rounded-card px-4 py-3.5 ${entry.isUpcoming ? "" : "opacity-85"}`}>
    <button type="button" onClick={() => onOpen(entry)} className="w-full text-left">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <span className={`inline-block text-[10px] font-bold uppercase tracking-[0.08em] px-2.5 py-0.5 rounded-full border mb-1.5 ${style.bg} ${style.text} ${style.border}`}>
            {KIND_LABEL[entry.kind]}
          </span>
          <p className="text-[15px] font-bold truncate">{entry.title}</p>
          {entry.subtitle && <p className="text-xs font-medium text-text-secondary truncate mt-0.5">{entry.subtitle}</p>}
        </div>
        {entry.badge && (
          <span className="text-[10px] font-semibold text-text-secondary bg-background border border-border px-2.5 py-0.5 rounded-full flex-shrink-0">
            {entry.badge}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs font-medium text-text-secondary">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
        {fmtKickoff(entry.date, entry.time)}
      </div>
      {entry.pitch && (
        <div className="flex items-center gap-2 text-xs text-text-secondary mt-0.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          <span className="truncate">{entry.pitch}</span>
        </div>
      )}
    </button>

    {canRespond && (
      <div className="mt-3 pt-3 border-t border-border">
        <AvailabilityButtons
          matchId={entry.matchId!}
          playerId={viewerId!}
          teamId={teamId!}
          size="sm"
        />
      </div>
    )}
    </div>
  );
}

// ── Filter dropdown ───────────────────────────────────────────────────
// A dropdown rather than a chip row: six categories don't fit across a phone
// without horizontal scrolling, which hides options behind a gesture. Collapsed
// it also states the active filter in words instead of by highlight.
function FilterMenu({ options, value, onChange }: {
  options: { key: Filter; label: string }[];
  value: Filter;
  onChange: (f: Filter) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const active = options.find((o) => o.key === value) ?? options[0];

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox" aria-expanded={open}
        className={`flex items-center gap-2 px-4 py-2.5 rounded-btn text-sm font-bold border transition-colors ${
          value === "all"
            ? "bg-surface text-text-primary border-border"
            : "bg-accent text-white border-accent"
        }`}>
        {active.label}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
          className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        // z-50 — above the page but below the z-[60] sheets, so opening the
        // month picker or a fixture always covers a menu left hanging open.
        <div role="listbox"
          className="absolute left-0 top-full mt-2 z-50 min-w-[190px] bg-surface border border-border rounded-card shadow-xl overflow-hidden">
          {options.map((o) => {
            const selected = o.key === value;
            return (
              <button key={o.key} type="button" role="option" aria-selected={selected}
                onClick={() => { onChange(o.key); setOpen(false); }}
                className={`w-full flex items-center justify-between gap-4 px-4 py-3 text-sm text-left transition-colors hover:bg-background border-b border-border last:border-b-0 ${
                  selected ? "font-bold text-accent-ink" : "font-medium text-text-primary"
                }`}>
                {o.label}
                {selected && (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Section({ title, entries, empty, viewerId, teamId, onOpen }: {
  title: string; entries: CalendarEntry[]; empty: string;
  viewerId: string | null; teamId: string | null;
  onOpen: (e: CalendarEntry) => void;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-[15px] font-extrabold">{title}</h2>
        {entries.length > 0 && (
          <span className="text-[11px] font-semibold text-text-secondary bg-surface-2 px-2.5 py-0.5 rounded-full">
            {entries.length}
          </span>
        )}
      </div>
      {entries.length === 0 ? (
        <div className="bg-surface border border-border shadow-card rounded-card px-4 py-6 text-center">
          <p className="text-[13px] font-medium text-text-secondary">{empty}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((e) => (
            <EntryCard key={e.key} entry={e} viewerId={viewerId} teamId={teamId} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [isCaptain, setIsCaptain] = useState(false);
  const [team, setTeam] = useState<ViewerTeam>(null);
  // The viewer's own team, captain or not — availability is answered by every
  // squad member, so this can't reuse the captain-only `team` above.
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [filter, setFilter] = useState<Filter>("all");
  const [dateKey, setDateKey] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [detail, setDetail] = useState<CalendarEntry | null>(null);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    const { entries: rows, teamId, isCaptain: captain } = await loadCalendarEntries(user.id);
    setEntries(rows);
    setIsCaptain(captain);
    setMyTeamId(teamId);

    // Only a captain can post, so only a captain's team is worth resolving here
    // — it's what "Turn into Match Post" writes the post against.
    if (captain && teamId) {
      const { data } = await supabase.from("teams").select("id, name, location").eq("id", teamId).maybeSingle();
      setTeam(data ? { id: data.id, name: data.name, location: data.location ?? "" } : null);
    } else {
      setTeam(null);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Deep links — /calendar?filter=tournaments after hosting one, ?date=… from a
  // notification pointing at a specific day.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const f = params.get("filter");
    if (isFilter(f)) setFilter(f);
    const d = params.get("date");
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setDateKey(d);
  }, []);

  // Someone who isn't a captain has no posts to filter to, so the option would
  // only ever resolve to an empty list.
  const filters = useMemo(() => FILTERS.filter((f) => f.key !== "my_post" || isCaptain), [isCaptain]);

  // ?filter=my_post is readable by anyone. Roles resolve after that link is
  // applied, so drop back to All once we know the option isn't on offer —
  // otherwise the menu reads "All" while the list stays filtered to nothing.
  useEffect(() => {
    if (!filters.some((f) => f.key === filter)) setFilter("all");
  }, [filters, filter]);

  const visible = useMemo(() => entries.filter((e) =>
    (filter === "all" || e.kind === filter) && (!dateKey || e.date === dateKey)
  ), [entries, filter, dateKey]);

  const upcoming = visible.filter((e) => e.isUpcoming);
  const past = visible.filter((e) => !e.isUpcoming);

  if (!user) {
    return (
      <div className="flex flex-col min-h-screen px-4 pt-16 pb-24">
        <header className="mb-5">
          <h1 className="text-2xl font-extrabold mb-1">Calendar</h1>
          <p className="text-text-secondary text-sm">Your fixtures, tournaments and bookings</p>
        </header>
        <div className="bg-surface border border-border shadow-card rounded-card px-4 py-12 text-center">
          <p className="text-sm font-semibold mb-1">Sign in to see your calendar</p>
          <p className="text-xs text-text-secondary mb-4">Everything you&apos;re booked into lives here.</p>
          <a href="/login" className="inline-block px-6 py-2.5 rounded-btn bg-accent text-white font-bold text-sm">Sign In</a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-24">
      <header className="mb-5">
        <h1 className="text-2xl font-extrabold mb-1">Calendar</h1>
        <p className="text-text-secondary text-[13px] font-medium">Your fixtures, tournaments and bookings</p>
      </header>

      {/* Filter dropdown + the date-picker pill */}
      <div className="flex items-start justify-between gap-2 mb-4">
        <FilterMenu options={filters} value={filter} onChange={setFilter} />
        <button type="button" onClick={() => setSheetOpen(true)} aria-label="Open calendar"
          className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2.5 rounded-btn text-[13px] font-semibold border ${
            dateKey ? "bg-success-bg text-accent-ink border-success-border" : "bg-surface text-text-secondary border-border"
          }`}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          Calendar
        </button>
      </div>

      {dateKey && (
        <button type="button" onClick={() => setDateKey(null)}
          className="self-start flex items-center gap-2 mb-4 px-3 py-1.5 rounded-full bg-success-bg border border-success-border text-xs font-semibold text-accent-ink">
          Showing {fmtDay(dateKey)}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>
      ) : entries.length === 0 ? (
        <div className="bg-surface border border-border shadow-card rounded-card px-4 py-12 text-center">
          <p className="text-sm font-semibold mb-1">Nothing in your calendar yet</p>
          <p className="text-xs text-text-secondary mb-4">
            Confirmed matches, tournaments, ringer games and pitch bookings all show up here.
          </p>
          <a href="/" className="inline-block px-6 py-2.5 rounded-btn bg-accent text-white font-bold text-sm">Find a game</a>
        </div>
      ) : (
        <div className="space-y-6">
          <Section title="Upcoming" entries={upcoming} onOpen={setDetail}
            viewerId={user?.id ?? null} teamId={myTeamId}
            empty={dateKey ? "Nothing coming up on this date." : "Nothing coming up."} />
          <Section title="Past" entries={past} onOpen={setDetail}
            viewerId={user?.id ?? null} teamId={myTeamId}
            empty={dateKey ? "Nothing played on this date." : "Nothing played yet."} />
        </div>
      )}

      {sheetOpen && (
        <CalendarSheet entries={entries} selected={dateKey}
          onSelect={setDateKey} onClose={() => setSheetOpen(false)} />
      )}

      {detail && (
        <FixtureDetailSheet entry={detail} isCaptain={isCaptain} team={team}
          viewerId={user?.id ?? null} viewerTeamId={myTeamId}
          onClose={() => setDetail(null)} onChanged={load} />
      )}
    </div>
  );
}
