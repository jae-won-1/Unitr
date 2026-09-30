"use client";

import { useEffect, useState } from "react";
import { authedPost } from "@/lib/authed-fetch";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import TopUpModal from "@/components/TopUpModal";
import { loadLedTeam } from "@/lib/team-leadership";
import { UNITER_FEE_RATE } from "@/lib/uniter-fee";

// The challenger's side of a match post: pick one of the poster's pitch
// options, confirm, and both teams are debited their half of the fee (or, for
// a post whose pitch is already paid for, join outright).
//
// Lives here rather than in the Play page so the captain's home feed can open
// the same flow without a second implementation.

// These types moved to lib/game-feed.ts, which is where the queries that
// produce them now live, so the mobile app can share both. Re-exported here
// because a dozen call sites import them from this component.
export type { MatchPost, PitchOption } from "@/lib/game-feed";
import type { MatchPost, PitchOption } from "@/lib/game-feed";

// ── Challenge Panel ───────────────────────────────────────────
export default function ChallengePanel({
  post,
  onClose,
  onMatched,
}: {
  post: MatchPost;
  onClose: () => void;
  onMatched: (postId: string) => void;
}) {
  const { user } = useAuth();
  const [selectedPitch, setSelectedPitch] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [alreadyTaken, setAlreadyTaken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pitchAvail, setPitchAvail] = useState<Record<string, boolean>>({});
  const [checkingAvail, setCheckingAvail] = useState(true);
  const [slotTakenError, setSlotTakenError] = useState<string | null>(null);
  // Set when the challenger's own credit is what's blocking the join, so the
  // shortfall can be topped up here instead of abandoning the challenge. Only
  // ever the viewer's own team — a poster's shortfall isn't theirs to fix.
  const [shortfall, setShortfall] = useState<{ teamId: string; shortfallPence: number; balancePence: number } | null>(null);
  const [topUpOpen, setTopUpOpen] = useState(false);

  // Check which pitch options are still available for this date/time
  useEffect(() => {
    async function checkAvailability() {
      // A secured post already owns its pitch booking for this exact slot — that
      // booking IS the reserved pitch both teams will play on, not a conflict.
      // Treat it as available so the challenger can join.
      if (post.pitchSecured) {
        setPitchAvail(Object.fromEntries(post.pitchOptions.map((p) => [p.id, true])));
        setCheckingAvail(false);
        return;
      }
      const result: Record<string, boolean> = {};
      await Promise.all(
        post.pitchOptions.map(async (pitch) => {
          const { data } = await supabase
            .from("pitch_bookings")
            .select("id")
            .eq("pitch_id", pitch.id)
            .eq("match_date", post.match_date)
            .eq("start_time", pitch.time ?? post.match_time)
            .neq("status", "cancelled")
            .maybeSingle();
          result[pitch.id] = !data;
        })
      );
      setPitchAvail(result);
      setCheckingAvail(false);
    }
    checkAvailability();
  }, [post]);

  const allPitchesTaken = !checkingAvail && post.pitchOptions.length > 0 &&
    post.pitchOptions.every((p) => pitchAvail[p.id] === false);

  // The accept runs server-side (/api/challenges/accept): claiming the post,
  // the challenge, match, booking and squad rows, and both teams' halves of
  // the pitch fee. It used to run here, calling the ledger functions straight
  // from the browser — see that route for why it can't. What stays here is the
  // venue payout, which is its own authed, capped route.
  const handleConfirm = async () => {
    if (!selectedPitch || !user) return;
    setSaving(true);
    setSlotTakenError(null);
    setShortfall(null);

    // Captain or co-captain — either can accept a game for the team.
    const team = await loadLedTeam<{ id: string; name: string; captain_id: string }>(
      user.id, "id, name, captain_id",
    );
    if (!team) { setSaving(false); return; }

    let data: {
      code?: string; error?: string; shortfallPence?: number; halfPence?: number; balancePence?: number;
      matchId?: string; pitchBookingId?: string | null; feePence?: number; pitchId?: string | null;
    } = {};
    try {
      const res = await authedPost("/api/challenges/accept", { postId: post.id, pitchOptionId: selectedPitch, teamId: team.id });
      data = await res.json();
    } catch {
      setSaving(false);
      setSlotTakenError("Couldn't reach Uniter. Nothing was charged — try again.");
      return;
    }
    setSaving(false);

    if (!data.matchId) {
      if (data.code === "TAKEN") { setAlreadyTaken(true); return; }
      if (data.code === "SLOT_TAKEN") {
        setPitchAvail((prev) => ({ ...prev, [selectedPitch]: false }));
        setSelectedPitch(null);
      }
      if (data.code === "SHORTFALL" && data.shortfallPence != null && data.halfPence != null) {
        setShortfall({ teamId: team.id, shortfallPence: data.shortfallPence, balancePence: data.balancePence ?? 0 });
        setSlotTakenError(
          `Your team needs to top up — £${(data.halfPence / 100).toFixed(2)} of available credit covers your half of this ${post.payment_mode === "secured" ? "secured " : ""}pitch, £${(data.shortfallPence / 100).toFixed(2)} short.`
        );
        return;
      }
      setSlotTakenError(data.error ?? "Couldn't accept this match. Nothing was charged.");
      return;
    }

    setMatchId(data.matchId);

    // ── Cash side: pay the venue (Stripe Connect, test mode) ──
    // The teams settled the fee between them in credit on the server; separately,
    // Uniter transfers the full pitch fee out to the venue's connected
    // account. Best-effort — a missing/unconnected venue account or empty
    // test balance must not block match confirmation. Records a
    // venue_transfers row either way so credit↔cash can be reconciled.
    if (data.pitchId) {
      authedPost("/api/connect/venue-transfer", {
        pitchId: data.pitchId,
        bookingId: data.pitchBookingId ?? null,
        matchId: data.matchId,
        teamId: post.team_id,
        amountPence: data.feePence,
      }).catch(() => {});
    }

    setConfirmed(true);
    onMatched(post.id);
  };

  const confirmedPitch = post.pitchOptions.find((p) => p.id === selectedPitch);

  if (allPitchesTaken) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim">
        <div className="w-full max-w-lg bg-surface rounded-t-2xl p-6 text-center">
          <div className="w-16 h-16 rounded-full bg-yellow-500/20 border border-yellow-500/30 flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" strokeWidth="2.5" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <p className="text-lg font-bold mb-1">No Pitches Available</p>
          <p className="text-sm text-text-secondary mb-5">All pitch options for this match have been booked. The posting team needs to update their pitch selection before this match can be challenged.</p>
          <button onClick={onClose} className="w-full py-3 rounded-xl bg-surface-2 border border-border text-text-primary font-bold text-sm">Back to Matches</button>
        </div>
      </div>
    );
  }

  if (alreadyTaken) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim">
        <div className="w-full max-w-lg bg-surface rounded-t-2xl p-6 text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </div>
          <p className="text-lg font-bold mb-1">Already Taken</p>
          <p className="text-sm text-text-secondary mb-5">Another team challenged this post just before you. Check back for other open matches.</p>
          <button onClick={onClose} className="w-full py-3 rounded-xl bg-surface-2 border border-border text-text-primary font-bold text-sm">Back to Matches</button>
        </div>
      </div>
    );
  }

  if (confirmed) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim">
        <div className="w-full max-w-lg bg-surface rounded-t-2xl p-6 text-center">
          <div className="w-16 h-16 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <p className="text-lg font-bold mb-1">Match Confirmed!</p>
          <p className="text-sm text-text-secondary mb-1">
            You&apos;re playing <span className="text-text-primary font-semibold">{post.team}</span>
          </p>
          <p className="text-xs text-text-secondary mb-1">{post.date}</p>
          <p className="text-xs text-text-secondary mb-4">
            Venue: <span className="text-text-primary font-medium">{confirmedPitch?.name}</span>
          </p>
          <div className="bg-surface border border-border rounded-btn p-3 mb-5 text-left">
            <p className="text-xs text-text-secondary">
              Payment of{" "}
              <span className="font-semibold text-text-primary">
                £{((confirmedPitch?.price ?? 80) / 22).toFixed(2)}/player
              </span>{" "}
              will be taken automatically in{" "}
              <span className="font-semibold text-accent-ink">3 hours</span>. Non-refundable after payment.
            </p>
          </div>
          {matchId && (
            <a href={`/my-team/match/${matchId}`}
              className="w-full py-3 rounded-xl bg-surface-2 border border-border text-sm font-semibold text-center block mb-2">
              View Match Details
            </a>
          )}
          <button onClick={onClose} className="w-full py-3 rounded-btn bg-accent text-white font-bold text-sm">Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim" onClick={onClose}>
      <div className="w-full max-w-lg bg-surface rounded-t-2xl flex flex-col max-h-[85dvh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>

        <div className="px-5 pt-1 pb-4 overflow-y-auto flex-1">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="font-bold">Challenge {post.team}</p>
              <p className="text-xs text-text-secondary">{post.date}</p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>

          <p className="text-sm font-semibold mb-2">Select a pitch</p>
          <p className="text-xs text-text-secondary mb-3">
            Choose from the posting team&apos;s preferred pitches for {post.date}.
          </p>

          {slotTakenError && (shortfall ? (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3 py-2.5 mb-3 flex items-center gap-3">
              <p className="text-[11px] text-yellow-600 flex-1">{slotTakenError}</p>
              <button onClick={() => setTopUpOpen(true)}
                className="shrink-0 px-3 py-2 rounded-btn bg-accent text-white font-bold text-xs">Top up now</button>
            </div>
          ) : (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5 mb-3">
              <p className="text-xs text-red-600">{slotTakenError}</p>
            </div>
          ))}

          {/* Top up mid-challenge — this panel stays mounted behind it so the
              captain lands back on the pitch list with the new balance. */}
          {topUpOpen && shortfall && user && (
            <div onClick={(e) => e.stopPropagation()}>
              <TopUpModal
                teamId={shortfall.teamId}
                userId={user.id}
                currentPence={shortfall.balancePence}
                suggestedPence={shortfall.shortfallPence}
                onClose={() => setTopUpOpen(false)}
                onSuccess={() => { setTopUpOpen(false); setShortfall(null); setSlotTakenError(null); }}
              />
            </div>
          )}

          {checkingAvail ? (
            <div className="flex items-center justify-center gap-2 py-6 mb-4 bg-surface border border-border rounded-btn">
              <div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
              <span className="text-xs text-text-secondary">Checking availability…</span>
            </div>
          ) : (
            <div className="space-y-2 mb-4">
              {post.pitchOptions.map((pitch, i) => {
                const isBooked = pitchAvail[pitch.id] === false;
                return (
                  <button key={pitch.id}
                    disabled={isBooked}
                    onClick={() => { if (!isBooked) { setSelectedPitch(pitch.id); setSlotTakenError(null); } }}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                      isBooked ? "bg-surface-2 border-border opacity-50 cursor-not-allowed" :
                      selectedPitch === pitch.id ? "bg-accent/10 border-accent/60" : "bg-surface-2 border-border"
                    }`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                      isBooked ? "bg-background text-text-secondary" :
                      selectedPitch === pitch.id ? "bg-accent text-white" : "bg-background text-text-secondary"
                    }`}>
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold truncate ${isBooked ? "line-through text-text-secondary" : ""}`}>{pitch.name}</p>
                      <p className="text-xs text-text-secondary">KO {pitch.time ?? post.match_time} · {pitch.format} · £{pitch.price}/hr</p>
                    </div>
                    {isBooked
                      ? <span className="text-[10px] font-semibold text-red-600 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full flex-shrink-0">Taken</span>
                      : i === 0
                      ? <span className="text-[10px] font-semibold text-accent-ink bg-accent/10 px-2 py-0.5 rounded-full flex-shrink-0">Preferred</span>
                      : <span className="text-[10px] text-text-secondary flex-shrink-0">Backup {i}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {selectedPitch && (
            <div className="bg-surface border border-border rounded-btn p-3 text-xs text-text-secondary">
              <p className="font-semibold text-text-primary mb-1">Payment</p>
              {post.pitchSecured ? (
                <p>
                  This pitch is already booked & paid by {post.team}. On joining, your team credit is charged{" "}
                  <span className="text-accent-ink font-semibold">
                    £{(Math.floor((post.pitchOptions.find((p) => p.id === selectedPitch)?.price ?? 80) * 100 / 2) / 100).toFixed(2)}
                  </span>{" "}
                  — your half of the fee — to reimburse them. Players top up their share post-match.
                </p>
              ) : (
                <p>
                  £{(((post.pitchOptions.find((p) => p.id === selectedPitch)?.price ?? 80) / 2) * (1 + UNITER_FEE_RATE)).toFixed(2)} charged from the team credit when you send challenge.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="px-5 pb-6 pt-3 flex-shrink-0 border-t border-border bg-surface">
          <button
            disabled={!selectedPitch || saving || checkingAvail}
            onClick={handleConfirm}
            className="w-full py-3 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? (
              <><svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Confirming…</>
            ) : "Send Challenge"}
          </button>
        </div>
      </div>
    </div>
  );
}

