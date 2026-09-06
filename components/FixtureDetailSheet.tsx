"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { KIND_LABEL, KIND_STYLE, fixtureAction, type CalendarEntry } from "@/lib/calendar-entries";
import { fmtKickoff } from "@/lib/match-dates";
import { pitchFormatFor } from "@/lib/formations";
import { loadResultScorers, OUTCOME_TEXT, type FixtureResult, type ResultScorer } from "@/lib/match-results";
import AvailabilityButtons from "@/components/AvailabilityButtons";
import TournamentFixtureList from "@/components/TournamentFixtureList";
import { takeDownPost } from "@/lib/take-down-post";

// What opens when you tap anything on the Calendar. Basic detail for everyone;
// the management CTA appears only for the person entitled to it.
//
// Nothing here re-implements a management screen — /my-team/match/[matchId] is
// already a full manage surface (info / attendance / lineup / tactics),
// /my-team/tournament-match/[fixtureId] is the same surface for one game inside
// a tournament, and /play/tournament/[id] owns schedules and referees. This
// sheet is the door to them, plus the one action that had nowhere else to live
// once the Play page went away: turning a booking into a secured match post.

// `format` rides along because a post carries how many a side it is, on the
// pitch option — that's what the lineup board reads once the game is confirmed.
export type ViewerTeam = { id: string; name: string; location: string; format: string | null } | null;

function getDayName(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()];
}

// ── Turn a booking into a match post ──────────────────────────────────
// Moved here verbatim from the retired MyBookingsPanel. The pitch is already
// paid for, so the post is "secured": any team can join with no credit hold,
// and it sorts to the top of the home feed.
function PostBookingForm({ entry, team, onPosted }: {
  entry: CalendarEntry;
  team: NonNullable<ViewerTeam>;
  onPosted: (postId: string) => void;
}) {
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePost = async () => {
    setSaving(true);
    setError(null);

    const { data: booking } = await supabase.from("pitch_bookings")
      .select("id, pitch_id, booked_by, total_price_pence, start_time, match_date")
      .eq("id", entry.id).maybeSingle();
    if (!booking) { setSaving(false); setError("Couldn't find that booking."); return; }

    const { data: pitch } = await supabase.from("pitches")
      .select("name, address, formats").eq("id", booking.pitch_id).maybeSingle();

    const { data: post, error: postErr } = await supabase.from("match_posts").insert({
      team_id: team.id,
      captain_id: booking.booked_by,
      team_name: team.name,
      team_location: team.location ?? "",
      match_date: booking.match_date,
      match_time: booking.start_time,
      day_name: getDayName(booking.match_date),
      pitch_options: [{
        id: booking.pitch_id,
        name: pitch?.name ?? "Pitch",
        address: pitch?.address ?? "",
        price: booking.total_price_pence / 100,
        format: pitchFormatFor(pitch?.formats, team.format),
        distance: "",
        time: booking.start_time,
      }],
      description: description.trim() || null,
      status: "open",
      payment_mode: "secured",
      hold_pence: 0,
      pitch_secured: true,
      secured_booking_id: booking.id,
    }).select("id").single();

    if (postErr) { setSaving(false); setError(postErr.message); return; }

    await supabase.from("pitch_bookings").update({ post_id: post.id }).eq("id", booking.id);
    setSaving(false);
    onPosted(post.id);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-secondary">
        Your pitch is already secured — any team can join straight away, no credit hold needed.
        This post jumps to the top of the match feed.
      </p>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium">Description <span className="text-text-secondary font-normal">(optional)</span></label>
        <input value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="Anything the opponent should know…"
          className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent/50 placeholder:text-text-secondary" />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button onClick={handlePost} disabled={saving}
        className="w-full py-3 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-40">
        {saving ? "Posting…" : "Post Match (Pitch Secured)"}
      </button>
    </div>
  );
}

