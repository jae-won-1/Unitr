"use client";

import { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { supabase } from "@/lib/supabase";
import { stripePromise } from "@/lib/stripe-client";
import { useAuth } from "@/contexts/AuthContext";
import { DatePicker, TimePicker } from "@/components/DateTimePickers";
import TopUpModal from "@/components/TopUpModal";
import { useSaveCardOffer } from "@/components/SaveCardPrompt";
import { authedPost } from "@/lib/authed-fetch";
import "leaflet/dist/leaflet.css";

// Leaflet must be client-only — no SSR
const PitchMap = dynamic(() => import("@/components/PitchMap"), { ssr: false, loading: () => (
  <div className="mx-4 rounded-2xl bg-surface-2 border border-border flex items-center justify-center" style={{ height: 900 }}>
    <div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
  </div>
) });

type Pitch = {
  id: string;
  name: string;
  address: string;
  lat?: number | null;
  lng?: number | null;
  price_per_hour: number;
  formats: string[];
  surfaces: string[];
  amenities: string[];
  rating: number;
  is_verified: boolean;
};

type SlotStatus = "available" | "booked" | "closed";
type DaySlot = { time: string; status: SlotStatus };

type SavedCard = { customerId: string; paymentMethodId: string; brand: string | null; last4: string | null };

// Display window for the day grid (matches venue portal default hours)
const ALL_HOURS = Array.from({ length: 16 }, (_, i) => `${String(i + 7).padStart(2, "0")}:00`); // 07:00–22:00
const DEFAULT_OPEN = 7;
const DEFAULT_CLOSE = 22;

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function getDayName(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()];
}

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs font-bold text-yellow-600">{Number(rating).toFixed(1)}</span>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width="10" height="10" viewBox="0 0 24 24" fill={i <= Math.round(rating) ? "#FACC15" : "none"} stroke="#FACC15" strokeWidth="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
    </div>
  );
}

// ── Card form (must live inside <Elements>) ───────────────────
// Collects card details and confirms the PaymentIntent. On success it hands
// the intent id back up so the parent can finalise the booking.
function CardBookingForm({ totalPence, working, onPaid, onError }: {
  totalPence: number; working: boolean; onPaid: (intentId: string) => void; onError: (msg: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);

  const handlePay = async () => {
    if (!stripe || !elements) return;
    setPaying(true);
    onError("");
    const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (error) { onError(error.message ?? "Payment failed. Please try again."); setPaying(false); return; }
    if (paymentIntent?.status === "succeeded") {
      onPaid(paymentIntent.id);
      // parent takes over (books + closes); keep the button disabled meanwhile
    } else {
      onError("Payment did not complete. Please try again.");
      setPaying(false);
    }
  };

  const busy = paying || working;
  return (
    <div className="space-y-4">
      <PaymentElement />
      <button onClick={handlePay} disabled={busy || !stripe}
        className="w-full py-3 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
        {busy
          ? <><svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Processing…</>
          : `Pay £${(totalPence / 100).toFixed(2)}`}
      </button>
    </div>
  );
}

// ── Pay instantly with the card already saved on the profile ──
function PaySavedCardInline({ totalPence, savedCard, working, onPaid, onError, onUseDifferentCard }: {
  totalPence: number; savedCard: SavedCard; working: boolean;
  onPaid: (intentId: string) => void; onError: (msg: string) => void; onUseDifferentCard: () => void;
}) {
  const { user } = useAuth();
  const [paying, setPaying] = useState(false);

  const handlePay = async () => {
    if (!user) return;
    setPaying(true);
    onError("");
    try {
      // Card ids come from the caller's profile server-side now; the session
      // token says who is paying.
      const res = await authedPost("/api/settle-match", {
        items: [{ amountPence: totalPence, sharePence: totalPence, feePence: 0 }],
      });
      const data = await res.json();
      const result = data.results?.[0];
      if (result?.ok) { onPaid(result.paymentIntentId); return; }
      onError(result?.error ?? "Payment failed with your saved card.");
    } catch {
      onError("Could not reach the payment service.");
    }
    setPaying(false);
  };

  const busy = paying || working;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 bg-surface border border-border rounded-btn px-3 py-2.5">
        <div className="w-9 h-9 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2" strokeLinecap="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold capitalize">{savedCard.brand ?? "Card"} •••• {savedCard.last4 ?? "????"}</p>
          <p className="text-[11px] text-accent-ink">Saved card · no need to re-enter details</p>
        </div>
        <button onClick={onUseDifferentCard} disabled={busy} className="text-xs text-text-secondary font-medium flex-shrink-0">Change</button>
      </div>
      <button onClick={handlePay} disabled={busy}
        className="w-full py-3 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
        {busy
          ? <><svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Processing…</>
          : `Pay £${(totalPence / 100).toFixed(2)}`}
      </button>
    </div>
  );
}

