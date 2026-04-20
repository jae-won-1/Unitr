"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";

type Pitch = {
  id: string;
  name: string;
  address: string;
  location: string;
  price: number;
  format: string;
  surface: string;
  amenities: string[];
  distance: string;
  rating: number;
  x: string;
  y: string;
};

const pitches: Pitch[] = [
  { id: "p1", name: "Powerleague Finsbury Park", address: "223 Seven Sisters Rd, London N4 2DA", location: "North London", price: 80, format: "7-a-side", surface: "3G", amenities: ["Changing rooms", "Parking", "Floodlights"], distance: "1.2 miles", rating: 4.8, x: "38%", y: "30%" },
  { id: "p2", name: "Hackney Marshes Pitch 3", address: "Homerton Rd, London E9 5PF", location: "East London", price: 60, format: "11-a-side", surface: "Grass", amenities: ["Parking", "Floodlights"], distance: "2.4 miles", rating: 4.5, x: "62%", y: "52%" },
  { id: "p3", name: "Goals Walthamstow", address: "Higham Hill Rd, London E17 6EA", location: "North East London", price: 95, format: "5-a-side", surface: "3G", amenities: ["Changing rooms", "Café", "Parking", "Floodlights"], distance: "3.8 miles", rating: 4.9, x: "72%", y: "22%" },
  { id: "p4", name: "Powerleague Shoreditch", address: "Old St, London EC1V 9HL", location: "Central London", price: 110, format: "5-a-side", surface: "3G", amenities: ["Changing rooms", "Bar", "Floodlights"], distance: "4.1 miles", rating: 4.7, x: "28%", y: "65%" },
  { id: "p5", name: "Victoria Park Arena", address: "Grove Rd, London E3 5TB", location: "East London", price: 75, format: "7-a-side", surface: "3G", amenities: ["Changing rooms", "Parking"], distance: "3.0 miles", rating: 4.6, x: "55%", y: "70%" },
];

const timeSlots = ["10:00", "12:00", "14:00", "16:00", "18:00", "20:00"];
const teamCredit = 346.82;

const calendarDays = [
  { day: "Sat", date: "15", month: "Feb" },
  { day: "Sun", date: "16", month: "Feb" },
  { day: "Sat", date: "22", month: "Feb" },
  { day: "Sun", date: "23", month: "Feb" },
  { day: "Sat", date: "01", month: "Mar" },
];

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs font-bold text-yellow-400">{rating}</span>
      {[1,2,3,4,5].map((i) => (
        <svg key={i} width="10" height="10" viewBox="0 0 24 24" fill={i <= Math.round(rating) ? "#FACC15" : "none"} stroke="#FACC15" strokeWidth="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
    </div>
  );
}

function PitchCard({ pitch, onSelect, selectMode }: { pitch: Pitch; onSelect: (p: Pitch) => void; selectMode: boolean }) {
  return (
    <div className="bg-surface-2 border border-border rounded-2xl overflow-hidden">
      <div className="w-full h-28 bg-gradient-to-br from-green-900 to-green-700 relative flex items-center justify-center">
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 20px, rgba(255,255,255,0.1) 20px, rgba(255,255,255,0.1) 21px), repeating-linear-gradient(90deg, transparent, transparent 40px, rgba(255,255,255,0.1) 40px, rgba(255,255,255,0.1) 41px)" }} />
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1">
          <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><path d="M2 12h20M12 2v20"/>
        </svg>
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between mb-1">
          <p className="font-semibold text-sm">{pitch.name}</p>
          <div className="text-right flex-shrink-0 ml-2">
            <span className="text-lg font-bold text-accent">£{pitch.price}</span>
            <p className="text-[10px] text-text-secondary">per hour</p>
          </div>
        </div>
        <div className="flex items-center gap-1 text-xs text-text-secondary mb-2">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          {pitch.location} · {pitch.distance}
        </div>
        <Stars rating={pitch.rating} />
        <div className="flex items-center gap-2 mt-2 mb-3">
          <span className="text-xs bg-surface border border-border px-2 py-0.5 rounded-md font-medium">{pitch.surface}</span>
          <span className="text-xs bg-surface border border-border px-2 py-0.5 rounded-md font-medium">{pitch.format}</span>
        </div>
        <div className="flex flex-wrap gap-1 mb-4">
          {pitch.amenities.map((a) => (
            <span key={a} className="text-[10px] text-text-secondary flex items-center gap-0.5">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
              {a}
            </span>
          ))}
        </div>
        <button
          onClick={() => onSelect(pitch)}
          className="w-full py-2.5 rounded-xl bg-accent text-black font-bold text-sm"
        >
          {selectMode ? "Add as Option" : "Select This Pitch"}
        </button>
      </div>
    </div>
  );
}

