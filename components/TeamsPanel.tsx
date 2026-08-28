"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import SignUpGate, { GateTarget } from "@/components/SignUpGate";

// Team discovery list, laid out the way Plab lists recruiting teams: one row
// per team, crest on the left, a single grey meta line underneath the name.
// Density comes from that one line — level badges and descriptions are on the
// team's own page, not here.
//
// Named "Teams" rather than "Teams Near You" for now: nothing sorts by distance
// yet because we don't capture the viewer's location at signup. Once we do, the
// Area filter defaults to it and the heading can make the "near you" claim.

type Team = {
  id: string;
  name: string;
  location: string | null;
  level: string | null;
  format: string | null;
  photo_url: string | null;
  members: number;
};

type Sort = "members" | "name";

const COLLAPSED = 5;

// Filter groups Plab shows that our schema has no columns for yet. Rendered so
// the sheet reads as designed, greyed so it can't promise filtering we can't do.
const UNWIRED = [
  { label: "Day", options: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] },
  { label: "Time", options: ["Morning", "Afternoon", "Evening", "Late"] },
  { label: "Gender", options: ["Mixed", "Men", "Women"] },
  { label: "Age", options: ["Under 20", "20s", "30s", "40s", "50+"] },
  { label: "Team traits", options: ["Friendlies", "Cup prep", "Team matching", "Coached", "Social"] },
];

function useTeams() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data: rows } = await supabase
        .from("teams")
        .select("id, name, location, level, format, photo_url");

      // One query for every approved membership, tallied client-side — a count
      // per team would be N round-trips for a list this size. The captain has no
      // team_members row of their own, so every team starts at 1.
      const { data: members } = await supabase
        .from("team_members")
        .select("team_id")
        .eq("status", "approved");

      const tally = new Map<string, number>();
      for (const m of members ?? []) tally.set(m.team_id, (tally.get(m.team_id) ?? 0) + 1);

      setTeams(
        (rows ?? []).map((t) => ({
          ...t,
          members: (tally.get(t.id) ?? 0) + 1,
        })) as Team[]
      );
      setLoading(false);
    }
    load();
  }, []);

  return { teams, loading };
}

function Crest({ team }: { team: Team }) {
  const initials = team.name.split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  if (team.photo_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={team.photo_url} alt="" className="w-11 h-11 rounded-full object-cover flex-shrink-0 bg-surface-2" />;
  }
  return (
    <div className="w-11 h-11 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
      <span className="text-xs font-bold text-accent-ink">{initials}</span>
    </div>
  );
}

// Signed out, the row is a button that raises the sign-up gate instead of a
// link — the team page reads memberships and squad data a guest can't see, so
// intercepting here beats letting them land on a half-empty page.
function TeamRow({ team, onGuestTap }: { team: Team; onGuestTap?: (team: Team) => void }) {
  const meta = [team.location, team.format, `${team.members} member${team.members === 1 ? "" : "s"}`]
    .filter(Boolean)
    .join(" · ");
  const inner = (
    <>
      <Crest team={team} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold truncate">{team.name}</p>
        <p className="text-xs text-text-secondary truncate mt-0.5">{meta}</p>
      </div>
    </>
  );
  const className = "flex items-center gap-3 py-3 w-full text-left";

  if (onGuestTap) {
    return (
      <button type="button" onClick={() => onGuestTap(team)} className={className}>
        {inner}
      </button>
    );
  }
  return <a href={`/my-team/${team.id}`} className={className}>{inner}</a>;
}

function Chip({ label, active, onClick, disabled, caret }: {
  label: string; active?: boolean; onClick?: () => void; disabled?: boolean; caret?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
        active ? "bg-accent text-white border-accent" : "bg-surface-2 text-text-secondary border-border"
      } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
    >
      {label}
      {caret && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      )}
    </button>
  );
}

