"use client";

import { useEffect, useState } from "react";
import { authedPost } from "@/lib/authed-fetch";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import TopUpModal from "@/components/TopUpModal";
import { seedAvailabilityFromPoll } from "@/lib/event-availability";

// The challenger's side of a match post: pick one of the poster's pitch
// options, confirm, and both teams are debited their half of the fee (or, for
// a post whose pitch is already paid for, join outright).
//
// Lives here rather than in the Play page so the captain's home feed can open
// the same flow without a second implementation.

export type PitchOption = {
  id: string;
  name: string;
  address: string;
  price: number;
  format: string;
  distance: string;
  // Optional per-pitch kickoff time. Older posts won't have it → fall back to the post time.
  time?: string;
};

export type MatchPost = {
  id: string;
  team_id: string;
  captain_id: string;
  team: string;
  location: string;
  date: string;
  match_date: string;
  match_time: string;
  pitchOptions: PitchOption[];
  description: string;
  availabilityMatch: boolean;
  status: string;
  payment_mode: string;
  pitchSecured: boolean;
  securedBookingId: string | null;
};

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

  const handleConfirm = async () => {
    if (!selectedPitch || !user) return;
    setSaving(true);
    setSlotTakenError(null);
    setShortfall(null);

    // Guard: check post is still open (race condition — someone else may have just taken it)
    const { data: current } = await supabase
      .from("match_posts").select("status").eq("id", post.id).maybeSingle();
    if (current?.status !== "open") {
      setSaving(false);
      setAlreadyTaken(true);
      return;
    }

    // Get challenger's team
    const { data: team } = await supabase
      .from("teams").select("id, name").eq("captain_id", user.id).maybeSingle();
    if (!team) { setSaving(false); return; }

    const pitch = post.pitchOptions.find((p) => p.id === selectedPitch);
    const isSecured = post.payment_mode === "secured";

    // Both credit/individual modes split the pitch fee evenly between the two
    // teams' credit at confirm time — each side is debited their own half
    // directly, no fronting/reimbursement step. A "secured" post already has
    // its pitch paid for via a direct booking, so it skips credit entirely —
    // joining is immediate and players settle their share post-match as usual.
    const feePence = Math.round((pitch?.price ?? 0) * 100);
    const posterHalfPence = Math.ceil(feePence / 2); // poster absorbs the odd penny
    const challengerHalfPence = feePence - posterHalfPence;

    if (!isSecured) {
      // Challenger must be able to cover their half.
      const { data: chalCr } = await supabase
        .from("team_credits").select("balance_pence, reserved_pence").eq("team_id", team.id).maybeSingle();
      const chalAvail = (chalCr?.balance_pence ?? 0) - (chalCr?.reserved_pence ?? 0);
      if (chalAvail < challengerHalfPence) {
        setSaving(false);
        setShortfall({
          teamId: team.id,
          shortfallPence: challengerHalfPence - chalAvail,
          balancePence: chalCr?.balance_pence ?? 0,
        });
        setSlotTakenError(
          `Your team needs to top up — £${(challengerHalfPence / 100).toFixed(2)} of available credit covers your half of this pitch, £${((challengerHalfPence - chalAvail) / 100).toFixed(2)} short.`
        );
        return;
      }

      // Poster must be able to cover their half too — no fronting the full fee.
      const { data: postCr } = await supabase
        .from("team_credits").select("balance_pence, reserved_pence").eq("team_id", post.team_id).maybeSingle();
      const postAvail = (postCr?.balance_pence ?? 0) - (postCr?.reserved_pence ?? 0);
      if (postAvail < posterHalfPence) {
        setSaving(false);
        setSlotTakenError(
          `The posting team no longer has enough credit to cover their half of this pitch (£${(posterHalfPence / 100).toFixed(2)} needed). This match can't be confirmed right now.`
        );
        return;
      }
    } else {
      // Secured post: the poster already paid the venue in cash via the direct
      // booking, so only the challenger needs credit — to reimburse their half.
      const { data: chalCr } = await supabase
        .from("team_credits").select("balance_pence, reserved_pence").eq("team_id", team.id).maybeSingle();
      const chalAvail = (chalCr?.balance_pence ?? 0) - (chalCr?.reserved_pence ?? 0);
      if (chalAvail < challengerHalfPence) {
        setSaving(false);
        setShortfall({
          teamId: team.id,
          shortfallPence: challengerHalfPence - chalAvail,
          balancePence: chalCr?.balance_pence ?? 0,
        });
        setSlotTakenError(
          `Your team needs to top up — £${(challengerHalfPence / 100).toFixed(2)} of available credit covers your half of this secured pitch, £${((challengerHalfPence - chalAvail) / 100).toFixed(2)} short.`
        );
        return;
      }
    }

    // Record the challenge (first-come-first-served → immediately accepted)
    await supabase.from("challenges").insert({
      post_id: post.id,
      challenger_team_id: team.id,
      challenger_team_name: team.name,
      challenger_captain_id: user.id,
      selected_pitch: pitch,
      status: "accepted",
    });

    const pitchTime = pitch?.time ?? post.match_time;

    // Final double-booking check: pitch slot may have been taken since panel opened.
    // Secured posts already own their slot via the existing booking — nothing to race.
    if (!isSecured && pitch?.id) {
      const { data: slotConflict } = await supabase
        .from("pitch_bookings")
        .select("id")
        .eq("pitch_id", pitch.id)
        .eq("match_date", post.match_date)
        .eq("start_time", pitchTime)
        .neq("status", "cancelled")
        .maybeSingle();

      if (slotConflict) {
        setPitchAvail((prev) => ({ ...prev, [pitch.id]: false }));
        setSelectedPitch(null);
        setSaving(false);
        setSlotTakenError(`${pitch.name} was just booked by another team. Select a different pitch option.`);
        return;
      }
    }

    // Create a pitch_bookings row so the venue portal calendar shows this booking.
    // Secured posts already have a booking row (the original direct /book reservation)
    // — just update its player count/split rather than creating a duplicate.
    let pitchBookingId: string | null = null;
    if (isSecured && post.securedBookingId) {
      const perPlayerPence = Math.round(feePence / 22);
      await supabase.from("pitch_bookings").update({
        booker_name: `${post.team} vs ${team.name}`,
        player_count: 22,
        per_player_pence: perPlayerPence,
        unitr_fee_pence: Math.round(perPlayerPence * 0.05),
      }).eq("id", post.securedBookingId);
      pitchBookingId = post.securedBookingId;
    } else if (pitch?.id) {
      const perPlayerPence = Math.round((pitch.price * 100) / 22);
      const startTime = pitchTime || "12:00";
      const [h, m] = startTime.split(":").map(Number);
      const endTime = `${String(Math.min((h || 12) + 1, 23)).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}`;
      const { data: bookingRow, error: bookingErr } = await supabase.from("pitch_bookings").insert({
        pitch_id: pitch.id,
        post_id: post.id,
        booked_by: user.id,
        match_date: post.match_date,
        start_time: startTime,
        end_time: endTime,
        booker_name: `${post.team} vs ${team.name}`,
        booking_type: "platform",
        total_price_pence: pitch.price * 100,
        player_count: 22,
        per_player_pence: perPlayerPence,
        unitr_fee_pence: Math.round(perPlayerPence * 0.05),
        status: "confirmed",
      }).select("id").single();
      if (bookingErr) console.error("pitch_bookings insert failed:", bookingErr.message, bookingErr.details);
      else pitchBookingId = bookingRow?.id ?? null;
    }

    // Lock the post
    await supabase.from("match_posts").update({ status: "matched" }).eq("id", post.id);

    // Cancel the posting team's other open posts
    await supabase.from("match_posts")
      .update({ status: "cancelled" }).eq("team_id", post.team_id).eq("status", "open").neq("id", post.id);

    // Create matches record
    if (pitch) {
      const { data: matchRecord } = await supabase.from("matches").insert({
        post_id: post.id,
        posting_team_id: post.team_id,
        challenging_team_id: team.id,
        confirmed_pitch: pitch,
        match_date: post.match_date,
        match_time: pitchTime,
      }).select("id").single();

      if (matchRecord) {
        setMatchId(matchRecord.id);
        const { data: members } = await supabase
          .from("team_members").select("player_id, team_id")
          .in("team_id", [post.team_id, team.id]).eq("status", "approved");

        // Build full player list: approved members + both captains
        const allPlayers: { player_id: string; team_id: string }[] = [
          ...(members ?? []),
          { player_id: post.captain_id, team_id: post.team_id },
          { player_id: user.id, team_id: team.id },
        ].filter((p, i, arr) => arr.findIndex((x) => x.player_id === p.player_id) === i);

        if (allPlayers.length > 0) {
          await supabase.from("match_confirmations").insert(
            allPlayers.map((m) => ({ match_id: matchRecord.id, player_id: m.player_id, team_id: m.team_id, status: "pending" }))
          );

          // If either captain ran a poll that proposed this exact date, it
          // already asked the squad this question — carry the answers over
          // rather than making everyone reply twice. Per team, since each side
          // answered its own poll.
          for (const squadTeamId of [post.team_id, team.id]) {
            await seedAvailabilityFromPoll(supabase, {
              teamId: squadTeamId,
              target: { matchId: matchRecord.id },
              date: post.match_date,
              time: pitchTime,
              playerIds: allPlayers.filter((p) => p.team_id === squadTeamId).map((p) => p.player_id),
            });
          }
        }

        // ── Secure the pitch with team credit (credit/individual modes — PAYMENT_PLAN §10) ──
        // Phase 2: each team's credit is debited its own half directly — no
        // fronting/reimbursement. No per-player replenishment is created here —
        // the squad is still fluid; settlement is deferred to roster-lock (see
        // the match page "Settle" step).
        if (!isSecured) {
          const { error: settleErr } = await supabase.rpc("split_pitch_fee", {
            p_match_id: matchRecord.id,
            p_posting_team: post.team_id,
            p_challenging_team: team.id,
            p_fee_pence: feePence,
          });
          if (settleErr) console.error("split_pitch_fee failed:", settleErr.message);
          // The pitch is paid for the moment both halves leave team credit. Say
          // so on the booking, or the venue portal shows this slot as unpaid
          // forever — nothing else ever writes payment_status after insert.
          else if (pitchBookingId) {
            await supabase.from("pitch_bookings").update({ payment_status: "paid" }).eq("id", pitchBookingId);
          }

          // Release the poster's batch earmark, if any (credit mode placed one at
          // post time). Clear it so it can't be released twice.
          const { data: holdOwner } = await supabase
            .from("match_posts").select("id, hold_pence")
            .eq("team_id", post.team_id).gt("hold_pence", 0).limit(1).maybeSingle();
          if (holdOwner?.hold_pence) {
            await supabase.rpc("release_hold", {
              p_team_id: post.team_id,
              p_amount_pence: holdOwner.hold_pence,
              p_post_id: holdOwner.id,
            });
            await supabase.from("match_posts").update({ hold_pence: 0 }).eq("id", holdOwner.id);
          }
        } else {
          // Secured post: the poster fronted the whole pitch fee via the direct
          // booking. The challenger reimburses their half into the poster's
          // credit now; both teams' players replenish their own share post-match.
          const { error: reimburseErr } = await supabase.rpc("reimburse_secured_pitch", {
            p_match_id: matchRecord.id,
            p_posting_team: post.team_id,
            p_challenging_team: team.id,
            p_fee_pence: feePence,
          });
          if (reimburseErr) console.error("reimburse_secured_pitch failed:", reimburseErr.message);
        }

        // ── Cash side: pay the venue (Stripe Connect, test mode) ──
        // The teams settle the fee between them in credit above; separately,
        // Unitr transfers the full pitch fee out to the venue's connected
        // account. Best-effort — a missing/unconnected venue account or empty
        // test balance must not block match confirmation. Records a
        // venue_transfers row either way so credit↔cash can be reconciled.
        if (pitch?.id) {
          authedPost("/api/connect/venue-transfer", {
            pitchId: pitch.id,
            bookingId: pitchBookingId,
            matchId: matchRecord.id,
            teamId: post.team_id,
            amountPence: feePence,
          }).catch(() => {});
        }
      }
    }

    setSaving(false);
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
                  £{(((post.pitchOptions.find((p) => p.id === selectedPitch)?.price ?? 80) / 2) * 1.05).toFixed(2)} charged from the team credit when you send challenge.
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

