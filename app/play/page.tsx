"use client";

import { useState, useEffect } from "react";
import { useRole } from "@/contexts/RoleContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import BookPitchPanel from "@/components/BookPitchPanel";
import MyBookingsPanel from "@/components/MyBookingsPanel";

type MatchTab = "matches" | "tournaments" | "ringer";

type PitchOption = {
  id: string;
  name: string;
  address: string;
  price: number;
  format: string;
  distance: string;
  // Optional per-pitch kickoff time. Older posts won't have it → fall back to the post time.
  time?: string;
};

const ISO_MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};
function isExpired(matchDate: string, matchTime: string): boolean {
  // Compare kickoff and "now" both as Europe/London wall-clock strings so the
  // result never depends on the viewer's device timezone. The stored kickoff is
  // a naive "YYYY-MM-DD" + "HH:mm" with no zone; parsing it via `new Date(...)`
  // would interpret it in the device's local tz — an iPad set to Korea time
  // reads it ~8–9h earlier than a UK laptop and wrongly hides not-yet-started
  // matches as "expired". "sv-SE" yields an ISO-like "YYYY-MM-DD HH:mm:ss" that
  // sorts lexicographically against the kickoff string.
  const kickoff = `${toISODate(matchDate)} ${matchTime.padStart(5, "0")}:00`;
  const nowLondon = new Date().toLocaleString("sv-SE", { timeZone: "Europe/London" });
  return kickoff < nowLondon;
}
function toISODate(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m) {
    const key = m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase();
    if (ISO_MONTHS[key] !== undefined) {
      const d = new Date(Number(m[3]), ISO_MONTHS[key], Number(m[1]));
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
  }
  return raw;
}
// Friendly "Sat, 13 Jun · 16:00" from an ISO (or legacy display) match_date.
function fmtPostDate(matchDate: string, matchTime: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(matchDate)) {
    const d = new Date(matchDate + "T12:00:00");
    return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · ${matchTime}`;
  }
  return `${matchDate} · ${matchTime}`;
}

type MatchPost = {
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

type Tournament = {
  id: string;
  title: string;
  pitch_id: string;
  pitch_name: string;
  venue_address: string | null;
  match_date: string;
  start_time: string;
  end_time: string;
  format: string | null;
  skill_level: string;
  price_per_team_pence: number;
  max_teams: number;
  description: string | null;
  status: string;
  booking_id: string | null;
  // Set when a team (not a venue) hosts the tournament — buy-ins reimburse them.
  organiser_team_id: string | null;
  organiser_team_name: string | null;
  joinedCount: number;
  joinedTeamIds: string[];
  // Pending-invitation discount off the buy-in for the viewing captain's team (0 if none).
  inviteDiscountPence: number;
};

const ringerGames = [
  { id: "r-1", team: "Hackney United", format: "5-a-side", location: "Hackney Marshes", time: "Today, 6:00 PM", spotsNeeded: 2, fullPrice: 12, ringerPrice: 6, level: "Casual", description: "Missing 2 players for our regular weekly game. Come join!" },
  { id: "r-2", team: "East End FC", format: "7-a-side", location: "Victoria Park", time: "Sat, 10:00 AM", spotsNeeded: 1, fullPrice: 15, ringerPrice: 8, level: "Competitive", description: "One of our regulars is injured. Need a solid midfielder to fill in." },
  { id: "r-3", team: "Shoreditch Rovers", format: "5-a-side", location: "Powerleague Shoreditch", time: "Sun, 2:00 PM", spotsNeeded: 3, fullPrice: 14, ringerPrice: 7, level: "Casual", description: "Got a few lads away on holiday. Come join for a relaxed Sunday game." },
];

function Stars({ rating }: { rating: number }) {
  if (rating === 0) return <div className="flex items-center gap-1"><span className="text-xs text-text-secondary">No rating yet</span></div>;
  return (
    <div className="flex items-center gap-1">
      <span className="text-sm font-bold text-yellow-400">{rating}</span>
      {[1,2,3,4,5].map((i) => (
        <svg key={i} width="11" height="11" viewBox="0 0 24 24" fill={i <= Math.round(rating) ? "#FACC15" : "none"} stroke="#FACC15" strokeWidth="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
    </div>
  );
}

// ── Challenge Panel ───────────────────────────────────────────
function ChallengePanel({
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
        setSlotTakenError(
          `Your team needs £${(challengerHalfPence / 100).toFixed(2)} in available credit to cover your half of this pitch. Top up team credit and try again.`
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
        setSlotTakenError(
          `Your team needs £${(challengerHalfPence / 100).toFixed(2)} in available credit to cover your half of this secured pitch. Top up team credit and try again.`
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
          fetch("/api/connect/venue-transfer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pitchId: pitch.id,
              bookingId: pitchBookingId,
              matchId: matchRecord.id,
              amountPence: feePence,
            }),
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
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 pb-16">
        <div className="w-full max-w-lg bg-[#141414] rounded-t-2xl p-6 text-center">
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
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 pb-16">
        <div className="w-full max-w-lg bg-[#141414] rounded-t-2xl p-6 text-center">
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
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 pb-16">
        <div className="w-full max-w-lg bg-[#141414] rounded-t-2xl p-6 text-center">
          <div className="w-16 h-16 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <p className="text-lg font-bold mb-1">Match Confirmed!</p>
          <p className="text-sm text-text-secondary mb-1">
            You&apos;re playing <span className="text-text-primary font-semibold">{post.team}</span>
          </p>
          <p className="text-xs text-text-secondary mb-1">{post.date}</p>
          <p className="text-xs text-text-secondary mb-4">
            Venue: <span className="text-text-primary font-medium">{confirmedPitch?.name}</span>
          </p>
          <div className="bg-surface-2 border border-border rounded-xl p-3 mb-5 text-left">
            <p className="text-xs text-text-secondary">
              Payment of{" "}
              <span className="font-semibold text-text-primary">
                £{((confirmedPitch?.price ?? 80) / 22).toFixed(2)}/player
              </span>{" "}
              will be taken automatically in{" "}
              <span className="font-semibold text-accent">3 hours</span>. Non-refundable after payment.
            </p>
          </div>
          {matchId && (
            <a href={`/my-team/match/${matchId}`}
              className="w-full py-3 rounded-xl bg-surface-2 border border-border text-sm font-semibold text-center block mb-2">
              View Match Details
            </a>
          )}
          <button onClick={onClose} className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm">Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 pb-16" onClick={onClose}>
      <div className="w-full max-w-lg bg-[#141414] rounded-t-2xl flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
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
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>

          <p className="text-sm font-semibold mb-2">Select a pitch</p>
          <p className="text-xs text-text-secondary mb-3">
            Choose from the posting team&apos;s preferred pitches for {post.date}.
          </p>

          {slotTakenError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5 mb-3">
              <p className="text-xs text-red-400">{slotTakenError}</p>
            </div>
          )}

          {checkingAvail ? (
            <div className="flex items-center justify-center gap-2 py-6 mb-4 bg-surface-2 border border-border rounded-xl">
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
                      selectedPitch === pitch.id ? "bg-accent text-black" : "bg-background text-text-secondary"
                    }`}>
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold truncate ${isBooked ? "line-through text-text-secondary" : ""}`}>{pitch.name}</p>
                      <p className="text-xs text-text-secondary">KO {pitch.time ?? post.match_time} · {pitch.format} · £{pitch.price}/hr</p>
                    </div>
                    {isBooked
                      ? <span className="text-[10px] font-semibold text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full flex-shrink-0">Taken</span>
                      : i === 0
                      ? <span className="text-[10px] font-semibold text-accent bg-accent/10 px-2 py-0.5 rounded-full flex-shrink-0">Preferred</span>
                      : <span className="text-[10px] text-text-secondary flex-shrink-0">Backup {i}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {selectedPitch && (
            <div className="bg-surface-2 border border-border rounded-xl p-3 text-xs text-text-secondary">
              <p className="font-semibold text-text-primary mb-1">Payment</p>
              {post.pitchSecured ? (
                <p>
                  This pitch is already booked & paid by {post.team}. On joining, your team credit is charged{" "}
                  <span className="text-accent font-semibold">
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

        <div className="px-5 pb-6 pt-3 flex-shrink-0 border-t border-border bg-[#141414]">
          <button
            disabled={!selectedPitch || saving || checkingAvail}
            onClick={handleConfirm}
            className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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

// ── Match Card (opponents' posts) ─────────────────────────────
function MatchCard({
  post,
  showChallenge,
  onMatched,
}: {
  post: MatchPost;
  showChallenge: boolean;
  onMatched?: (postId: string) => void;
}) {
  const [showPanel, setShowPanel] = useState(false);
  const initials = post.team.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <>
      <div className="bg-surface-2 border border-border rounded-2xl p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-accent">{initials}</span>
            </div>
            <div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-sm font-bold">{post.team}</p>
                <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />
              </div>
              <p className="text-xs text-text-secondary mt-0.5">{post.location || "Location TBC"}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            {post.pitchSecured && (
              <span className="text-[10px] font-semibold bg-green-500/10 text-green-400 border border-green-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                Pitch Secured
              </span>
            )}
            {post.availabilityMatch && (
              <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/30 px-2 py-0.5 rounded-full">
                Matches availability
              </span>
            )}
          </div>
        </div>

        <Stars rating={0} />
        {post.description && <p className="text-xs text-text-secondary my-2">{post.description}</p>}

        <div className="flex items-center gap-1 text-xs text-text-secondary mb-3 mt-2">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          {post.date}
        </div>

        {post.pitchOptions.length > 0 && (
          <div className="bg-background rounded-xl px-3 py-2 mb-3">
            <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">Pitch Options</p>
            <div className="space-y-1">
              {post.pitchOptions.map((p, i) => (
                <div key={p.id} className="flex items-center gap-2 text-xs text-text-secondary">
                  <span className="w-4 h-4 rounded-full bg-surface-2 border border-border flex items-center justify-center text-[9px] font-bold flex-shrink-0">{i + 1}</span>
                  <span className="truncate">{p.name}</span>
                  <span className="text-accent font-medium flex-shrink-0">£{((p.price / 2) * 1.05).toFixed(2)}</span>
                  {i > 0 && <span className="text-[9px] text-text-secondary flex-shrink-0">backup</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {showChallenge && (
          <button onClick={() => setShowPanel(true)}
            className="w-full py-2.5 rounded-xl bg-accent text-black font-bold text-sm">
            {post.pitchSecured ? "Join — Pitch Secured" : "Challenge Team"}
          </button>
        )}
      </div>

      {showPanel && (
        <ChallengePanel
          post={post}
          onClose={() => setShowPanel(false)}
          onMatched={(id) => { setShowPanel(false); onMatched?.(id); }}
        />
      )}
    </>
  );
}

// ── My Post Card (captain's own posts) ────────────────────────
function MyPostCard({ post, onRemoved }: { post: MatchPost; onRemoved: (id: string) => void }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [takingDown, setTakingDown] = useState(false);

  const handleTakeDown = async () => {
    setTakingDown(true);
    await supabase.from("match_posts").update({ status: "cancelled" }).eq("id", post.id);
    if (post.securedBookingId) {
      await supabase.from("pitch_bookings").update({ post_id: null }).eq("id", post.securedBookingId);
    }
    setTakingDown(false);
    setShowConfirm(false);
    onRemoved(post.id);
  };

  const initials = post.team.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="border border-indigo-500/40 bg-indigo-500/5 rounded-2xl p-4">
      <div className="flex items-center gap-1.5 mb-3">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" className="text-indigo-400">
          <path d="M12 2a5 5 0 0 0-5 5c0 3.5 5 11 5 11s5-7.5 5-11a5 5 0 0 0-5-5zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/>
        </svg>
        <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Your Post</span>
      </div>

      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-accent">{initials}</span>
          </div>
          <div>
            <p className="text-sm font-bold">{post.team}</p>
            <p className="text-xs text-text-secondary mt-0.5">{post.location || "Location TBC"}</p>
          </div>
        </div>
        {post.pitchSecured && (
          <span className="text-[10px] font-semibold bg-green-500/10 text-green-400 border border-green-500/30 px-2 py-0.5 rounded-full flex items-center gap-1 flex-shrink-0">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
            Pitch Secured
          </span>
        )}
      </div>

      <div className="flex items-center gap-1 text-xs text-text-secondary mb-3">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
        {post.date}
      </div>

      {post.pitchOptions.length > 0 && (
        <div className="bg-background rounded-xl px-3 py-2 mb-3">
          <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">Your Pitch Options</p>
          <div className="space-y-1">
            {post.pitchOptions.map((p, i) => (
              <div key={p.id} className="flex items-center gap-2 text-xs text-text-secondary">
                <span className="w-4 h-4 rounded-full bg-surface-2 border border-border flex items-center justify-center text-[9px] font-bold flex-shrink-0">{i + 1}</span>
                <span className="truncate">{p.name}</span>
                <span className="text-accent font-medium flex-shrink-0">£{p.price}/hr</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-text-secondary mb-3">
        <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
        Waiting for a challenge…
      </div>
      <div className="flex gap-2">
        <button onClick={() => setShowConfirm(true)}
          className="flex-1 py-2.5 rounded-xl border border-red-500/30 text-red-400 text-sm font-semibold flex items-center justify-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          Take Down Post
        </button>
        <a href={`/play/edit/${post.id}`}
          className="flex-1 py-2.5 rounded-xl bg-accent text-black text-sm font-bold flex items-center justify-center gap-1.5">
          View Your Post
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </a>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6">
          <div className="bg-surface-2 border border-border rounded-2xl p-6 w-full max-w-xs shadow-xl">
            <h3 className="text-base font-bold mb-1">Take Down This Post?</h3>
            <p className="text-sm text-text-secondary mb-5">
              Your post will no longer be visible to other teams. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowConfirm(false)} disabled={takingDown}
                className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold disabled:opacity-40">
                Cancel
              </button>
              <button onClick={handleTakeDown} disabled={takingDown}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2">
                {takingDown ? (
                  <><svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Removing…</>
                ) : "Yes, Take Down"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Ringer Card ───────────────────────────────────────────────
function RingerCard({ game }: { game: typeof ringerGames[0] }) {
  return (
    <div className="bg-surface-2 border border-border rounded-2xl p-4">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-accent">{game.team.split(" ").map((w) => w[0]).join("").slice(0,2)}</span>
          </div>
          <div>
            <p className="text-sm font-semibold">{game.team}</p>
            <p className="text-xs text-text-secondary">{game.format} · {game.location}</p>
          </div>
        </div>
        <span className={`text-xs font-medium px-2 py-1 rounded-lg ${game.level === "Casual" ? "bg-blue-500/10 text-blue-400" : "bg-orange-500/10 text-orange-400"}`}>{game.level}</span>
      </div>
      <p className="text-xs text-text-secondary mb-2">{game.description}</p>
      <div className="flex items-center gap-2 text-xs text-text-secondary mb-3">
        <span>{game.time}</span>
        <span className="w-1 h-1 rounded-full bg-border" />
        <span className="text-accent font-semibold">{game.spotsNeeded} spot{game.spotsNeeded > 1 ? "s" : ""} needed</span>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <span className="text-lg font-bold text-accent">£{game.ringerPrice}</span>
          <span className="text-xs text-text-secondary ml-1 line-through">£{game.fullPrice}</span>
        </div>
        <button className="px-5 py-2 rounded-xl bg-accent text-black text-sm font-bold">Join as Ringer</button>
      </div>
    </div>
  );
}

// ── Tournament list — hosted-by-you first, under its own heading ──
function TournamentList({ tournaments, myTeamId, myTeamName, onJoined }: {
  tournaments: Tournament[]; myTeamId: string | null; myTeamName: string | null; onJoined: (id: string) => void;
}) {
  const mine = myTeamId ? tournaments.filter((t) => t.organiser_team_id === myTeamId) : [];
  const others = myTeamId ? tournaments.filter((t) => t.organiser_team_id !== myTeamId) : tournaments;

  return (
    <div className="space-y-4">
      {mine.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Hosted by you</p>
          {mine.map((t) => (
            <TournamentCard key={t.id} tournament={t} myTeamId={myTeamId} myTeamName={myTeamName} onJoined={onJoined} />
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="space-y-3">
          {mine.length > 0 && <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Other tournaments</p>}
          {others.map((t) => (
            <TournamentCard key={t.id} tournament={t} myTeamId={myTeamId} myTeamName={myTeamName} onJoined={onJoined} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tournament Card ────────────────────────────────────────────
function TournamentCard({
  tournament: t,
  myTeamId,
  myTeamName,
  onJoined,
}: {
  tournament: Tournament;
  myTeamId: string | null;
  myTeamName: string | null;
  onJoined: (id: string) => void;
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const spotsLeft = Math.max(0, t.max_teams - t.joinedCount);
  const isFull = t.status === "full" || spotsLeft === 0;
  const alreadyIn = myTeamId ? t.joinedTeamIds.includes(myTeamId) : false;
  const isOrganiser = myTeamId != null && t.organiser_team_id === myTeamId;
  const hostName = t.organiser_team_name ?? t.pitch_name;
  const isInvited = !alreadyIn && !isOrganiser && t.inviteDiscountPence > 0;
  const effectivePence = Math.max(0, t.price_per_team_pence - t.inviteDiscountPence);
  const buyIn = (t.price_per_team_pence / 100).toFixed(2);

  return (
    <div className={`bg-surface-2 border rounded-2xl overflow-hidden ${isOrganiser ? "border-accent/50" : "border-border"}`}>
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between mb-2 gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-bold truncate">{t.title}</p>
              {isOrganiser && (
                <span className="flex-shrink-0 text-[10px] font-bold text-accent bg-accent/10 border border-accent/30 px-1.5 py-0.5 rounded-full">Hosted by you</span>
              )}
            </div>
            <p className="text-xs text-text-secondary">
              by {hostName}
              <span className="ml-1.5 text-[10px] font-semibold text-text-secondary/70">{t.organiser_team_name ? "· Team-hosted" : "· Venue"}</span>
            </p>
          </div>
          {isInvited ? (
            <span className="text-right flex-shrink-0">
              <span className="text-[10px] text-text-secondary line-through block">£{buyIn}</span>
              <span className="text-xs font-bold text-accent bg-accent/10 border border-accent/30 px-2 py-0.5 rounded-lg">£{(effectivePence / 100).toFixed(2)}/team</span>
            </span>
          ) : (
            <span className="text-xs font-bold text-accent bg-accent/10 border border-accent/30 px-2 py-1 rounded-lg flex-shrink-0">£{buyIn}/team</span>
          )}
        </div>
        {isInvited && (
          <div className="inline-flex items-center gap-1.5 bg-accent/10 border border-accent/30 rounded-full px-2.5 py-1 mb-2">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            <span className="text-[10px] font-bold text-accent">Invited · £{(t.inviteDiscountPence / 100).toFixed(2)} off</span>
          </div>
        )}
        <div className="flex items-center gap-2 text-xs text-text-secondary mb-3 flex-wrap">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          <span>{fmtPostDate(t.match_date, t.start_time)}</span>
          {t.format && <><span className="w-1 h-1 rounded-full bg-border" /><span>{t.format}</span></>}
          <span className="w-1 h-1 rounded-full bg-border" /><span className="capitalize">{t.skill_level}</span>
        </div>
        {t.description && <p className="text-xs text-text-secondary">{t.description}</p>}
      </div>

      {/* Footer: venue + teams entered */}
      <div className="border-t border-border px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            <p className="text-sm font-semibold truncate">{t.pitch_name}</p>
          </div>
          {t.venue_address && <p className="text-xs text-text-secondary truncate mt-0.5">{t.venue_address}</p>}
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-base font-bold text-accent">{t.joinedCount}/{t.max_teams}</p>
          <p className="text-[10px] text-text-secondary">teams entered</p>
        </div>
      </div>

      {/* CTA */}
      <div className="px-4 pb-4 space-y-2">
        {isOrganiser ? (
          <div className="w-full py-2.5 rounded-xl bg-accent/10 border border-accent/30 text-center text-sm font-semibold text-accent">You&apos;re hosting this tournament</div>
        ) : alreadyIn ? (
          <div className="w-full py-2.5 rounded-xl bg-accent/10 border border-accent/30 text-center text-sm font-semibold text-accent">Your team is entered ✓</div>
        ) : isFull ? (
          <div className="w-full py-2.5 rounded-xl bg-surface border border-border text-center text-sm font-semibold text-text-secondary">Tournament full</div>
        ) : (
          <button onClick={() => setPanelOpen(true)}
            className="w-full py-2.5 rounded-xl bg-accent text-black font-bold text-sm">
            {isInvited ? `Accept invitation — £${(effectivePence / 100).toFixed(2)}` : `Enter Tournament${spotsLeft > 0 ? ` — ${spotsLeft} spot${spotsLeft !== 1 ? "s" : ""} left` : ""}`}
          </button>
        )}
        <a href={`/play/tournament/${t.id}`}
          className="flex items-center justify-center gap-1.5 w-full py-2 rounded-xl bg-surface border border-border text-sm font-semibold text-text-primary">
          {isOrganiser ? "Manage schedule & referees" : "View schedule & referees"}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
        </a>
      </div>

      {panelOpen && (
        <EnterTournamentPanel
          tournament={t}
          myTeamId={myTeamId}
          myTeamName={myTeamName}
          onClose={() => setPanelOpen(false)}
          onJoined={() => { setPanelOpen(false); onJoined(t.id); }}
        />
      )}
    </div>
  );
}

// ── Enter Tournament Panel ─────────────────────────────────────
function EnterTournamentPanel({
  tournament: t,
  myTeamId,
  myTeamName,
  onClose,
  onJoined,
}: {
  tournament: Tournament;
  myTeamId: string | null;
  myTeamName: string | null;
  onClose: () => void;
  onJoined: () => void;
}) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Effective buy-in after any pending-invitation discount (the join route
  // re-applies the discount authoritatively; this keeps the UI in sync).
  const buyIn = Math.max(0, t.price_per_team_pence - t.inviteDiscountPence);

  const handleJoin = async () => {
    if (!user || !myTeamId) { setError("You need to be a team captain to enter a tournament."); return; }
    setSaving(true);
    setError(null);

    const res = await fetch("/api/tournaments/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openMatchId: t.id, teamId: myTeamId, teamName: myTeamName, userId: user.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSaving(false);
      setError(
        data.error === "INSUFFICIENT_CREDIT"
          ? `Your team needs £${(buyIn / 100).toFixed(2)} in available credit to enter. Top up team credit and try again.`
          : (data.error ?? "Couldn't enter the tournament. Please try again.")
      );
      return;
    }

    // Cash side, venue-hosted only: move this team's buy-in to the venue's
    // connected account (best-effort, mirrors match confirmation). A team-hosted
    // tournament instead reimburses the organiser's credit server-side (handled
    // in the join route), so no venue transfer fires. bookingId is intentionally
    // omitted — every team shares the tournament's single reservation booking, so
    // keying idempotency on it would collapse all buy-ins into one transfer.
    if (buyIn > 0 && data.hostType === "venue") {
      fetch("/api/connect/venue-transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pitchId: t.pitch_id, amountPence: buyIn }),
      }).catch(() => {});
    }

    setSaving(false);
    setConfirmed(true);
  };

  if (confirmed) {
    return (
      <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/60" onClick={onJoined}>
        <div className="w-full max-w-lg bg-[#141414] rounded-t-2xl md:rounded-2xl p-6 text-center" onClick={(e) => e.stopPropagation()}>
          <div className="w-16 h-16 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <p className="text-lg font-bold mb-1">You&apos;re in!</p>
          <p className="text-sm text-text-secondary mb-5">
            {myTeamName} has entered <span className="font-semibold text-text-primary">{t.title}</span>. £{(buyIn / 100).toFixed(2)} was taken from your team credit and paid to {t.organiser_team_name ?? t.pitch_name}. Your squad can settle their share afterwards from Team Credits.
          </p>
          <button onClick={onJoined} className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm">Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-lg bg-[#141414] rounded-t-2xl md:rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <p className="font-bold">Enter Tournament</p>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="bg-surface-2 border border-border rounded-xl p-4 mb-4">
          <p className="text-sm font-bold">{t.title}</p>
          <p className="text-xs text-text-secondary mt-0.5">{t.pitch_name} · {fmtPostDate(t.match_date, t.start_time)}</p>
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
            <span className="text-xs text-text-secondary">Buy-in (per team)</span>
            <span className="text-sm font-bold">
              {t.inviteDiscountPence > 0 && <span className="text-[11px] text-text-secondary line-through mr-1.5">£{(t.price_per_team_pence / 100).toFixed(2)}</span>}
              £{(buyIn / 100).toFixed(2)}
            </span>
          </div>
          {t.inviteDiscountPence > 0 && (
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-xs text-accent">Invitation discount</span>
              <span className="text-xs font-semibold text-accent">−£{(t.inviteDiscountPence / 100).toFixed(2)}</span>
            </div>
          )}
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-xs text-text-secondary">Teams entered</span>
            <span className="text-sm font-semibold">{t.joinedCount}/{t.max_teams}</span>
          </div>
        </div>

        <p className="text-xs text-text-secondary mb-4">
          The buy-in comes out of your team credit now and is paid to the venue. Your players
          each refill their share from the tournament page afterwards.
        </p>

        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

        <button onClick={handleJoin} disabled={saving || !myTeamId}
          className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50">
          {saving ? "Entering…" : `Pay £${(buyIn / 100).toFixed(2)} & Enter`}
        </button>
        {!myTeamId && <p className="text-[11px] text-text-secondary text-center mt-2">Only team captains can enter a tournament.</p>}
      </div>
    </div>
  );
}

// ── Open tournaments hook (venue-hosted, from open_matches) ─────
function useOpenTournaments(userId?: string) {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [myTeamName, setMyTeamName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      let teamId: string | null = null;
      if (userId) {
        const { data: team } = await supabase
          .from("teams").select("id, name").eq("captain_id", userId).maybeSingle();
        teamId = team?.id ?? null;
        setMyTeamId(teamId);
        setMyTeamName(team?.name ?? null);
      }

      const { data: oms } = await supabase
        .from("open_matches")
        .select("id, pitch_id, pitch_name, venue_address, match_date, start_time, end_time, format, skill_level, price_per_team_pence, max_teams, description, status, booking_id, organiser_team_id, organiser_team_name")
        .eq("match_type", "tournament")
        .neq("status", "cancelled")
        .order("match_date", { ascending: true });

      // Pending invitations for the viewer's team → discount per tournament.
      const discountByTournament = new Map<string, number>();
      if (teamId) {
        const { data: invites } = await supabase
          .from("tournament_invitations")
          .select("open_match_id, discount_pence, status")
          .eq("team_id", teamId).eq("status", "pending");
        for (const inv of invites ?? []) discountByTournament.set(inv.open_match_id as string, inv.discount_pence ?? 0);
      }

      const withTeams = await Promise.all((oms ?? []).map(async (m) => {
        const { data: teams } = await supabase
          .from("open_match_teams").select("team_id").eq("open_match_id", m.id);
        const joinedTeamIds = (teams ?? []).map((x) => x.team_id as string);
        return { ...m, joinedCount: joinedTeamIds.length, joinedTeamIds, inviteDiscountPence: discountByTournament.get(m.id) ?? 0 } as Tournament;
      }));

      // Hide tournaments whose date has already passed.
      const active = withTeams.filter((t) => !isExpired(t.match_date, t.start_time));
      setTournaments(active);
      setLoading(false);
    }
    load();
  }, [userId]);

  // Optimistically bump the joined count for the team that just entered.
  const markJoined = (id: string) => setTournaments((prev) => prev.map((t) =>
    t.id === id && myTeamId && !t.joinedTeamIds.includes(myTeamId)
      ? { ...t, joinedCount: t.joinedCount + 1, joinedTeamIds: [...t.joinedTeamIds, myTeamId] }
      : t
  ));

  return { tournaments, myTeamId, myTeamName, loading, markJoined };
}

// ── Hooks ─────────────────────────────────────────────────────
function usePosts(excludeCaptainId: string | null, userId?: string) {
  const [posts, setPosts] = useState<MatchPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (excludeCaptainId === undefined) return;

    async function load() {
      // Fetch this user's team availability dates
      let availabilityDates: string[] = [];
      if (userId) {
        let teamId: string | undefined;

        const { data: captainTeam } = await supabase
          .from("teams").select("id").eq("captain_id", userId).maybeSingle();
        teamId = captainTeam?.id;

        if (!teamId) {
          const { data: membership } = await supabase
            .from("team_members").select("team_id")
            .eq("player_id", userId).eq("status", "approved").maybeSingle();
          teamId = membership?.team_id;
        }

        if (teamId) {
          const { data: req } = await supabase
            .from("availability_requests").select("date_options")
            .eq("team_id", teamId)
            .order("created_at", { ascending: false })
            .limit(1).maybeSingle();

          if (req?.date_options) {
            availabilityDates = (req.date_options as { date: string }[]).map((d) => toISODate(d.date));
          }
        }
      }

      let query = supabase
        .from("match_posts")
        .select("*")
        .eq("status", "open")
        .order("created_at", { ascending: false });
      if (excludeCaptainId) {
        query = query.neq("captain_id", excludeCaptainId);
      }

      const { data } = await query;
      const mapped = (data ?? []).map((row) => ({
        id: row.id,
        team_id: row.team_id,
        captain_id: row.captain_id,
        team: row.team_name,
        location: row.team_location ?? "",
        date: fmtPostDate(row.match_date, row.match_time),
        match_date: row.match_date,
        match_time: row.match_time,
        pitchOptions: (row.pitch_options ?? []) as PitchOption[],
        description: row.description ?? "",
        availabilityMatch: availabilityDates.includes(toISODate(row.match_date)),
        status: row.status,
        payment_mode: row.payment_mode ?? "credit",
        pitchSecured: Boolean(row.pitch_secured),
        securedBookingId: row.secured_booking_id ?? null,
      }));

      const active = mapped.filter((p) => !isExpired(p.match_date, p.match_time));

      // Secured-pitch posts float to the top (pitch already locked in, joinable
      // right away), then availability-matching posts.
      active.sort((a, b) =>
        (b.pitchSecured ? 1 : 0) - (a.pitchSecured ? 1 : 0) ||
        (b.availabilityMatch ? 1 : 0) - (a.availabilityMatch ? 1 : 0)
      );

      setPosts(active);
      setLoading(false);
    }

    load();
  }, [excludeCaptainId, userId]);

  const removePost = (id: string) => setPosts((prev) => prev.filter((p) => p.id !== id));
  return { posts, loading, removePost };
}

function useMyPosts(captainId?: string) {
  const [posts, setPosts] = useState<MatchPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!captainId) return;
    supabase
      .from("match_posts")
      .select("*")
      .eq("captain_id", captainId)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setPosts((data ?? []).map((row) => ({
          id: row.id,
          team_id: row.team_id,
          captain_id: row.captain_id,
          team: row.team_name,
          location: row.team_location ?? "",
          date: fmtPostDate(row.match_date, row.match_time),
          match_date: row.match_date,
          match_time: row.match_time,
          pitchOptions: (row.pitch_options ?? []) as PitchOption[],
          description: row.description ?? "",
          availabilityMatch: false,
          status: row.status,
          payment_mode: row.payment_mode ?? "credit",
          pitchSecured: Boolean(row.pitch_secured),
          securedBookingId: row.secured_booking_id ?? null,
        })).filter((p) => !isExpired(p.match_date, p.match_time)));
        setLoading(false);
      });
  }, [captainId]);

  const removePost = (id: string) => setPosts((prev) => prev.filter((p) => p.id !== id));
  return { posts, loading, removePost };
}

// ── POV Views ─────────────────────────────────────────────────
function NewUserPlay() {
  return (
    <div className="space-y-4">
      <div className="bg-accent/10 border border-accent/30 rounded-xl p-4">
        <p className="text-sm font-semibold text-accent mb-1">Fill in for a Match</p>
        <p className="text-xs text-text-secondary leading-relaxed">
          No team? No problem. Join a game as a temporary ringer at a discounted rate.
        </p>
      </div>
      {ringerGames.map((g) => <RingerCard key={g.id} game={g} />)}
    </div>
  );
}

function PlayerPlay() {
  const { user } = useAuth();
  const { posts, loading, removePost } = usePosts(null, user?.id);
  const { tournaments, myTeamId, myTeamName, loading: tLoading, markJoined } = useOpenTournaments(user?.id);
  const [tab, setTab] = useState<MatchTab>("matches");

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "matches" || t === "tournaments" || t === "ringer") setTab(t);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {([{ key: "matches", label: "Matches" }, { key: "tournaments", label: "Tournaments" }, { key: "ringer", label: "Fill in" }] as { key: MatchTab; label: string }[]).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${tab === t.key ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "matches" && (
        <div className="space-y-4">
          {loading ? (
            <p className="text-sm text-text-secondary text-center py-8">Loading matches…</p>
          ) : posts.length === 0 ? (
            <p className="text-sm text-text-secondary text-center py-8">No open matches right now.</p>
          ) : (
            posts.map((p) => <MatchCard key={p.id} post={p} showChallenge={false} onMatched={removePost} />)
          )}
        </div>
      )}

      {tab === "tournaments" && (
        tLoading ? (
          <p className="text-sm text-text-secondary text-center py-8">Loading tournaments…</p>
        ) : tournaments.length === 0 ? (
          <p className="text-sm text-text-secondary text-center py-8">No tournaments right now.</p>
        ) : (
          <TournamentList tournaments={tournaments} myTeamId={myTeamId} myTeamName={myTeamName} onJoined={markJoined} />
        )
      )}

      {tab === "ringer" && ringerGames.map((g) => <RingerCard key={g.id} game={g} />)}
    </div>
  );
}

function CaptainPlay() {
  const { user } = useAuth();
  const { posts, loading, removePost } = usePosts(user?.id ?? null, user?.id);
  const { posts: myPosts, loading: myPostsLoading, removePost: removeMyPost } = useMyPosts(user?.id);
  const { tournaments, myTeamId, myTeamName, loading: tLoading, markJoined } = useOpenTournaments(user?.id);
  const [tab, setTab] = useState<MatchTab>("matches");

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "matches" || t === "tournaments" || t === "ringer") setTab(t);
  }, []);

  const myPost = myPosts[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {([
          { key: "matches", label: "Matches" },
          { key: "tournaments", label: "Tournaments" },
          { key: "ringer", label: "Fill in" },
        ] as { key: MatchTab; label: string }[]).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium border transition-colors relative ${tab === t.key ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "matches" && (
        <div className="space-y-4">
          {myPostsLoading ? null : myPost ? (
            <MyPostCard post={myPost} onRemoved={removeMyPost} />
          ) : (
            <a href="/play/create" onClick={() => localStorage.setItem("unitr_payment_mode", "individual")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-black text-xs font-bold">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
              Create New Post
            </a>
          )}

          {loading ? (
            <p className="text-sm text-text-secondary text-center py-8">Loading matches…</p>
          ) : posts.length === 0 ? (
            <p className="text-sm text-text-secondary text-center py-8">No open matches from other teams right now.</p>
          ) : (
            posts.map((p) => (
              <MatchCard key={p.id} post={p} showChallenge={true} onMatched={removePost} />
            ))
          )}
        </div>
      )}

      {tab === "tournaments" && (
        <div className="space-y-4">
          <a href="/play/create-tournament"
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-accent text-black text-sm font-bold">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
            Host a Tournament
          </a>
          {tLoading ? (
            <p className="text-sm text-text-secondary text-center py-8">Loading tournaments…</p>
          ) : tournaments.length === 0 ? (
            <p className="text-sm text-text-secondary text-center py-8">No tournaments right now.</p>
          ) : (
            <TournamentList tournaments={tournaments} myTeamId={myTeamId} myTeamName={myTeamName} onJoined={markJoined} />
          )}
        </div>
      )}

      {tab === "ringer" && (
        <div className="space-y-4">
          <div className="bg-surface-2 border border-border rounded-xl p-4">
            <p className="text-sm font-semibold mb-1">Need a Ringer?</p>
            <p className="text-xs text-text-secondary mb-3">Post a ringer request if your team is short players.</p>
            <button className="w-full py-2.5 rounded-xl bg-accent text-black font-bold text-sm">Post Ringer Request</button>
          </div>
          {ringerGames.map((g) => <RingerCard key={g.id} game={g} />)}
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────
type PlayView = "find" | "book" | "mybookings";

export default function PlayPage() {
  const { role, roleLoading } = useRole();
  const [view, setView] = useState<PlayView>("find");
  // Posting slot carried over from "lock in a pitch first" so the Book tab
  // opens pre-filtered to the captain's chosen match date/time — and, when the
  // captain's intent was to post, auto-posts the booking as a secured match.
  const [bookDate, setBookDate] = useState<string | undefined>();
  const [bookTime, setBookTime] = useState<string | undefined>();
  const [bookAutoPost, setBookAutoPost] = useState(false);

  // Allow deep-linking to a tab, e.g. /play?view=book from the Create Match page.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get("view");
    if (v === "book" || v === "mybookings") setView(v);
    const d = params.get("date");
    const t = params.get("time");
    if (d) setBookDate(d);
    if (t) setBookTime(t);
    if (params.get("intent") === "post") setBookAutoPost(true);
  }, []);

  if (roleLoading) return <div className="flex items-center justify-center min-h-screen"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;

  return (
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-24">
      <header className="mb-5">
        <h1 className="text-2xl font-bold mb-1">Play</h1>
        <p className="text-text-secondary text-sm">
          {view === "book" ? "Book a pitch directly — no opponent needed"
          : view === "mybookings" ? "Manage pitches you've booked directly"
          : role === "new_user" ? "Find a game to join in your area"
          : role === "player" ? "Find teams to challenge or events to join"
          : "Manage matches and find opponents for your team"}
        </p>
      </header>

      <div className="flex bg-surface-2 border border-border rounded-xl p-1 mb-5">
        {([{ key: "find", label: "Find Match" }, { key: "book", label: "Book" }, { key: "mybookings", label: "My Bookings" }] as { key: PlayView; label: string }[]).map((v) => (
          <button key={v.key} onClick={() => setView(v.key)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${view === v.key ? "bg-accent text-black" : "text-text-secondary"}`}>
            {v.label}
          </button>
        ))}
      </div>

      {view === "find" ? (
        <>
          {role === "new_user" && <NewUserPlay />}
          {role === "player" && <PlayerPlay />}
          {role === "captain" && <CaptainPlay />}
        </>
      ) : view === "book" ? (
        <div className="-mx-4">
          <BookPitchPanel initialDate={bookDate} initialTime={bookTime} autoPost={bookAutoPost} />
        </div>
      ) : (
        <MyBookingsPanel />
      )}
    </div>
  );
}