export default function TeamsPanel() {
  const { user } = useAuth();
  const { teams, loading } = useTeams();
  const [expanded, setExpanded] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [gate, setGate] = useState<GateTarget | null>(null);

  const [area, setArea] = useState<string | null>(null);
  const [format, setFormat] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("members");

  const areas = useMemo(
    () => [...new Set(teams.map((t) => t.location).filter(Boolean) as string[])].sort(),
    [teams]
  );
  const formats = useMemo(
    () => [...new Set(teams.map((t) => t.format).filter(Boolean) as string[])].sort(),
    [teams]
  );
  const levels = useMemo(
    () => [...new Set(teams.map((t) => t.level).filter(Boolean) as string[])].sort(),
    [teams]
  );

  const filtered = useMemo(() => {
    const out = teams.filter(
      (t) =>
        (!area || t.location === area) &&
        (!format || t.format === format) &&
        (!level || t.level === level)
    );
    out.sort((a, b) => (sort === "members" ? b.members - a.members : a.name.localeCompare(b.name)));
    return out;
  }, [teams, area, format, level, sort]);

  const shown = expanded ? filtered : filtered.slice(0, COLLAPSED);
  const activeCount = [area, format, level].filter(Boolean).length;

  // Cycle through the values present in the data rather than opening a menu —
  // the option lists here are short (a handful of areas, three formats).
  const cycle = <T,>(current: T | null, options: T[], set: (v: T | null) => void) => {
    const i = current === null ? -1 : options.indexOf(current);
    set(i + 1 >= options.length ? null : options[i + 1]);
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold">Teams</h3>
        {filtered.length > 0 && (
          <span className="text-xs text-text-secondary">{filtered.length} recruiting</span>
        )}
      </div>

      {/* ── Filter bar ── */}
      <div className="flex items-center gap-2 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Chip label={area ?? "Area"} active={!!area} caret onClick={() => cycle(area, areas, setArea)} />
        <Chip label={format ?? "Format"} active={!!format} caret onClick={() => cycle(format, formats, setFormat)} />
        <Chip
          label={activeCount > 0 ? `Filter (${activeCount})` : "Filter"}
          active={activeCount > 0}
          onClick={() => setSheetOpen(true)}
        />
        <Chip
          label={sort === "members" ? "Most members" : "A–Z"}
          caret
          onClick={() => setSort((s) => (s === "members" ? "name" : "members"))}
        />
      </div>

      {/* ── List ── */}
      {loading ? (
        <div className="flex justify-center py-6">
          <div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-surface border border-border shadow-card rounded-card p-5 text-center">
          <p className="text-sm text-text-secondary">
            {teams.length === 0 ? "No teams registered yet." : "No teams match these filters."}
          </p>
          {teams.length > 0 && (
            <button
              type="button"
              onClick={() => { setArea(null); setFormat(null); setLevel(null); }}
              className="mt-2 text-xs text-accent-ink font-medium"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="bg-surface border border-border shadow-card rounded-card px-4 divide-y divide-border">
          {shown.map((t) => (
            <TeamRow
              key={t.id}
              team={t}
              onGuestTap={user ? undefined : (team) => setGate({
                title: team.name,
                subtitle: [team.location, team.format].filter(Boolean).join(" · ") || undefined,
                unlocks: "see this squad and ask to join",
              })}
            />
          ))}
          {filtered.length > COLLAPSED && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="w-full py-3 flex items-center justify-center gap-1.5 text-xs font-semibold text-text-secondary"
            >
              {expanded ? "See less" : `See more (${filtered.length - COLLAPSED})`}
              <svg
                width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round"
                className={expanded ? "rotate-180" : ""}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          )}
        </div>
      )}

      <SignUpGate target={gate} onClose={() => setGate(null)} />

      {/* ── Filter sheet ── */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim" onClick={() => setSheetOpen(false)}>
          <div
            className="w-full max-w-md bg-surface border-t border-border rounded-t-2xl max-h-[85dvh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <p className="font-bold text-lg">Filter</p>
              <button type="button" onClick={() => setSheetOpen(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-5">
              <div>
                <p className="text-sm font-bold mb-2">Area</p>
                <div className="flex flex-wrap gap-2">
                  {areas.map((a) => (
                    <Chip key={a} label={a} active={area === a} onClick={() => setArea(area === a ? null : a)} />
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm font-bold mb-2">Format</p>
                <div className="flex flex-wrap gap-2">
                  {formats.map((f) => (
                    <Chip key={f} label={f} active={format === f} onClick={() => setFormat(format === f ? null : f)} />
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm font-bold mb-2">Level</p>
                <div className="flex flex-wrap gap-2">
                  {levels.map((l) => (
                    <Chip key={l} label={l} active={level === l} onClick={() => setLevel(level === l ? null : l)} />
                  ))}
                </div>
              </div>

              {UNWIRED.map((group) => (
                <div key={group.label}>
                  <p className="text-sm font-bold mb-2 text-text-secondary">
                    {group.label} <span className="text-[10px] font-medium">· coming soon</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {group.options.map((o) => <Chip key={o} label={o} disabled />)}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 px-5 py-4 border-t border-border">
              <button
                type="button"
                onClick={() => { setArea(null); setFormat(null); setLevel(null); }}
                className="text-sm font-semibold text-text-secondary underline"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="flex-1 py-3 rounded-btn bg-accent text-white text-sm font-bold"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