// ── Confirm & Pay for a booking ───────────────────────────────
// Captains choose team credit or card; everyone else pays by card only.
// Only the pitch fee is debited from credit; card payments add the 5% fee.
function BookingPaymentModal({ pitch, date, time, isCaptain, teamCreditPence, savedCard, working, error, onCancel, onPayCredit, onCardPaid, onError, onTopUp }: {
  pitch: Pitch; date: string; time: string;
  isCaptain: boolean; teamCreditPence: number | null; savedCard: SavedCard | null;
  working: boolean; error: string | null;
  onCancel: () => void;
  onPayCredit: () => void;
  onCardPaid: (intentId: string) => void;
  onError: (msg: string) => void;
  onTopUp: (shortfallPence: number) => void;
}) {
  const pitchFeePence = Math.round(pitch.price_per_hour * 100);
  const unitrFeePence = Math.round(pitchFeePence * 0.05);
  const cardTotalPence = pitchFeePence + unitrFeePence;
  const creditOk = isCaptain && teamCreditPence !== null && teamCreditPence >= cardTotalPence;
  const shortfallPence = Math.max(0, cardTotalPence - (teamCreditPence ?? 0));

  const [method, setMethod] = useState<"credit" | "card">(creditOk ? "credit" : "card");
  const [useManualEntry, setUseManualEntry] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loadingSecret, setLoadingSecret] = useState(false);

  const showSavedCard = method === "card" && savedCard && !useManualEntry;

  // Lazily create a PaymentIntent the first time manual card entry is needed.
  useEffect(() => {
    if (method !== "card" || showSavedCard || clientSecret || loadingSecret) return;
    setLoadingSecret(true);
    authedPost("/api/create-payment-intent", { amountPence: cardTotalPence })
      .then((r) => r.json())
      .then((d) => { if (d.clientSecret) setClientSecret(d.clientSecret); else onError(d.error ?? "Could not start card payment."); })
      .catch(() => onError("Could not reach the payment service."))
      .finally(() => setLoadingSecret(false));
  }, [method, showSavedCard, clientSecret, loadingSecret, cardTotalPence, onError]);

  const endTime = `${String(Math.min(Number(time.slice(0, 2)) + 1, 23)).padStart(2, "0")}:00`;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-scrim px-4" onClick={() => !working && onCancel()}>
      <div className="w-full max-w-sm bg-surface border border-border rounded-2xl p-6 max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <p className="text-lg font-bold mb-1">Confirm & pay</p>
        <p className="text-sm font-semibold">{pitch.name}</p>
        <p className="text-xs text-text-secondary mb-4">{pitch.address}</p>

        <div className="bg-surface border border-border rounded-btn p-3 mb-4 space-y-1.5 text-xs">
          <div className="flex justify-between"><span className="text-text-secondary">When</span><span className="font-semibold">{fmtDate(date)} · {time}–{endTime}</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">Pitch hire (1hr)</span><span className="font-semibold">£{(pitchFeePence / 100).toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">Unitr fee (5%)</span><span className="font-semibold">£{(unitrFeePence / 100).toFixed(2)}</span></div>
          <div className="flex justify-between border-t border-border pt-1.5 mt-1.5">
            <span className="font-semibold">Total</span>
            <span className="font-bold text-accent-ink">£{(cardTotalPence / 100).toFixed(2)}</span>
          </div>
        </div>

        {/* Payment method — captains pick; others are card-only */}
        {isCaptain ? (
          <div className="mb-4">
            <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-2">Pay with</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setMethod("credit")}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  method === "credit" ? "border-accent bg-accent/10" : "border-border bg-surface-2"
                }`}>
                <p className="text-sm font-semibold">Team credit</p>
                <p className="text-[10px] text-text-secondary mt-0.5">
                  {teamCreditPence === null ? "—" : `£${(teamCreditPence / 100).toFixed(2)} available`}
                </p>
                {!creditOk && teamCreditPence !== null && (
                  <p className="text-[10px] text-red-600 mt-0.5">£{(shortfallPence / 100).toFixed(2)} short</p>
                )}
              </button>
              <button onClick={() => setMethod("card")}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  method === "card" ? "border-accent bg-accent/10" : "border-border bg-surface-2"
                }`}>
                <p className="text-sm font-semibold">Card</p>
                <p className="text-[10px] text-text-secondary mt-0.5">Pay by debit/credit card</p>
              </button>
            </div>
          </div>
        ) : (
          <div className="mb-4 bg-surface border border-border rounded-btn px-3 py-2.5">
            <p className="text-xs font-semibold">Paying by card</p>
            <p className="text-[10px] text-text-secondary mt-0.5">Team credit is available to team captains only.</p>
          </div>
        )}

        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

        {/* Payment action */}
        {method === "credit" && !creditOk ? (
          <div>
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3 py-2.5 mb-3">
              <p className="text-xs font-semibold text-yellow-600 mb-0.5">Not enough team credit</p>
              <p className="text-[11px] text-yellow-200">
                This booking costs £{(cardTotalPence / 100).toFixed(2)} but your team only has £{((teamCreditPence ?? 0) / 100).toFixed(2)}.
                Top up £{(shortfallPence / 100).toFixed(2)} to pay with credit?
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setMethod("card")} className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold text-text-secondary">Pay by card</button>
              <button onClick={() => onTopUp(shortfallPence)} className="flex-1 py-3 rounded-btn bg-accent text-white font-bold text-sm">Top up now</button>
            </div>
          </div>
        ) : method === "credit" ? (
          <div className="flex gap-3">
            <button onClick={onCancel} disabled={working} className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold text-text-secondary disabled:opacity-50">Cancel</button>
            <button onClick={onPayCredit} disabled={working}
              className="flex-1 py-3 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
              {working
                ? <><svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Booking…</>
                : `Pay £${(cardTotalPence / 100).toFixed(2)} with credit`}
            </button>
          </div>
        ) : showSavedCard ? (
          <PaySavedCardInline
            totalPence={cardTotalPence}
            savedCard={savedCard}
            working={working}
            onPaid={onCardPaid}
            onError={onError}
            onUseDifferentCard={() => setUseManualEntry(true)}
          />
        ) : loadingSecret || !clientSecret ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          </div>
        ) : (
          <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "night", variables: { colorPrimary: "#0E7A3C", colorBackground: "#1a1a1a", colorText: "#ffffff", borderRadius: "12px" } } }}>
            <CardBookingForm totalPence={cardTotalPence} working={working} onPaid={onCardPaid} onError={onError} />
          </Elements>
        )}
      </div>
    </div>
  );
}