// ── The score, once someone has filed one ─────────────────────────────
// The sheet is where a played fixture gets read, so it carries the full score
// rather than the card's chip: the result from this team's side, whether it is
// settled or still waiting on the opponent, and who scored.
//
// Scorers are fetched here rather than travelling on the CalendarEntry — a
// scorer list is one extra query per fixture, and the Calendar can be showing
// twenty of them at once while the sheet only ever shows the one that's open.
function ResultBlock({ result, matchId, teamId, opponent }: {
  result: FixtureResult;
  /** Null for anything but a friendly, which is the only kind whose scorers
   *  can be split by the viewer's own team. */
  matchId: string | null;
  teamId: string | null;
  opponent: string;
}) {
  const [scorers, setScorers] = useState<{ mine: ResultScorer[]; theirs: ResultScorer[] } | null>(null);

  useEffect(() => {
    if (!matchId || !teamId) return;
    let live = true;
    loadResultScorers(matchId, teamId).then((s) => { if (live) setScorers(s); });
    return () => { live = false; };
  }, [matchId, teamId]);

  const word = result.outcome === "won" ? "Won" : result.outcome === "lost" ? "Lost" : "Drew";
  const hasScorers = (scorers?.mine.length ?? 0) + (scorers?.theirs.length ?? 0) > 0;

  return (
    <div className="bg-surface border border-border rounded-btn p-4 space-y-3">
      <div className="flex flex-col items-center gap-1">
        <p className={`text-4xl font-extrabold tracking-tighter leading-none ${OUTCOME_TEXT[result.outcome]}`}>
          {result.teamScore} – {result.opponentScore}
        </p>
        <p className="text-[11px] font-semibold text-text-secondary">
          {word} · {result.verified ? "Full time" : "Pending"}
        </p>
      </div>

      {!result.verified && (
        <p className="text-[11px] text-yellow-600 text-center">
          Waiting for {opponent} to submit a matching score.
        </p>
      )}

      {hasScorers && scorers && (
        <div className="border-t border-border pt-3 flex gap-2 text-[11px]">
          <div className="flex-1 space-y-0.5">
            {scorers.mine.map((p) => (
              <p key={p.playerId} className="text-text-secondary">⚽ {p.name}{p.goals > 1 ? ` ×${p.goals}` : ""}</p>
            ))}
          </div>
          <div className="flex-1 space-y-0.5 text-right">
            {scorers.theirs.map((p) => (
              <p key={p.playerId} className="text-text-secondary">{p.name}{p.goals > 1 ? ` ×${p.goals}` : ""} ⚽</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Take down an open post ────────────────────────────────────────────
function TakeDownButton({ entry, onRemoved }: { entry: CalendarEntry; onRemoved: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // /api/posts/take-down owns what a take-down means — releasing the credit
  // earmark, and handing a secured booking back so it can be posted again.
  const handle = async () => {
    setBusy(true);
    setError(null);
    const err = await takeDownPost(entry.id);
    setBusy(false);
    if (err) { setError(err); return; }
    onRemoved();
  };

  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)}
        className="w-full py-2.5 rounded-xl border border-red-500/30 text-red-600 text-sm font-semibold">
        Take Down Post
      </button>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-btn p-3">
      <p className="text-xs text-text-secondary mb-3">
        Your post will no longer be visible to other teams. This can&apos;t be undone.
      </p>
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      <div className="flex gap-2">
        <button onClick={() => setConfirming(false)} disabled={busy}
          className="flex-1 py-2 rounded-xl border border-border text-xs font-semibold disabled:opacity-40">Cancel</button>
        <button onClick={handle} disabled={busy}
          className="flex-1 py-2 rounded-xl bg-red-500 text-white text-xs font-bold disabled:opacity-40">
          {busy ? "Removing…" : "Yes, Take Down"}
        </button>
      </div>
    </div>
  );
}

// ── Sheet ─────────────────────────────────────────────────────────────
export default function FixtureDetailSheet({ entry, isCaptain, team, viewerId, viewerTeamId, onClose, onChanged }: {
  entry: CalendarEntry;
  isCaptain: boolean;
  /** The captain's team — only resolved for captains, since it exists to back "Turn into Match Post". */
  team: ViewerTeam;
  /** The signed-in viewer, captain or not. */
  viewerId: string | null;
  /** The viewer's own team. Distinct from `team`: every squad member answers availability. */
  viewerTeamId: string | null;
  onClose: () => void;
  /** Something was written — the page reloads rather than patching state. */
  onChanged: () => void;
}) {
  const [postingBooking, setPostingBooking] = useState(false);
  const style = KIND_STYLE[entry.kind];
  // The same CTA the calendar card shows, so the two can't name it differently.
  const action = fixtureAction(entry, isCaptain);

  const rows: { label: string; value: string }[] = [
    { label: "When", value: fmtKickoff(entry.date, entry.time) },
    ...(entry.pitch ? [{ label: "Pitch", value: entry.pitch }] : []),
    ...(entry.address ? [{ label: "Address", value: entry.address }] : []),
    ...(entry.pricePence != null ? [{ label: entry.kind === "ringer" ? "You paid" : "Fee", value: `£${(entry.pricePence / 100).toFixed(2)}` }] : []),
    ...(entry.badge ? [{ label: "Status", value: entry.badge }] : []),
  ];

  // Who gets to act, and on what.
  const canManageMatch = isCaptain && entry.kind === "friendly" && entry.matchId;
  // Only asked of a captain who hasn't filed one. A submitted-but-unverified
  // score is the opponent's move to make, not a second job for this captain —
  // the block above already says so.
  const needsResult = canManageMatch && !entry.isUpcoming && !entry.result;

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-scrim" onClick={onClose}>
      <div className="w-full max-w-lg bg-surface rounded-t-2xl md:rounded-2xl max-h-[88dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1 md:hidden"><div className="w-10 h-1 rounded-full bg-border" /></div>

        <div className="px-5 pt-2 md:pt-5 pb-8 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border mb-2 ${style.bg} ${style.text} ${style.border}`}>
                {KIND_LABEL[entry.kind]}
              </span>
              <p className="font-bold truncate">{entry.title}</p>
              {entry.subtitle && <p className="text-xs text-text-secondary mt-0.5">{entry.subtitle}</p>}
            </div>
            <button onClick={onClose} aria-label="Close"
              className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center flex-shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>

          <div className="bg-surface border border-border rounded-btn p-4 space-y-2">
            {rows.map((r) => (
              <div key={r.label} className="flex items-start justify-between gap-3 text-xs">
                <span className="text-text-secondary flex-shrink-0">{r.label}</span>
                <span className="font-semibold text-right">{r.value}</span>
              </div>
            ))}
          </div>

          {entry.result && (
            <ResultBlock
              result={entry.result}
              matchId={entry.kind === "friendly" ? entry.matchId : null}
              teamId={viewerTeamId}
              opponent={entry.title.replace(/^vs /, "")}
            />
          )}

          {/* Availability, for anyone in the squad. A friendly records it
              against its matches row, an entered tournament against its
              open_matches row; nothing else has a record to write to. */}
          {entry.isUpcoming && (entry.matchId || entry.openMatchId)
            && (entry.kind === "friendly" || entry.kind === "tournament")
            && viewerId && viewerTeamId && (
            <div className="bg-surface border border-border rounded-btn p-4">
              <p className="text-xs text-text-secondary mb-2">Your availability</p>
              <AvailabilityButtons
                matchId={entry.matchId}
                openMatchId={entry.openMatchId}
                playerId={viewerId}
                teamId={viewerTeamId}
                onChanged={onChanged}
              />
            </div>
          )}

          {/* ── Actions ── */}
          {entry.kind === "friendly" && (
            <div className="space-y-2">
              {needsResult && (
                <a href={`/my-team/match/${entry.matchId}/result`}
                  className="block w-full py-3 rounded-xl bg-red-500 text-white font-bold text-sm text-center">
                  Submit Result
                </a>
              )}
              {action ? (
                <a href={action.href}
                  className={`block w-full py-3 text-sm text-center ${
                    action.primary
                      ? "rounded-btn bg-accent text-white font-bold"
                      : "rounded-xl border border-border font-semibold text-text-secondary"
                  }`}>
                  {action.label}
                </a>
              ) : (
                <p className="text-xs text-text-secondary text-center">
                  This fixture has no match record yet — details appear once both captains confirm.
                </p>
              )}
            </div>
          )}

          {entry.kind === "tournament" && (
            <div className="space-y-3">
              {/* The tournament is one commitment; the games inside it are
                  several, and each has its own lineup to set or read. Only for
                  a team that entered — openMatchId is exactly that test. */}
              {entry.openMatchId && (
                <TournamentFixtureList
                  openMatchId={entry.openMatchId}
                  teamId={viewerTeamId}
                  isCaptain={isCaptain}
                />
              )}
              {action && (
                <a href={action.href}
                  className={`block w-full py-3 rounded-xl font-bold text-sm text-center ${
                    action.primary ? "bg-accent text-white" : "border border-border text-text-secondary font-semibold"
                  }`}>
                  {action.label}
                </a>
              )}
            </div>
          )}

          {entry.kind === "my_post" && (
            <div className="space-y-2">
              {action && (
                <a href={action.href}
                  className="block w-full py-3 rounded-btn bg-accent text-white font-bold text-sm text-center">
                  {action.label}
                </a>
              )}
              <TakeDownButton entry={entry} onRemoved={() => { onChanged(); onClose(); }} />
            </div>
          )}

          {entry.kind === "ringer" && action && (
            <a href={action.href}
              className="block w-full py-3 rounded-xl border border-border text-sm font-semibold text-text-secondary text-center">
              {action.label}
            </a>
          )}

          {entry.kind === "booking" && (
            entry.postId ? (
              <p className="text-xs text-text-secondary text-center">
                Already posted as a match — it&apos;s under <span className="font-semibold text-text-primary">Your posts</span>.
              </p>
            ) : entry.badge === "Cancelled" || !entry.isUpcoming ? null
            : !team ? (
              <p className="text-xs text-text-secondary text-center">
                Captain a team to turn a booking into a match post.
              </p>
            ) : postingBooking ? (
              <PostBookingForm entry={entry} team={team}
                onPosted={() => { onChanged(); onClose(); }} />
            ) : (
              <button onClick={() => setPostingBooking(true)}
                className="w-full py-3 rounded-btn bg-accent text-white font-bold text-sm">
                Turn into Match Post
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
