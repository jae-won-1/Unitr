"use client";

import { useState } from "react";
import { useRole } from "@/contexts/RoleContext";

type MatchTab = "matches" | "tournaments" | "ringer";

type PitchOption = {
  id: string;
  name: string;
  address: string;
  price: number;
  format: string;
  distance: string;
};

type MatchPost = {
  id: string;
  team: string;
  versus: string;
  location: string;
  distance: string;
  rating: number;
  members: number;
  date: string;
  pitchOptions: PitchOption[];
  description: string;
  availabilityMatch: boolean;
};

const matchPosts: MatchPost[] = [
  {
    id: "post-1", team: "Hackney Rovers", versus: "Opponent TBC", location: "North London", distance: "1.8 miles",
    rating: 4.7, members: 9, date: "Sat, 15 Feb 2026 · 14:00",
    pitchOptions: [
      { id: "p1", name: "Powerleague Finsbury Park", address: "223 Seven Sisters Rd", price: 80, format: "7-a-side", distance: "1.2 miles" },
      { id: "p2", name: "Hackney Marshes Pitch 3", address: "Homerton Rd", price: 60, format: "11-a-side", distance: "2.4 miles" },
    ],
    description: "Competitive 7-a-side looking for a good match. We play 4-3-3, high press.",
    availabilityMatch: true,
  },
  {
    id: "post-2", team: "East End FC", versus: "Opponent TBC", location: "Victoria Park", distance: "2.1 miles",
    rating: 4.6, members: 8, date: "Sun, 16 Feb 2026 · 11:00",
    pitchOptions: [
      { id: "p5", name: "Victoria Park Arena", address: "Grove Rd, London E3", price: 75, format: "7-a-side", distance: "3.0 miles" },
    ],
    description: "Friendly 7-a-side. All skill levels welcome. Good vibes only.",
    availabilityMatch: true,
  },
  {
    id: "post-3", team: "Shoreditch Rovers", versus: "Opponent TBC", location: "Shoreditch", distance: "3.4 miles",
    rating: 4.9, members: 11, date: "Sat, 22 Feb 2026 · 10:00",
    pitchOptions: [
      { id: "p4", name: "Powerleague Shoreditch", address: "Old St, London EC1V", price: 110, format: "5-a-side", distance: "4.1 miles" },
      { id: "p3", name: "Goals Walthamstow", address: "Higham Hill Rd", price: 95, format: "5-a-side", distance: "3.8 miles" },
      { id: "p1", name: "Powerleague Finsbury Park", address: "223 Seven Sisters Rd", price: 80, format: "7-a-side", distance: "1.2 miles" },
    ],
    description: "Semi-pro side. Only looking for teams at a competitive level.",
    availabilityMatch: false,
  },
  {
    id: "post-4", team: "Dalston Athletic", versus: "Opponent TBC", location: "London Fields", distance: "4.0 miles",
    rating: 4.5, members: 10, date: "Sun, 23 Feb 2026 · 10:00",
    pitchOptions: [
      { id: "p2", name: "Hackney Marshes Pitch 3", address: "Homerton Rd", price: 60, format: "11-a-side", distance: "2.4 miles" },
    ],
    description: "11-a-side team with strong defensive record. Looking for a tough game.",
    availabilityMatch: false,
  },
];

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

function ChallengePanel({ post, onClose }: { post: MatchPost; onClose: () => void }) {
  const [selectedPitch, setSelectedPitch] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  if (confirmed) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60">
        <div className="w-full max-w-lg bg-[#141414] rounded-t-2xl p-6 text-center">
          <div className="w-16 h-16 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <p className="text-lg font-bold mb-1">Challenge Sent!</p>
          <p className="text-sm text-text-secondary mb-1">Match confirmed with <span className="text-text-primary font-semibold">{post.team}</span></p>
          <p className="text-xs text-text-secondary mb-4">
            Venue: <span className="text-text-primary font-medium">{post.pitchOptions.find(p => p.id === selectedPitch)?.name}</span>
          </p>
          <div className="bg-surface-2 border border-border rounded-xl p-3 mb-5 text-left">
            <p className="text-xs text-text-secondary">
              Payment of <span className="font-semibold text-text-primary">£{((post.pitchOptions.find(p => p.id === selectedPitch)?.price ?? 80) / 11).toFixed(2)}/player</span> will be taken automatically in <span className="font-semibold text-accent">3 hours</span>. Non-refundable after payment.
            </p>
          </div>
          <button onClick={onClose} className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm">Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-lg bg-[#141414] rounded-t-2xl overflow-y-auto max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>

        <div className="px-5 pb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="font-bold">Challenge {post.team}</p>
              <p className="text-xs text-text-secondary">{post.date}</p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>

          <p className="text-sm font-semibold mb-3">Select a pitch</p>
          <p className="text-xs text-text-secondary mb-3">Choose from the pitch options the posting team has provided, in order of their preference.</p>

          <div className="space-y-2 mb-5">
            {post.pitchOptions.map((pitch, i) => (
              <button
                key={pitch.id}
                onClick={() => setSelectedPitch(pitch.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${selectedPitch === pitch.id ? "bg-accent/10 border-accent/60" : "bg-surface-2 border-border"}`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${selectedPitch === pitch.id ? "bg-accent text-black" : "bg-background text-text-secondary"}`}>
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{pitch.name}</p>
                  <p className="text-xs text-text-secondary">{pitch.format} · £{pitch.price}/hr · {pitch.distance}</p>
                </div>
                {i === 0 && <span className="text-[10px] font-semibold text-accent bg-accent/10 px-2 py-0.5 rounded-full flex-shrink-0">Preferred</span>}
                {i > 0 && <span className="text-[10px] text-text-secondary flex-shrink-0">Backup {i}</span>}
              </button>
            ))}
          </div>

          {selectedPitch && (
            <div className="bg-surface-2 border border-border rounded-xl p-3 mb-4 text-xs text-text-secondary">
              <p className="font-semibold text-text-primary mb-1">Payment</p>
              <p>£{((post.pitchOptions.find(p => p.id === selectedPitch)?.price ?? 80) / 11).toFixed(2)}/player charged automatically <span className="text-accent font-semibold">3 hours after confirmation</span>. Split across all confirmed players via Stripe.</p>
            </div>
          )}

          <button
            disabled={!selectedPitch}
            onClick={() => setConfirmed(true)}
            className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Confirm Challenge
          </button>
        </div>
      </div>
    </div>
  );
}

