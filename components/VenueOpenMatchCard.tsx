"use client";

// Venue-side rendering of an open match / tournament / league listing.
// Mirrors the player portal's OpenMatchCard (team-slot circles + footer) but
// swaps the "Join" CTA for venue management actions (joined count + cancel).

export type VenueOpenMatch = {
  id: string;
  pitch_id: string;
  pitch_name: string;
  venue_address: string | null;
  match_date: string;
  start_time: string;
  end_time: string;
  title: string;
  match_type: string;
  format: string | null;
  skill_level: string;
  price_per_team_pence: number;
  max_teams: number;
  status: string;
  joinedTeams: { team_id: string; team_name: string }[];
};

function fmtHeader(iso: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return `${iso} | ${time}`;
  const d = new Date(iso + "T12:00:00");
  return `${d.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long" })} | ${time}`;
}

function duration(start: string, end: string): string {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) return "";
  return mins % 60 === 0 ? `${mins / 60}hr` : `${mins}min`;
}

function initials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

export default function VenueOpenMatchCard({ match, onCancel }: {
  match: VenueOpenMatch;
  onCancel?: (m: VenueOpenMatch) => void;
}) {
  const cancelled = match.status === "cancelled";
  const spotsLeft = Math.max(0, match.max_teams - match.joinedTeams.length);
  const full = spotsLeft === 0;
  const teamWord = match.match_type === "league" ? "registered" : "joined";

  return (
    <div className={`bg-surface-2 border rounded-2xl overflow-hidden ${cancelled ? "border-border opacity-60" : "border-border"}`}>
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <p className="text-sm font-bold truncate">{match.title}</p>
            <p className="text-sm font-semibold text-text-secondary">{fmtHeader(match.match_date, match.start_time)}</p>
          </div>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
            cancelled ? "bg-red-500/10 text-red-400" : full ? "bg-accent/10 text-accent" : "bg-surface text-text-secondary border border-border"
          }`}>
            {cancelled ? "Cancelled" : full ? "Full" : "Open"}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs text-text-secondary mb-4 flex-wrap">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          <span className="capitalize">{match.skill_level}</span>
          {match.format && <><span className="w-1 h-1 rounded-full bg-border" /><span>{match.format}</span></>}
          <span className="w-1 h-1 rounded-full bg-border" /><span className="capitalize">{match.match_type}</span>
        </div>

        {/* Team slots */}
        <div className="flex items-start gap-3 flex-wrap">
          {Array.from({ length: match.max_teams }).map((_, i) => {
            const team = match.joinedTeams[i];
            if (team) {
              return (
                <div key={i} className="flex flex-col items-center gap-1.5 w-16">
                  <div className="w-12 h-12 rounded-full bg-accent/15 border border-accent/40 flex items-center justify-center">
                    <span className="text-xs font-bold text-accent">{initials(team.team_name)}</span>
                  </div>
                  <span className="text-[10px] text-text-secondary text-center truncate w-full">{team.team_name}</span>
                </div>
              );
            }
            return (
              <div key={i} className="flex flex-col items-center gap-1.5 w-16">
                <div className="w-12 h-12 rounded-full border border-dashed border-border flex items-center justify-center">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                </div>
                <span className="text-[10px] text-text-secondary text-center">Open</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer: venue + price */}
      <div className="border-t border-border px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            <p className="text-sm font-semibold truncate">{match.pitch_name}</p>
          </div>
          <p className="text-xs text-text-secondary mt-0.5">
            {match.joinedTeams.length}/{match.max_teams} {teamWord}
            {match.venue_address ? ` · ${match.venue_address}` : ""}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-base font-bold text-accent">£{(match.price_per_team_pence / 100).toFixed(2)}</p>
          <p className="text-[10px] text-text-secondary">{duration(match.start_time, match.end_time)} · per team</p>
        </div>
      </div>

      {!cancelled && onCancel && (
        <div className="px-4 pb-4">
          <button onClick={() => onCancel(match)}
            className="w-full py-2 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 text-sm font-semibold">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
