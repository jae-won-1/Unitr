"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type Booking = {
  id: string;
  pitch_id: string;
  match_date: string;
  start_time: string;
  end_time: string;
  total_price_pence: number;
  payment_status: string;
  status: string;
  post_id: string | null;
  pitch: { name: string; address: string; format: string; price_per_hour: number } | null;
};

function fmtDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
function getDayName(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()];
}

// ── Turn into Match Post modal ──────────────────────────────────
function PostModal({ booking, team, onClose, onPosted }: {
  booking: Booking;
  team: { id: string; name: string; location: string };
  onClose: () => void;
  onPosted: (postId: string) => void;
}) {
  const { user } = useAuth();
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePost = async () => {
    if (!user || !booking.pitch) return;
    setSaving(true);
    setError(null);

    const dayName = getDayName(booking.match_date);
    const pitchOption = {
      id: booking.pitch_id,
      name: booking.pitch.name,
      address: booking.pitch.address,
      price: booking.total_price_pence / 100,
      format: booking.pitch.format,
      distance: "",
      time: booking.start_time,
    };

    const { data: post, error: postErr } = await supabase.from("match_posts").insert({
      team_id: team.id,
      captain_id: user.id,
      team_name: team.name,
      team_location: team.location ?? "",
      match_date: booking.match_date,
      match_time: booking.start_time,
      day_name: dayName,
      pitch_options: [pitchOption],
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
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-lg bg-[#141414] rounded-t-2xl md:rounded-2xl max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0 md:hidden"><div className="w-10 h-1 rounded-full bg-border" /></div>
        <div className="px-5 pt-2 md:pt-5 pb-8 space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between">
            <p className="font-bold">Turn into Match Post</p>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <p className="text-xs text-text-secondary -mt-2">
            Your pitch is already secured — any team can join straight away, no credit hold needed. This post jumps to the top of the Play feed.
          </p>

          <div className="bg-surface-2 border border-border rounded-xl p-3 space-y-1.5 text-xs">
            <div className="flex justify-between"><span className="text-text-secondary">Pitch</span><span className="font-semibold">{booking.pitch?.name}</span></div>
            <div className="flex justify-between"><span className="text-text-secondary">When</span><span className="font-semibold">{fmtDate(booking.match_date)} · {booking.start_time}</span></div>
            <div className="flex justify-between"><span className="text-text-secondary">Fee</span><span className="font-semibold text-accent">£{(booking.total_price_pence / 100).toFixed(2)} (already paid)</span></div>
          </div>

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
      </div>
    </div>
  );
}

// ── Booking Card ─────────────────────────────────────────────
function BookingCard({ booking, canPost, onTurnIntoPost }: {
  booking: Booking;
  canPost: boolean;
  onTurnIntoPost: (b: Booking) => void;
}) {
  const today = new Date().toISOString().split("T")[0];
  const isPast = /^\d{4}-\d{2}-\d{2}$/.test(booking.match_date) && booking.match_date < today;
  const isCancelled = booking.status === "cancelled";

  return (
    <div className={`bg-surface-2 border border-border rounded-2xl p-4 ${isCancelled ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="font-semibold text-sm">{booking.pitch?.name ?? "Pitch"}</p>
          <p className="text-xs text-text-secondary mt-0.5">{booking.pitch?.address}</p>
        </div>
        {isCancelled ? (
          <span className="text-[10px] font-semibold bg-surface border border-border text-text-secondary px-2 py-0.5 rounded-full flex-shrink-0">Cancelled</span>
        ) : booking.post_id ? (
          <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/30 px-2 py-0.5 rounded-full flex-shrink-0">Posted</span>
        ) : isPast ? (
          <span className="text-[10px] font-semibold bg-surface border border-border text-text-secondary px-2 py-0.5 rounded-full flex-shrink-0">Completed</span>
        ) : (
          <span className="text-[10px] font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded-full flex-shrink-0">Upcoming</span>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-text-secondary mb-1">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
        {fmtDate(booking.match_date)} · {booking.start_time}–{booking.end_time}
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-sm font-bold text-accent">£{(booking.total_price_pence / 100).toFixed(2)}</span>
        <span className={`text-[10px] font-medium ${booking.payment_status === "paid" ? "text-accent" : "text-yellow-400"}`}>
          {booking.payment_status === "paid" ? "Paid ✓" : "Payment pending"}
        </span>
      </div>

      {!booking.post_id && !isPast && !isCancelled && canPost && (
        <button onClick={() => onTurnIntoPost(booking)}
          className="w-full mt-3 py-2.5 rounded-xl bg-accent text-black font-bold text-sm">
          Turn into Match Post
        </button>
      )}
      {booking.post_id && (
        <a href="/play" className="block w-full mt-3 py-2 rounded-xl border border-border text-xs font-semibold text-text-secondary text-center">
          View in Play feed
        </a>
      )}
    </div>
  );
}

// ── Panel ───────────────────────────────────────────────────────
export default function MyBookingsPanel() {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState<{ id: string; name: string; location: string } | null>(null);
  const [posting, setPosting] = useState<Booking | null>(null);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const { data: rows } = await supabase
        .from("pitch_bookings")
        .select("id, pitch_id, match_date, start_time, end_time, total_price_pence, payment_status, status, post_id")
        .eq("booked_by", user!.id)
        .eq("booking_type", "platform")
        .order("match_date", { ascending: false });

      const pitchIds = Array.from(new Set((rows ?? []).map((r) => r.pitch_id)));
      const { data: pitches } = pitchIds.length > 0
        ? await supabase.from("pitches").select("id, name, address, formats, price_per_hour").in("id", pitchIds)
        : { data: [] };
      const pitchById = new Map((pitches ?? []).map((p) => [p.id, p]));

      setBookings((rows ?? []).map((r) => {
        const p = pitchById.get(r.pitch_id);
        return {
          ...r,
          pitch: p ? { name: p.name, address: p.address, format: p.formats?.[0] ?? "5-a-side", price_per_hour: p.price_per_hour } : null,
        } as Booking;
      }));
      setLoading(false);

      const { data: ownTeam } = await supabase.from("teams").select("id, name, location").eq("captain_id", user!.id).maybeSingle();
      setTeam(ownTeam ?? null);
    }
    load();
  }, [user]);

  if (loading) return <div className="flex items-center justify-center py-16"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;

  return (
    <div className="space-y-3">
      <div className="bg-accent/5 border border-accent/20 rounded-xl px-4 py-3">
        <p className="text-xs text-text-secondary">
          Pitches you&apos;ve booked directly from the <span className="font-semibold text-accent">Book</span> tab.
          {team ? " Turn one into a match post and it'll be secured — any team can join immediately." : " Captain a team to turn a booking into a match post."}
        </p>
      </div>

      {bookings.length === 0 ? (
        <div className="bg-surface-2 border border-border rounded-2xl px-4 py-12 text-center">
          <p className="text-sm font-semibold mb-1">No direct bookings yet</p>
          <p className="text-xs text-text-secondary">Book a pitch from the Book tab and it&apos;ll show up here.</p>
        </div>
      ) : (
        bookings.map((b) => (
          <BookingCard key={b.id} booking={b} canPost={Boolean(team)} onTurnIntoPost={setPosting} />
        ))
      )}

      {posting && team && (
        <PostModal
          booking={posting}
          team={team}
          onClose={() => setPosting(null)}
          onPosted={(postId) => {
            setBookings((prev) => prev.map((b) => b.id === posting.id ? { ...b, post_id: postId } : b));
            setPosting(null);
          }}
        />
      )}
    </div>
  );
}