function MatchCard({ post, showChallenge }: { post: MatchPost; showChallenge: boolean }) {
  const [showPanel, setShowPanel] = useState(false);

  return (
    <>
      <div className="bg-surface-2 border border-border rounded-2xl p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-accent">{post.team.split(" ").map((w) => w[0]).join("").slice(0,2)}</span>
            </div>
            <div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-sm font-bold">{post.team}</p>
                <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />
              </div>
              <p className="text-xs text-text-secondary mt-0.5">{post.distance} away</p>
            </div>
          </div>
          {post.availabilityMatch && (
            <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/30 px-2 py-0.5 rounded-full flex-shrink-0">
              Matches availability
            </span>
          )}
        </div>

        <Stars rating={post.rating} />
        <p className="text-xs text-text-secondary my-2">{post.description}</p>

        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1 text-xs text-text-secondary">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            {post.date}
          </div>
          <span className="text-xs text-text-secondary">{post.members} players</span>
        </div>

        {/* Pitch options summary */}
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

        {showChallenge && (
          <button
            onClick={() => setShowPanel(true)}
            className="w-full py-2.5 rounded-xl bg-accent text-black font-bold text-sm"
          >
            Challenge Team
          </button>
        )}
      </div>

      {showPanel && <ChallengePanel post={post} onClose={() => setShowPanel(false)} />}
    </>
  );
}

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

// Sort: availability matches first
const sortedPosts = [...matchPosts].sort((a, b) => (b.availabilityMatch ? 1 : 0) - (a.availabilityMatch ? 1 : 0));

// ── POV Views ────────────────────────────────────────────────
function NewUserPlay() {
  return (
    <div className="space-y-4">
      <div className="bg-accent/10 border border-accent/30 rounded-xl p-4">
        <p className="text-sm font-semibold text-accent mb-1">Fill in for a Match</p>
        <p className="text-xs text-text-secondary leading-relaxed">
          No team? No problem. Join a game as a temporary ringer at a discounted rate — try out different teams and enjoy football without commitment.
        </p>
      </div>
      {ringerGames.map((g) => <RingerCard key={g.id} game={g} />)}
    </div>
  );
}

function PlayerPlay() {
  const [tab, setTab] = useState<MatchTab>("matches");
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {([{ key: "matches", label: "Matches" }, { key: "tournaments", label: "Tournaments" }, { key: "ringer", label: "Fill in for a Match" }] as { key: MatchTab; label: string }[]).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${tab === t.key ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>{t.label}</button>
        ))}
      </div>
      {tab === "matches" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 bg-accent/10 border border-accent/30 rounded-xl px-3 py-2">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <p className="text-xs text-accent font-medium">Matches with your team's availability shown first</p>
          </div>
          {sortedPosts.map((p) => <MatchCard key={p.id} post={p} showChallenge={false} />)}
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
            <span>{t.location} · {t.distance}</span>
            <span>{t.date}</span>
            <span>{t.teams} entered</span>
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
  const [tab, setTab] = useState<MatchTab>("matches");
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {([{ key: "matches", label: "Matches" }, { key: "tournaments", label: "Tournaments" }, { key: "ringer", label: "Fill in for a Match" }] as { key: MatchTab; label: string }[]).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${tab === t.key ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>{t.label}</button>
        ))}
      </div>
      {tab === "matches" && (
        <div className="space-y-4">
          <a href="/play/create" className="flex items-center gap-2 w-fit px-4 py-2 rounded-lg border border-border bg-surface-2 text-sm font-medium">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
            Create Post
          </a>
          <div className="flex items-center gap-2 bg-accent/10 border border-accent/30 rounded-xl px-3 py-2">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <p className="text-xs text-accent font-medium">Matches with your team's availability shown first</p>
          </div>
          {sortedPosts.map((p) => <MatchCard key={p.id} post={p} showChallenge={true} />)}
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
            <p className="text-xs text-text-secondary mb-3">If your team is short players for a match, post it here and let individuals fill in at a discounted rate.</p>
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
  const { role } = useRole();

  return (
    <div className="flex flex-col min-h-screen px-4 pt-12">
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
