"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { KIND_LABEL, KIND_STYLE, type CalendarEntry } from "@/lib/calendar-entries";
import { fmtKickoff } from "@/lib/match-dates";

// What opens when you tap anything on the Calendar. Basic detail for everyone;
// the management CTA appears only for the person entitled to it.
//
// Nothing here re-implements a management screen — /my-team/match/[matchId] is
// already a full manage surface (overview / squad / payment / tactics / result)
// and /play/tournament/[id] owns schedules and referees. This sheet is the door
// to them, plus the one action that had nowhere else to live once the Play page
// went away: turning a direct pitch booking into a secured match post.

export type ViewerTeam = { id: string; name: string; location: string } | null;

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
        format: pitch?.formats?.[0] ?? "5-a-side",
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
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button onClick={handlePost} disabled={saving}
        className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-40">
        {saving ? "Posting…" : "Post Match (Pitch Secured)"}
      </button>
    </div>
  );
}

// ── Take down an open post ────────────────────────────────────────────
function TakeDownButton({ entry, onRemoved }: { entry: CalendarEntry; onRemoved: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const handle = async () => {
    setBusy(true);
    await supabase.from("match_posts").update({ status: "cancelled" }).eq("id", entry.id);
    // The booking goes back to being a plain booking, so it can be posted again.
    await supabase.from("pitch_bookings").update({ post_id: null }).eq("post_id", entry.id);
    setBusy(false);
    onRemoved();
  };

  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)}
        className="w-full py-2.5 rounded-xl border border-red-500/30 text-red-400 text-sm font-semibold">
        Take Down Post
      </button>
    );
  }

  return (
    <div className="bg-surface-2 border border-border rounded-xl p-3">
      <p className="text-xs text-text-secondary mb-3">
        Your post will no longer be visible to other teams. This can&apos;t be undone.
      </p>
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
export default function FixtureDetailSheet({ entry, isCaptain, team, onClose, onChanged }: {
  entry: CalendarEntry;
  isCaptain: boolean;
  team: ViewerTeam;
  onClose: () => void;
  /** Something was written — the page reloads rather than patching state. */
  onChanged: () => void;
}) {
  const [postingBooking, setPostingBooking] = useState(false);
  const style = KIND_STYLE[entry.kind];

  const rows: { label: string; value: string }[] = [
    { label: "When", value: fmtKickoff(entry.date, entry.time) },
    ...(entry.pitch ? [{ label: "Pitch", value: entry.pitch }] : []),
    ...(entry.address ? [{ label: "Address", value: entry.address }] : []),
    ...(entry.pricePence != null ? [{ label: entry.kind === "ringer" ? "You paid" : "Fee", value: `£${(entry.pricePence / 100).toFixed(2)}` }] : []),
    ...(entry.badge ? [{ label: "Status", value: entry.badge }] : []),
  ];

  // Who gets to act, and on what.
  const canManageMatch = isCaptain && entry.kind === "friendly" && entry.matchId;
  const needsResult = canManageMatch && !entry.isUpcoming && !entry.resultVerified;

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-lg bg-[#141414] rounded-t-2xl md:rounded-2xl max-h-[88vh] overflow-y-auto"
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
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>

          <div className="bg-surface-2 border border-border rounded-xl p-4 space-y-2">
            {rows.map((r) => (
              <div key={r.label} className="flex items-start justify-between gap-3 text-xs">
                <span className="text-text-secondary flex-shrink-0">{r.label}</span>
                <span className="font-semibold text-right">{r.value}</span>
              </div>
            ))}
          </div>

          {/* ── Actions ── */}
          {entry.kind === "friendly" && (
            <div className="space-y-2">
              {needsResult && (
                <a href={`/my-team/match/${entry.matchId}/result`}
                  className="block w-full py-3 rounded-xl bg-red-500 text-white font-bold text-sm text-center">
                  Submit Result
                </a>
              )}
              {canManageMatch ? (
                <a href={`/my-team/match/${entry.matchId}`}
                  className="block w-full py-3 rounded-xl bg-accent text-black font-bold text-sm text-center">
                  Manage match
                </a>
              ) : entry.matchId ? (
                <a href={`/my-team/match/${entry.matchId}`}
                  className="block w-full py-3 rounded-xl border border-border text-sm font-semibold text-text-secondary text-center">
                  View match details
                </a>
              ) : (
                <p className="text-xs text-text-secondary text-center">
                  This fixture has no match record yet — details appear once both captains confirm.
                </p>
              )}
            </div>
          )}

          {entry.kind === "tournament" && (
            <a href={`/play/tournament/${entry.id}`}
              className={`block w-full py-3 rounded-xl font-bold text-sm text-center ${
                isCaptain ? "bg-accent text-black" : "border border-border text-text-secondary font-semibold"
              }`}>
              {isCaptain ? "Manage schedule & referees" : "View schedule & referees"}
            </a>
          )}

          {entry.kind === "my_post" && (
            <div className="space-y-2">
              <a href={`/play/edit/${entry.id}`}
                className="block w-full py-3 rounded-xl bg-accent text-black font-bold text-sm text-center">
                View / edit post
              </a>
              <TakeDownButton entry={entry} onRemoved={() => { onChanged(); onClose(); }} />
            </div>
          )}

          {entry.kind === "ringer" && entry.matchId && (
            <a href={`/my-team/match/${entry.matchId}`}
              className="block w-full py-3 rounded-xl border border-border text-sm font-semibold text-text-secondary text-center">
              View match details
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
                className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm">
                Turn into Match Post
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