function BookingPanel({ pitch, onClose, onBook }: { pitch: Pitch; onClose: () => void; onBook: () => void }) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const splitCost = (pitch.price / 11).toFixed(2);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-t-2xl overflow-y-auto max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <p className="font-bold text-gray-900">Selected Pitch</p>
            <p className="text-sm text-gray-600">{pitch.name}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <p className="text-sm text-gray-500">{pitch.address}</p>
          <div className="text-right">
            <p className="text-lg font-bold text-green-600">£{pitch.price}/hr</p>
            <p className="text-xs text-gray-500">Team Credit: £{teamCredit}</p>
          </div>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <p className="text-sm font-bold text-gray-900 mb-3">Select Date</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {calendarDays.map((d) => (
                <button
                  key={d.date + d.month}
                  onClick={() => setSelectedDay(d.date + d.month)}
                  className={`flex-shrink-0 w-16 h-20 rounded-xl border flex flex-col items-center justify-center gap-0.5 transition-colors ${
                    selectedDay === d.date + d.month ? "border-green-500 bg-green-50" : "border-gray-200 bg-white"
                  }`}
                >
                  <span className={`text-xs font-medium ${selectedDay === d.date + d.month ? "text-green-600" : "text-gray-500"}`}>{d.day}</span>
                  <span className={`text-2xl font-bold leading-none ${selectedDay === d.date + d.month ? "text-green-700" : "text-gray-800"}`}>{d.date}</span>
                  <span className={`text-xs font-medium ${selectedDay === d.date + d.month ? "text-green-600" : "text-gray-500"}`}>{d.month}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-bold text-gray-900 mb-3">Select Time</p>
            <div className="grid grid-cols-3 gap-2">
              {timeSlots.map((t) => (
                <button
                  key={t}
                  onClick={() => setSelectedTime(t)}
                  className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                    selectedTime === t ? "border-green-500 bg-green-50 text-green-700" : "border-gray-200 text-gray-700"
                  }`}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
            <p className="text-xs font-semibold text-gray-700 mb-1">Payment</p>
            <p className="text-xs text-gray-500">
              Pitch fee of <span className="font-semibold text-gray-700">£{pitch.price}/hr</span> will be split automatically across all confirmed players — approx. <span className="font-semibold text-green-600">£{splitCost}/player</span>. Payment is taken 3 hours after match confirmation.
            </p>
          </div>

          <button
            onClick={onBook}
            disabled={!selectedDay || !selectedTime}
            className="w-full py-3 rounded-xl bg-green-600 text-white font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Book
          </button>
        </div>
      </div>
    </div>
  );
}

function BookingConfirmed({ pitch, onDone }: { pitch: Pitch; onDone: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <p className="text-lg font-bold text-gray-900 mb-1">Pitch Booked!</p>
        <p className="text-sm text-gray-500 mb-1">{pitch.name}</p>
        <p className="text-xs text-gray-400 mb-5">{pitch.address}</p>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 mb-5 text-left">
          <p className="text-xs text-gray-500">
            Each player will be charged <span className="font-semibold text-gray-700">£{(pitch.price / 11).toFixed(2)}</span> automatically 3 hours after the match is confirmed. Payment method: Stripe split payments.
          </p>
        </div>
        <button onClick={onDone} className="w-full py-3 rounded-xl bg-green-600 text-white font-bold text-sm">
          Back to Create Match
        </button>
      </div>
    </div>
  );
}

function PitchesContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectMode = searchParams.get("mode") === "select";

  const [view, setView] = useState<"map" | "list">("map");
  const [selectedPitch, setSelectedPitch] = useState<Pitch | null>(null);
  const [showBooking, setShowBooking] = useState(false);
  const [booked, setBooked] = useState(false);
  const [mapSelected, setMapSelected] = useState<Pitch | null>(null);
  const [filterFormat, setFilterFormat] = useState("All");
  const [addedId, setAddedId] = useState<string | null>(null);

  const formats = ["All", "5-a-side", "7-a-side", "11-a-side"];
  const filteredPitches = filterFormat === "All" ? pitches : pitches.filter((p) => p.format === filterFormat);

  const handleSelect = (pitch: Pitch) => {
    if (selectMode) {
      localStorage.setItem("unitr_pitch_selection", JSON.stringify({
        id: pitch.id,
        name: pitch.name,
        address: pitch.address,
        price: pitch.price,
        format: pitch.format,
        distance: pitch.distance,
      }));
      setAddedId(pitch.id);
      setTimeout(() => router.push("/play/create"), 800);
    } else {
      setSelectedPitch(pitch);
      setShowBooking(true);
    }
  };

  const handleBook = () => {
    setShowBooking(false);
    setBooked(true);
  };

  return (
    <div className="flex flex-col min-h-screen pt-12">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 mb-4">
        <a href="/play/create">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </a>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Find a Pitch</h1>
          <p className="text-xs text-text-secondary">
            {selectMode ? "Select pitch options for your match post" : "Book a venue for your match"}
          </p>
        </div>
        {selectMode && (
          <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/30 px-2 py-1 rounded-full">Select Mode</span>
        )}
        {!selectMode && (
          <div className="flex bg-surface-2 border border-border rounded-xl p-1">
            {(["map", "list"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${view === v ? "bg-accent text-black" : "text-text-secondary"}`}
              >
                {v === "map" ? (
                  <span className="flex items-center gap-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    Map
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                    List
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Select mode banner */}
      {selectMode && (
        <div className="mx-4 mb-4 bg-accent/10 border border-accent/30 rounded-xl px-4 py-3">
          <p className="text-xs text-accent font-medium">Tap a pitch to add it as an option on your match post. You can add up to 3 options.</p>
        </div>
      )}

      {/* ── MAP VIEW (also default for select mode) ── */}
      {(view === "map" || selectMode) && (
        <div className="flex flex-col flex-1">
          <div className="relative mx-4 rounded-2xl overflow-hidden border border-border" style={{ height: "300px", background: "linear-gradient(135deg, #e8f0e8 0%, #d4e4d0 30%, #e8ead8 60%, #dce8dc 100%)" }}>
            <svg className="absolute inset-0 w-full h-full opacity-30" viewBox="0 0 400 300" preserveAspectRatio="none">
              <line x1="0" y1="150" x2="400" y2="150" stroke="#ccc" strokeWidth="3"/>
              <line x1="200" y1="0" x2="200" y2="300" stroke="#ccc" strokeWidth="3"/>
              <line x1="0" y1="75" x2="400" y2="90" stroke="#ccc" strokeWidth="2"/>
              <line x1="0" y1="225" x2="400" y2="210" stroke="#ccc" strokeWidth="2"/>
              <line x1="130" y1="0" x2="110" y2="300" stroke="#ccc" strokeWidth="2"/>
              <line x1="290" y1="0" x2="310" y2="300" stroke="#ccc" strokeWidth="2"/>
            </svg>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-40">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="1.5" strokeLinecap="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
            </div>
            {pitches.map((pitch) => (
              <button
                key={pitch.id}
                onClick={() => setMapSelected(mapSelected?.id === pitch.id ? null : pitch)}
                className="absolute -translate-x-1/2 -translate-y-full"
                style={{ left: pitch.x, top: pitch.y }}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-transform ${mapSelected?.id === pitch.id ? "scale-125 bg-accent" : "bg-green-700"} hover:scale-110`}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                  </svg>
                </div>
              </button>
            ))}
          </div>

          {mapSelected && (
            <div className="mx-4 mt-3 bg-surface-2 border border-border rounded-2xl overflow-hidden">
              <div className="w-full h-20 bg-gradient-to-br from-green-900 to-green-700 relative flex items-center justify-center">
                <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 20px, rgba(255,255,255,0.1) 20px, rgba(255,255,255,0.1) 21px)" }} />
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between mb-1">
                  <p className="font-semibold">{mapSelected.name}</p>
                  <div className="text-right">
                    <span className="text-lg font-bold text-accent">£{mapSelected.price}</span>
                    <p className="text-[10px] text-text-secondary">per hour</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-xs text-text-secondary mb-2">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                  {mapSelected.location} · {mapSelected.distance}
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs bg-surface border border-border text-text-secondary px-2 py-0.5 rounded-md font-medium">{mapSelected.surface}</span>
                  <span className="text-xs bg-surface border border-border text-text-secondary px-2 py-0.5 rounded-md font-medium">{mapSelected.format}</span>
                </div>
                <button
                  onClick={() => handleSelect(mapSelected)}
                  className={`w-full py-2.5 rounded-xl font-bold text-sm transition-colors ${addedId === mapSelected.id ? "bg-accent/20 text-accent border border-accent/40" : "bg-accent text-black"}`}
                >
                  {addedId === mapSelected.id ? "Added ✓" : selectMode ? "Add as Option" : "Select This Pitch"}
                </button>
              </div>
            </div>
          )}

          {/* Show list below map in select mode */}
          {selectMode && (
            <div className="flex flex-col gap-4 px-4 mt-4">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">All Pitches</p>
              {pitches.map((pitch) => (
                <div key={pitch.id} className={`bg-surface-2 border rounded-2xl p-4 transition-colors ${addedId === pitch.id ? "border-accent/40" : "border-border"}`}>
                  <div className="flex items-start justify-between mb-1">
                    <p className="font-semibold text-sm">{pitch.name}</p>
                    <div className="text-right flex-shrink-0 ml-2">
                      <span className="text-base font-bold text-accent">£{pitch.price}</span>
                      <p className="text-[10px] text-text-secondary">per hour</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-text-secondary mb-2">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    {pitch.location} · {pitch.distance}
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs bg-surface border border-border px-2 py-0.5 rounded-md font-medium">{pitch.surface}</span>
                    <span className="text-xs bg-surface border border-border px-2 py-0.5 rounded-md font-medium">{pitch.format}</span>
                  </div>
                  <button
                    onClick={() => handleSelect(pitch)}
                    className={`w-full py-2.5 rounded-xl font-bold text-sm transition-colors ${addedId === pitch.id ? "bg-accent/20 text-accent border border-accent/40" : "bg-accent text-black"}`}
                  >
                    {addedId === pitch.id ? "Added ✓" : "Add as Option"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── LIST VIEW (normal mode only) ── */}
      {view === "list" && !selectMode && (
        <div className="flex flex-col gap-4 px-4">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {formats.map((f) => (
              <button
                key={f}
                onClick={() => setFilterFormat(f)}
                className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${filterFormat === f ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="space-y-4">
            {filteredPitches.map((pitch) => (
              <PitchCard key={pitch.id} pitch={pitch} onSelect={handleSelect} selectMode={false} />
            ))}
          </div>
        </div>
      )}

      {showBooking && selectedPitch && (
        <BookingPanel pitch={selectedPitch} onClose={() => setShowBooking(false)} onBook={handleBook} />
      )}

      {booked && selectedPitch && (
        <BookingConfirmed pitch={selectedPitch} onDone={() => { setBooked(false); window.history.back(); }} />
      )}
    </div>
  );
}

export default function PitchesPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><p className="text-text-secondary text-sm">Loading...</p></div>}>
      <PitchesContent />
    </Suspense>
  );
}
