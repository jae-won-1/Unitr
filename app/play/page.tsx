"use client";

import { useState, useEffect } from "react";
import { useRole } from "@/contexts/RoleContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type MatchTab = "matches" | "my-posts" | "tournaments" | "ringer";

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
};

type Challenge = {
  id: string;
  challenger_team_name: string;
  selected_pitch: PitchOption;
  status: string;
  created_at: string;
};

const tournaments = [
  { id: "t-1", name: "East London Cup", organiser: "Unitr Official", location: "Victoria Park Arena", distance: "3.1 miles", date: "Mar 15, 2026", teams: "8/16 teams", prize: "£500", format: "11-a-side", description: "Annual knockout cup open to all competitive teams in East London." },
  { id: "t-2", name: "Shoreditch 5s", organiser: "Powerleague", location: "Powerleague Shoreditch", distance: "4.0 miles", date: "Apr 5, 2026", teams: "12/24 teams", prize: "£200", format: "5-a-side", description: "Fast-paced 5-a-side tournament with group stages and knockout rounds." },
];

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

    // Final double-booking check: pitch slot may have been taken since panel opened
    if (pitch?.id) {
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

    // Create a pitch_bookings row so the venue portal calendar shows this booking
    if (pitch?.id) {
      const perPlayerPence = Math.round((pitch.price * 100) / 22);
      const startTime = pitchTime || "12:00";
      const [h, m] = startTime.split(":").map(Number);
      const endTime = `${String(Math.min((h || 12) + 1, 23)).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}`;
      const { error: bookingErr } = await supabase.from("pitch_bookings").insert({
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
      });
      if (bookingErr) console.error("pitch_bookings insert failed:", bookingErr.message, bookingErr.details);
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
              <p>
                £{((post.pitchOptions.find((p) => p.id === selectedPitch)?.price ?? 80) / 22).toFixed(2)}/player charged automatically{" "}
                <span className="text-accent font-semibold">3 hours after confirmation</span>. Split across all players via Stripe.
              </p>
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
          {post.availabilityMatch && (
            <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/30 px-2 py-0.5 rounded-full flex-shrink-0">
              Matches availability
            </span>
          )}
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
                  <span className="text-accent font-medium flex-shrink-0">£{p.price}/hr</span>
                  {i > 0 && <span className="text-[9px] text-text-secondary flex-shrink-0">backup</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {showChallenge && (
          <button onClick={() => setShowPanel(true)}
            className="w-full py-2.5 rounded-xl bg-accent text-black font-bold text-sm">
            Challenge Team
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
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [loadingChallenge, setLoadingChallenge] = useState(true);

  useEffect(() => {
    if (post.status === "matched") {
      supabase.from("challenges").select("*").eq("post_id", post.id).eq("status", "accepted")
        .maybeSingle()
        .then(({ data }) => { setChallenge(data as Challenge | null); setLoadingChallenge(false); });
    } else {
      setLoadingChallenge(false);
    }
  }, [post.id, post.status]);

  const initials = post.team.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className={`border rounded-2xl p-4 ${post.status === "matched" ? "bg-accent/5 border-accent/30" : "bg-surface-2 border-border"}`}>
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
        {post.status === "matched" ? (
          <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/30 px-2 py-0.5 rounded-full flex-shrink-0">Matched</span>
        ) : (
          <span className="text-[10px] font-semibold bg-surface border border-border text-text-secondary px-2 py-0.5 rounded-full flex-shrink-0">Open</span>
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

      {/* Matched: show who challenged */}
      {post.status === "matched" && (
        <div className="bg-accent/10 border border-accent/20 rounded-xl px-3 py-3">
          {loadingChallenge ? (
            <p className="text-xs text-text-secondary">Loading challenge info…</p>
          ) : challenge ? (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center flex-shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-accent">Challenged by {challenge.challenger_team_name}</p>
                <p className="text-xs text-text-secondary mt-0.5">Pitch: {challenge.selected_pitch?.name ?? "TBC"}</p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-text-secondary">Match confirmed — challenge details loading.</p>
          )}
        </div>
      )}

      {/* Open: waiting state */}
      {post.status === "open" && (
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          Waiting for a challenge…
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
      }));

      // Availability-matching posts float to the top
      mapped.sort((a, b) => (b.availabilityMatch ? 1 : 0) - (a.availabilityMatch ? 1 : 0));

      setPosts(mapped);
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
      .in("status", ["open", "matched"])
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
        })));
        setLoading(false);
      });
  }, [captainId]);

  return { posts, loading };
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
  const [tab, setTab] = useState<MatchTab>("matches");

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

      {tab === "tournaments" && tournaments.map((t) => (
        <div key={t.id} className="bg-surface-2 border border-border rounded-2xl p-4">
          <div className="flex items-start justify-between mb-2">
            <div><p className="font-semibold">{t.name}</p><p className="text-xs text-text-secondary">by {t.organiser}</p></div>
            <span className="text-xs font-bold text-accent bg-accent/10 border border-accent/30 px-2 py-1 rounded-lg">{t.prize}</span>
          </div>
          <p className="text-xs text-text-secondary mb-3">{t.description}</p>
          <div className="flex items-center gap-3 text-xs text-text-secondary mb-4 flex-wrap">
            <span>{t.location} · {t.distance}</span><span>{t.date}</span><span>{t.teams} entered</span>
            <span className="bg-surface border border-border px-2 py-0.5 rounded-md">{t.format}</span>
          </div>
          <button className="w-full py-2.5 rounded-xl bg-accent text-black font-bold text-sm">Enter Tournament</button>
        </div>
      ))}

      {tab === "ringer" && ringerGames.map((g) => <RingerCard key={g.id} game={g} />)}
    </div>
  );
}