// ── Booking Confirmed ─────────────────────────────────────────
function BookingConfirmed({ pitch, date, time, posted, onDone }: {
  pitch: Pitch; date: string; time: string; posted: boolean; onDone: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-scrim px-4">
      <div className="w-full max-w-sm bg-surface border border-border rounded-2xl p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center mx-auto mb-4">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <p className="text-lg font-bold mb-1">{posted ? "Pitch Booked & Posted!" : "Pitch Booked!"}</p>
        <p className="text-sm font-semibold mb-0.5">{pitch.name}</p>
        <p className="text-xs text-text-secondary mb-1">{pitch.address}</p>
        <p className="text-xs text-accent-ink font-medium mb-4">{fmtDate(date)} · {time}</p>
        <div className="bg-surface border border-border rounded-btn p-3 mb-5 text-left space-y-1">
          <div className="flex justify-between text-xs"><span className="text-text-secondary">Total (inc. 5% fee)</span><span className="font-bold text-accent-ink">£{(pitch.price_per_hour * 1.05).toFixed(2)}</span></div>
          <p className="text-[10px] text-text-secondary">
            {posted
              ? "Your pitch is secured and the match is live in the Play feed — any team can join straight away."
              : "The venue has been notified and the slot is now reserved."}
          </p>
        </div>
        {posted && (
          <a href="/calendar" className="block w-full py-3 rounded-btn bg-accent text-white font-bold text-sm mb-2">View in Calendar</a>
        )}
        <button onClick={onDone} className={`w-full py-3 rounded-xl font-bold text-sm ${posted ? "bg-surface-2 border border-border text-text-primary" : "bg-accent text-white"}`}>Done</button>
      </div>
    </div>
  );
}