function CaptainPlay() {
  const { user } = useAuth();
  const { posts, loading, removePost } = usePosts(user?.id ?? null, user?.id);
  const { posts: myPosts, loading: myPostsLoading } = useMyPosts(user?.id);
  const [tab, setTab] = useState<MatchTab>("matches");

  const myPostsCount = myPosts.filter((p) => p.status === "open").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {([
          { key: "matches", label: "Matches" },
          { key: "my-posts", label: "My Posts" },
          { key: "tournaments", label: "Tournaments" },
          { key: "ringer", label: "Fill in" },
        ] as { key: MatchTab; label: string }[]).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium border transition-colors relative ${tab === t.key ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>
            {t.label}
            {t.key === "my-posts" && myPostsCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-accent text-black text-[9px] font-bold flex items-center justify-center">
                {myPostsCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "matches" && (
        <div className="space-y-4">
          {loading ? (
            <p className="text-sm text-text-secondary text-center py-8">Loading matches…</p>
          ) : posts.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-text-secondary mb-3">No open matches from other teams right now.</p>
              <a href="/my-team?findMatch=1" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-surface-2 text-sm font-medium">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                Post your own match instead
              </a>
            </div>
          ) : (
            posts.map((p) => (
              <MatchCard key={p.id} post={p} showChallenge={true} onMatched={removePost} />
            ))
          )}
        </div>
      )}

      {tab === "my-posts" && (
        <div className="space-y-4">
          <a href="/my-team?findMatch=1"
            className="flex items-center gap-2 w-fit px-4 py-2 rounded-lg border border-border bg-surface-2 text-sm font-medium">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
            Create New Post
          </a>

          {myPostsLoading ? (
            <p className="text-sm text-text-secondary text-center py-8">Loading your posts…</p>
          ) : myPosts.length === 0 ? (
            <p className="text-sm text-text-secondary text-center py-8">No posts yet. Create one above.</p>
          ) : (
            myPosts.map((p) => <MyPostCard key={p.id} post={p} onRemoved={removePost} />)
          )}
        </div>
      )}

      {tab === "tournaments" && tournaments.map((t) => (
        <div key={t.id} className="bg-surface-2 border border-border rounded-2xl p-4">
          <div className="flex items-start justify-between mb-2">
            <div><p className="font-semibold">{t.name}</p><p className="text-xs text-text-secondary">by {t.organiser}</p></div>
            <span className="text-xs font-bold text-accent bg-accent/10 border border-accent/30 px-2 py-1 rounded-lg">{t.prize}</span>
          </div>
          <p className="text-xs text-text-secondary mb-3">{t.description}</p>
          <div className="flex items-center gap-3 text-xs text-text-secondary mb-4 flex-wrap">
            <span>{t.location} · {t.distance}</span><span>{t.date}</span><span>{t.teams} entered</span>
            <span className="bg-surface border border-border px-2 py-0.5 rounded-md">{t.format}</span>
          </div>
          <button className="w-full py-2.5 rounded-xl bg-accent text-black font-bold text-sm">Enter Tournament</button>
        </div>
      ))}

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
export default function PlayPage() {
  const { role, roleLoading } = useRole();
  if (roleLoading) return <div className="flex items-center justify-center min-h-screen"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;

  return (
    <div className="flex flex-col min-h-screen px-4 pt-12 pb-24">
      <header className="mb-5">
        <h1 className="text-2xl font-bold mb-1">Play</h1>
        <p className="text-text-secondary text-sm">
          {role === "new_user" ? "Find a game to join in your area"
          : role === "player" ? "Find teams to challenge or events to join"
          : "Manage matches and find opponents for your team"}
        </p>
      </header>
      {role === "new_user" && <NewUserPlay />}
      {role === "player" && <PlayerPlay />}
      {role === "captain" && <CaptainPlay />}
    </div>
  );
}