// ── Main Content ──────────────────────────────────────────────
// onDone: fires when the user dismisses the post-booking confirmation screen
// (posted = true if it was auto-posted as a secured match). Lets an embedding
// parent (e.g. a modal on the Create Match page) close itself and navigate.
// onSelectSlot: when provided, the panel becomes a pure picker — tapping an
// available slot hands (pitchId, date, time) back instead of running the
// booking/payment flow. Used by the tournament creator to pick a pitch + slot
// with the same discovery UI, then book a multi-hour block itself.
export default function BookPitchPanel({ initialDate, initialTime, autoPost, onDone, onSelectSlot }: { initialDate?: string; initialTime?: string; autoPost?: boolean; onDone?: (posted: boolean) => void; onSelectSlot?: (pitchId: string, date: string, time: string) => void } = {}) {
  const { user } = useAuth();

  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "map">("list");
  const [bookerName, setBookerName] = useState<string>("");
  // The captain's team — needed to auto-post the booking as a secured match.
  // Present only when the user is a team captain (loaded by captain_id), so it
  // doubles as the "is this user an admin/captain?" flag for payment options.
  const [team, setTeam] = useState<{ id: string; name: string; location: string } | null>(null);
  // Available team credit (balance − reserved), in pence. null = not loaded / no account.
  const [teamCreditPence, setTeamCreditPence] = useState<number | null>(null);
  const isCaptain = team !== null;
  // Card already on file — lets any card payment skip manual entry.
  const [savedCard, setSavedCard] = useState<SavedCard | null>(null);
  const saveCard = useSaveCardOffer(user?.id);

  // Filters — pre-fill from the captain's chosen posting slot when the Book tab
  // is opened via "lock in a pitch first"; otherwise default the date to today
  // so availability shows immediately.
  const [filterDate, setFilterDate] = useState(initialDate || localISO(new Date()));
  const [filterTime, setFilterTime] = useState(initialTime || "");
  const [filterSize, setFilterSize] = useState("All");
  const [filterLocation, setFilterLocation] = useState("");

  // Per-pitch full-day slot status for the chosen date (synced from venue portal DB)
  const [slotMap, setSlotMap] = useState<Record<string, DaySlot[]>>({});
  const [checkingSlots, setCheckingSlots] = useState(false);

  // Booking flow
  const [pendingSlot, setPendingSlot] = useState<{ pitch: Pitch; date: string; time: string } | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookedInfo, setBookedInfo] = useState<{ pitch: Pitch; date: string; time: string; posted: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Shortfall to top up, set when a captain opts to top up from the payment modal.
  const [topUpShortfall, setTopUpShortfall] = useState<number | null>(null);

  const formats = ["All", "5-a-side", "7-a-side", "11-a-side"];
  // Compare on the hour since slots are hourly (TimePicker can return :15/:30/:45)
  const filterHour = filterTime ? `${filterTime.slice(0, 2)}:00` : "";

  const todayStr = new Date().toISOString().split("T")[0];
  const currentHour = new Date().getHours();

  // Fetch real venue-registered pitches only (booking.com-style discovery) —
  // excludes seed/demo pitches with no venue_owner_id since those bookings
  // would never be visible in any venue manager's portal.
  useEffect(() => {
    supabase.from("pitches").select("*")
      .not("venue_owner_id", "is", null)
      .order("rating", { ascending: false })
      .then(({ data }) => { setPitches((data ?? []) as Pitch[]); setLoading(false); });
  }, []);

  // Name to attach to the booking so the venue sees who reserved
  useEffect(() => {
    if (!user) return;
    async function loadName() {
      const { data: ownTeam } = await supabase.from("teams").select("id, name, location").eq("captain_id", user!.id).maybeSingle();
      if (ownTeam?.name) {
        setTeam(ownTeam);
        setBookerName(ownTeam.name);
        // Load the team pot so the captain can choose to pay from credit.
        const { data: credit } = await supabase.from("team_credits")
          .select("balance_pence, reserved_pence").eq("team_id", ownTeam.id).maybeSingle();
        setTeamCreditPence(credit ? credit.balance_pence - (credit.reserved_pence ?? 0) : 0);
      } else {
        const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user!.id).maybeSingle();
        setBookerName((profile as { full_name?: string } | null)?.full_name ?? "Session booking");
      }
    }
    loadName();
  }, [user]);

  // Card already on file (from a previous match/booking payment) — reuse it so
  // any card payment on this screen can skip Stripe Elements' manual entry.
  useEffect(() => {
    if (!user) return;
    supabase.from("profiles")
      .select("stripe_customer_id, stripe_payment_method_id, card_brand, card_last4")
      .eq("id", user.id).maybeSingle()
      .then(({ data: profile }) => {
        if (profile?.stripe_customer_id && profile?.stripe_payment_method_id) {
          setSavedCard({
            customerId: profile.stripe_customer_id as string,
            paymentMethodId: profile.stripe_payment_method_id as string,
            brand: (profile.card_brand as string | null) ?? null,
            last4: (profile.card_last4 as string | null) ?? null,
          });
        }
      });
  }, [user]);

  // Build the full-day slot grid per pitch for the selected date.
  // Reads availability + bookings + blocks straight from the venue portal tables.
  useEffect(() => {
    if (!filterDate || pitches.length === 0) { setSlotMap({}); return; }
    setCheckingSlots(true);
    const pitchIds = pitches.map((p) => p.id);
    const dayOfWeek = new Date(filterDate + "T12:00:00").getDay();

    Promise.all([
      supabase.from("pitch_availability")
        .select("pitch_id, open_time, close_time, is_active")
        .in("pitch_id", pitchIds).eq("day_of_week", dayOfWeek),
      supabase.from("pitch_bookings")
        .select("pitch_id, start_time, end_time").in("pitch_id", pitchIds).eq("match_date", filterDate).neq("status", "cancelled"),
      supabase.from("pitch_blocks")
        .select("pitch_id, start_time, end_time").in("pitch_id", pitchIds).eq("block_date", filterDate),
    ]).then(([{ data: avails }, { data: bookings }, { data: blocks }]) => {
      const map: Record<string, DaySlot[]> = {};
      for (const pitch of pitches) {
        const avail = avails?.find((a) => a.pitch_id === pitch.id);
        // No explicit availability row → fall back to default open hours (venue portal default)
        if (avail && !avail.is_active) {
          map[pitch.id] = ALL_HOURS.map((t) => ({ time: t, status: "closed" as SlotStatus }));
          continue;
        }
        const oh = avail ? Number(avail.open_time.split(":")[0]) : DEFAULT_OPEN;
        const ch = avail ? Number(avail.close_time.split(":")[0]) : DEFAULT_CLOSE;

        // Hours taken by bookings or blocks. An hourly slot H (H:00–H+1:00) is
        // taken if any booking/block overlaps it — so a part-hour booking like
        // 18:30–19:30 correctly blocks BOTH the 18:00 and 19:00 slots.
        const taken = new Set<string>();
        const pitchBookings = (bookings ?? []).filter((b) => b.pitch_id === pitch.id);
        const pitchBlocks = (blocks ?? []).filter((b) => b.pitch_id === pitch.id);
        const wholeDayBlocked = pitchBlocks.some((b) => !b.start_time);
        const toMins = (t: string) => {
          const [hh, mm] = t.split(":");
          return Number(hh) * 60 + (Number(mm) || 0);
        };
        for (const b of [...pitchBookings, ...pitchBlocks]) {
          if (!b.start_time) continue;
          const startMins = toMins(b.start_time);
          const endMins = b.end_time ? toMins(b.end_time) : startMins + 60;
          const firstHour = Math.floor(startMins / 60);
          const lastHour = Math.ceil(endMins / 60); // exclusive
          for (let h = firstHour; h < lastHour; h++) taken.add(`${String(h).padStart(2, "0")}:00`);
        }

        map[pitch.id] = ALL_HOURS.map((t) => {
          const h = Number(t.split(":")[0]);
          if (wholeDayBlocked || h < oh || h >= ch) return { time: t, status: "closed" as SlotStatus };
          if (taken.has(t)) return { time: t, status: "booked" as SlotStatus };
          return { time: t, status: "available" as SlotStatus };
        });
      }
      setSlotMap(map);
      setCheckingSlots(false);
    });
  }, [filterDate, pitches]);

  const isAvailableAt = (pitchId: string, time: string) =>
    (slotMap[pitchId] ?? []).some((s) => s.time === time && s.status === "available");

  const anyFilter = Boolean(filterTime || filterSize !== "All" || filterLocation.trim());

  const filteredPitches = useMemo(() => {
    const q = filterLocation.trim().toLowerCase();
    return pitches.filter((p) => {
      if (filterSize !== "All" && !p.formats.includes(filterSize)) return false;
      if (q && !(`${p.name} ${p.address}`.toLowerCase().includes(q))) return false;
      // Time set → only surface pitches free at that hour on the chosen date
      if (filterHour && !checkingSlots && slotMap[p.id] && !isAvailableAt(p.id, filterHour)) return false;
      return true;
    });
  }, [pitches, filterSize, filterLocation, filterHour, slotMap, checkingSlots]);

  const clearFilters = () => {
    setFilterTime(""); setFilterSize("All"); setFilterLocation("");
    setFilterDate(localISO(new Date()));
  };

  // Finalise a booking after the chosen payment succeeds.
  //   method "credit" — captain pays the pitch fee from the team pot (no 5%).
  //   method "card"    — card already charged (intentId set); records the payment.
  // Writes to pitch_bookings so the venue portal sees it, then pays the venue.
  const completeBooking = async (method: "credit" | "card", intentId?: string) => {
    if (!pendingSlot) return;
    const { pitch, date, time } = pendingSlot;
    if (!user) { setError("You must be signed in to book."); setPendingSlot(null); return; }
    setBooking(true);
    setError(null);

    const h = Number(time.split(":")[0]);
    const endTime = `${String(Math.min(h + 1, 23)).padStart(2, "0")}:00`;
    const pitchFeePence = Math.round(pitch.price_per_hour * 100);   // what the venue receives
    const unitrFeePence = Math.round(pitchFeePence * 0.05);

    const { data: bookingRow, error: bookingErr } = await supabase.from("pitch_bookings").insert({
      pitch_id: pitch.id,
      booked_by: user.id,
      match_date: date,
      start_time: time,
      end_time: endTime,
      booker_name: bookerName || "Session booking",
      booking_type: "platform",
      total_price_pence: pitchFeePence,
      player_count: 0,
      per_player_pence: 0,
      unitr_fee_pence: unitrFeePence,
      status: "confirmed",
      // Credit is debited just below; card was already charged upstream.
      payment_status: method === "card" ? "paid" : "pending",
      stripe_payment_intent_id: intentId ?? null,
    }).select("id").single();

    if (bookingErr || !bookingRow) { setBooking(false); setError("Couldn't complete the booking. Please try again."); setPendingSlot(null); return; }

    // ── Collect payment ──
    if (method === "credit") {
      if (!team) { setBooking(false); setError("Only team captains can pay with credit."); return; }
      const res = await authedPost("/api/book/pay-credit", {
        teamId: team.id, feePence: pitchFeePence + unitrFeePence, bookingId: bookingRow.id,
      }).catch(() => null);
      const d = res ? await res.json().catch(() => null) : null;
      if (!res || !res.ok || !d?.ok) {
        // Roll the booking back so we never hold a slot without payment.
        await supabase.from("pitch_bookings").update({ status: "cancelled", payment_status: "failed" }).eq("id", bookingRow.id);
        setBooking(false);
        setError(d?.error === "INSUFFICIENT_CREDIT" ? "Not enough team credit. Top up in My Team." : (d?.error ?? "Couldn't debit team credit."));
        return;
      }
      if (typeof d.newBalancePence === "number") setTeamCreditPence(d.newBalancePence);
    } else {
      // Card path: record the per-payment row so finance/reporting sees the charge.
      await supabase.from("player_payments").insert({
        booking_id: bookingRow.id,
        player_id: user.id,
        amount_pence: pitchFeePence,
        unitr_fee_pence: unitrFeePence,
        total_pence: pitchFeePence + unitrFeePence,
        status: "paid",
        purpose: "individual",
        stripe_payment_intent_id: intentId ?? null,
      });
    }

    // Cash side: pay the venue its pitch fee (Stripe Connect, test mode). Every
    // paid booking produces exactly one venue_transfers row so in-app payments
    // reconcile against real payouts. Best-effort: an unconnected venue or empty
    // test balance is recorded as a failed transfer and must not block booking.
    authedPost("/api/connect/venue-transfer", {
      pitchId: pitch.id,
      bookingId: bookingRow.id,
      teamId: team?.id ?? null,
      amountPence: pitchFeePence,
    }).catch(() => {});

    // If the captain came from "lock in a pitch first", their intent was to post
    // a match — so turn this fresh booking straight into a secured match post
    // (pitch already paid for, opponents can join immediately) instead of making
    // them convert it manually from My Bookings.
    let posted = false;
    if (autoPost && team && bookingRow?.id) {
      const pitchOption = {
        id: pitch.id,
        name: pitch.name,
        address: pitch.address,
        price: pitch.price_per_hour,
        format: pitch.formats[0] ?? "5-a-side",
        distance: "",
        time,
      };
      const { data: post } = await supabase.from("match_posts").insert({
        team_id: team.id,
        captain_id: user.id,
        team_name: team.name,
        team_location: team.location ?? "",
        match_date: date,
        match_time: time,
        day_name: getDayName(date),
        pitch_options: [pitchOption],
        description: null,
        status: "open",
        payment_mode: "secured",
        hold_pence: 0,
        pitch_secured: true,
        secured_booking_id: bookingRow.id,
      }).select("id").single();
      if (post) {
        await supabase.from("pitch_bookings").update({ post_id: post.id }).eq("id", bookingRow.id);
        posted = true;
      }
    }

    setBooking(false);
    // Reflect the new booking locally so the slot flips to "taken" instantly
    setSlotMap((prev) => prev[pitch.id]
      ? { ...prev, [pitch.id]: prev[pitch.id].map((s) => s.time === time ? { ...s, status: "booked" } : s) }
      : prev);
    setPendingSlot(null);
    // Card path only: offer to keep the card before the confirmation screen.
    // The credit path never touched one. `offer` falls straight through for
    // anyone who already has a card saved.
    saveCard.offer(method === "card" ? intentId : null, () => {
      setBookedInfo({ pitch, date, time, posted });
    });
  };

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 mb-4">
        <div className="flex-1">
          <h2 className="text-xl font-extrabold">Book a Pitch</h2>
          <p className="text-xs text-text-secondary">Reserve a venue for training, friendlies or a kickabout</p>
        </div>
        <div className="flex bg-surface border border-border rounded-btn p-1">
          {(["list", "map"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${view === v ? "bg-accent text-white" : "text-text-secondary"}`}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Filters — apply live as you change them */}
      <div className="mx-4 mb-4 bg-surface border border-border shadow-card rounded-card p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold">Filter pitches</p>
          {anyFilter && (
            <button onClick={clearFilters} className="text-xs text-accent-ink font-medium">Clear all</button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-text-secondary">Date</label>
            <DatePicker value={filterDate} onChange={setFilterDate} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-text-secondary">Time <span className="opacity-60">(optional)</span></label>
            <TimePicker value={filterTime} selectedDate={filterDate} onChange={setFilterTime} />
          </div>
        </div>
        <div className="flex flex-col gap-1 mb-3">
          <label className="text-xs text-text-secondary">Location</label>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            <input type="search" value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)}
              placeholder="Area, postcode or venue name"
              className="w-full bg-background border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/50" />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-text-secondary">Pitch size</label>
          <div className="flex gap-2 overflow-x-auto pb-0.5">
            {formats.map((f) => (
              <button key={f} onClick={() => setFilterSize(f)}
                className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${filterSize === f ? "bg-accent text-white border-accent" : "bg-background text-text-secondary border-border"}`}>
                {f}
              </button>
            ))}
          </div>
        </div>
        {filterTime && (
          <p className="text-[11px] text-accent-ink mt-3">Showing pitches free at {filterHour} on {fmtDate(filterDate)}.</p>
        )}
        {filterDate && filterTime && (() => {
          const dt = new Date(filterDate + "T" + filterTime);
          const diff = dt.getTime() - Date.now();
          return diff > 0 && diff < 86400000;
        })() && (
          <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3 py-2.5 mt-3">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#EAB308" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0 mt-0.5">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <p className="text-xs text-yellow-600">You have selected a time less than 24 hours from now. The team credits will not be reimbursed if you cannot find an opponent.</p>
          </div>
        )}
      </div>

      <div className="px-4 mb-3 flex items-center justify-between">
        <p className="text-xs text-text-secondary">
          {anyFilter ? `${filteredPitches.length} match${filteredPitches.length !== 1 ? "es" : ""}` : "Pitches near you"}
        </p>
        <p className="text-[11px] text-accent-ink font-medium">{fmtDate(filterDate)}{filterTime ? ` · ${filterHour}` : ""}</p>
      </div>

      {error && (
        <div className="mx-4 mb-3 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        </div>
      ) : view === "map" ? (
        <div className="px-4 mb-4">
          <PitchMap
            pitches={filteredPitches}
            pickedPitches={[]}
            onSelect={(p) => {
              const free = (slotMap[p.id] ?? []).find((s) => s.status === "available");
              if (!free) return;
              const time = filterHour && isAvailableAt(p.id, filterHour) ? filterHour : free.time;
              if (onSelectSlot) onSelectSlot(p.id, filterDate, time);
              else setPendingSlot({ pitch: p, date: filterDate, time });
            }}
            selectMode={false}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4 px-4">
          {filteredPitches.length === 0 ? (
            <div className="bg-surface border border-border shadow-card rounded-card px-4 py-10 text-center">
              <p className="text-sm text-text-secondary">No pitches match your filters.</p>
              <button onClick={clearFilters} className="text-xs text-accent-ink font-medium mt-2">Clear filters</button>
            </div>
          ) : filteredPitches.map((pitch) => {
            const slots = slotMap[pitch.id];
            const freeCount = (slots ?? []).filter((s) => s.status === "available").length;
            return (
              <div key={pitch.id} className="bg-surface border border-border shadow-card rounded-card overflow-hidden">
                {/* Pitch image placeholder */}
                <div className="w-full h-24 relative flex items-center justify-center bg-gradient-to-br from-green-900 to-green-700">
                  <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 20px,rgba(255,255,255,.1) 20px,rgba(255,255,255,.1) 21px),repeating-linear-gradient(90deg,transparent,transparent 40px,rgba(255,255,255,.1) 40px,rgba(255,255,255,.1) 41px)" }} />
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><path d="M2 12h20M12 2v20"/></svg>
                  {pitch.is_verified && (
                    <div className="absolute top-2 left-2 bg-accent/80 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><polyline points="20 6 9 17 4 12"/></svg>
                      Verified
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between mb-1">
                    <p className="font-semibold text-sm pr-8">{pitch.name}</p>
                    <div className="text-right flex-shrink-0">
                      <span className="text-lg font-bold text-accent-ink">£{(pitch.price_per_hour * 1.05).toFixed(2)}</span>
                      <p className="text-[10px] text-text-secondary">per hour</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-text-secondary mb-2">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    {pitch.address}
                  </div>
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <Stars rating={pitch.rating} />
                    {pitch.surfaces.map((s) => <span key={s} className="text-xs bg-surface border border-border px-2 py-0.5 rounded-md">{s}</span>)}
                    {pitch.formats.map((f) => <span key={f} className="text-xs bg-surface border border-border px-2 py-0.5 rounded-md">{f}</span>)}
                  </div>

                  {/* Whole-day availability grid for the chosen date */}
                  <div className="bg-background border border-border rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Availability · {fmtDate(filterDate)}</p>
                      {slots && <span className="text-[10px] font-semibold text-accent-ink">{freeCount} slot{freeCount !== 1 ? "s" : ""} free</span>}
                    </div>
                    {checkingSlots || !slots ? (
                      <div className="flex items-center gap-1.5 py-2">
                        <div className="w-3 h-3 rounded-full border border-accent border-t-transparent animate-spin" />
                        <span className="text-[10px] text-text-secondary">Checking availability…</span>
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-4 gap-1.5 mb-2">
                          {slots.map(({ time, status }) => {
                            const slotHour = parseInt(time.split(":")[0], 10);
                            const isPast = filterDate === todayStr && slotHour <= currentHour;
                            const isTaken = status !== "available";
                            const isDisabled = isTaken || isPast;
                            const isFilterMatch = filterHour === time;
                            return (
                              <button key={time}
                                disabled={isDisabled}
                                onClick={() => onSelectSlot ? onSelectSlot(pitch.id, filterDate, time) : setPendingSlot({ pitch, date: filterDate, time })}
                                className={`py-2 rounded-lg text-[12px] font-medium transition-colors ${
                                  isPast
                                    ? "text-text-secondary/25 cursor-not-allowed"
                                    : isTaken
                                      ? "line-through text-text-secondary/30 cursor-not-allowed"
                                      : isFilterMatch
                                        ? "bg-accent text-white"
                                        : "border border-white/20 text-text-primary hover:border-accent hover:text-accent-ink"
                                }`}>
                                {time}
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-text-secondary">
                          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded border border-white/20 inline-block" />Available</span>
                          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-surface-2 inline-block opacity-40" />Taken / Closed</span>
                        </div>
                        {freeCount === 0 && (
                          <p className="text-[11px] text-red-600 mt-2">Fully booked on this date — try another day.</p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirm & pay */}
      {pendingSlot && (
        <BookingPaymentModal
          pitch={pendingSlot.pitch}
          date={pendingSlot.date}
          time={pendingSlot.time}
          isCaptain={isCaptain}
          teamCreditPence={teamCreditPence}
          savedCard={savedCard}
          working={booking}
          error={error}
          onCancel={() => { if (!booking) { setPendingSlot(null); setError(null); } }}
          onPayCredit={() => completeBooking("credit")}
          onCardPaid={(intentId) => completeBooking("card", intentId)}
          onError={(msg) => setError(msg || null)}
          onTopUp={(shortfallPence) => setTopUpShortfall(shortfallPence)}
        />
      )}

      {/* Top up team credit mid-booking — the payment modal stays mounted behind
          it so the captain lands back on Confirm & pay with the new balance. */}
      {topUpShortfall !== null && team && user && (
        <TopUpModal
          teamId={team.id}
          userId={user.id}
          currentPence={teamCreditPence ?? 0}
          suggestedPence={topUpShortfall}
          onClose={() => setTopUpShortfall(null)}
          onSuccess={async () => {
            const { data: credit } = await supabase.from("team_credits")
              .select("balance_pence, reserved_pence").eq("team_id", team.id).maybeSingle();
            setTeamCreditPence(credit ? credit.balance_pence - (credit.reserved_pence ?? 0) : 0);
            setTopUpShortfall(null);
          }}
        />
      )}

      {/* Booking confirmed */}
      {bookedInfo && (
        <BookingConfirmed
          pitch={bookedInfo.pitch}
          date={bookedInfo.date}
          time={bookedInfo.time}
          posted={bookedInfo.posted}
          onDone={() => { const posted = bookedInfo.posted; setBookedInfo(null); onDone?.(posted); }}
        />
      )}

      {saveCard.prompt}
    </div>
  );
}
