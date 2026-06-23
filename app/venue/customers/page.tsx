"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type Player = { id: string; full_name: string; position: string | null; location: string | null; experience: string | null };
type Team = { id: string; name: string; location: string | null; level: string | null; format: string | null };
type Listing = { id: string; title: string; match_type: string; match_date: string; start_time: string; pitch_name: string; price_per_team_pence: number };
type Tab = "all" | "teams" | "players";

type Recipient =
  | { kind: "team"; id: string; name: string }
  | { kind: "player"; id: string; name: string };

function initials(name: string): string {
  return name.split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}
function fmtDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

// ── Invite modal ──────────────────────────────────────────────
function InviteModal({ recipient, listings, invitedKeys, onInvite, onClose }: {
  recipient: Recipient;
  listings: Listing[];
  invitedKeys: Set<string>;
  onInvite: (key: string) => void;
  onClose: () => void;
}) {
  const isPlayer = recipient.kind === "player";
  // Players get invited to fill a spot (ringer); teams get invited to enter the game.
  const verb = isPlayer ? "Invite as ringer to" : "Invite to";

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-lg bg-[#141414] rounded-t-2xl md:rounded-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0 md:hidden"><div className="w-10 h-1 rounded-full bg-border" /></div>
        <div className="px-5 pt-2 md:pt-5 pb-6 space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold">{verb} {recipient.name}</p>
              <p className="text-xs text-text-secondary">
                {isPlayer ? "Offer a spot in one of your games at a discounted ringer rate." : "Invite this team to one of your open games or tournaments."}
              </p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center flex-shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>

          {listings.length === 0 ? (
            <div className="bg-surface-2 border border-border rounded-xl px-4 py-8 text-center">
              <p className="text-sm font-semibold mb-1">No open games to invite to</p>
              <p className="text-xs text-text-secondary">Create an open match or tournament first, then invite customers to it.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {listings.map((l) => {
                const key = `${recipient.id}:${l.id}`;
                const invited = invitedKeys.has(key);
                return (
                  <div key={l.id} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-surface-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{l.title}</p>
                      <p className="text-xs text-text-secondary truncate">
                        <span className="capitalize">{l.match_type}</span> · {fmtDate(l.match_date)} · {l.start_time} · {l.pitch_name}
                      </p>
                    </div>
                    <button onClick={() => onInvite(key)} disabled={invited}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                        invited ? "bg-accent/10 text-accent border border-accent/30" : "bg-accent text-black"
                      }`}>
                      {invited ? "Invited ✓" : "Send invite"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Result row ────────────────────────────────────────────────
function ResultRow({ name, subtitle, accent, onInvite }: {
  name: string; subtitle: string; accent: boolean; onInvite: () => void;
}) {
  return (
    <div className="bg-surface-2 border border-border rounded-2xl px-4 py-3 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${accent ? "bg-accent/10 border border-accent/30" : "bg-surface border border-border"}`}>
        <span className={`text-xs font-bold ${accent ? "text-accent" : "text-text-secondary"}`}>{initials(name)}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{name}</p>
        <p className="text-xs text-text-secondary truncate">{subtitle || "No info set"}</p>
      </div>
      <button onClick={onInvite}
        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/30 text-accent text-xs font-bold">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
        Invite
      </button>
    </div>
  );
}

export default function VenueCustomersPage() {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [listings, setListings] = useState<Listing[]>([]);
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [invitedKeys, setInvitedKeys] = useState<Set<string>>(new Set());

  // Load the venue's open listings (for the invite modal)
  useEffect(() => {
    if (!user) return;
    supabase.from("open_matches")
      .select("id, title, match_type, match_date, start_time, pitch_name, price_per_team_pence")
      .eq("venue_owner_id", user.id).eq("status", "open")
      .order("match_date", { ascending: true })
      .then(({ data }) => setListings((data ?? []) as Listing[]));
  }, [user]);

  // Discover (no query) + search (query) against teams/players
  const runSearch = useCallback(async (q: string) => {
    setLoading(true);
    const like = q.trim() ? `%${q.trim()}%` : null;
    let playerQ = supabase.from("profiles")
      .select("id, full_name, position, location, experience")
      .eq("account_type", "player").limit(15);
    let teamQ = supabase.from("teams")
      .select("id, name, location, level, format").limit(15);
    if (like) { playerQ = playerQ.ilike("full_name", like); teamQ = teamQ.ilike("name", like); }
    const [{ data: pd }, { data: td }] = await Promise.all([playerQ, teamQ]);
    setPlayers((pd ?? []) as Player[]);
    setTeams((td ?? []) as Team[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => runSearch(query), query.trim() ? 300 : 0);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  const sendInvite = (key: string) => setInvitedKeys((prev) => new Set(prev).add(key));

  const showPlayers = tab === "all" || tab === "players";
  const showTeams = tab === "all" || tab === "teams";

  return (
    <div className="px-4 md:px-8 pt-6 pb-10 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold">Customers</h1>
        <p className="text-xs text-text-secondary mt-0.5">Discover teams and players near you, and invite them to your games, tournaments or ringer spots.</p>
      </div>

      {/* Search */}
      <div className="relative">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search teams or players by name…"
          className="w-full bg-surface-2 border border-border rounded-xl pl-10 pr-10 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60" />
        {loading && <div className="absolute right-3.5 top-1/2 -translate-y-1/2"><div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>}
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {(["all", "teams", "players"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors capitalize ${tab === t ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>
            {t}
          </button>
        ))}
      </div>

      {!query.trim() && (
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Discover nearby</p>
      )}

      {!loading && players.length === 0 && teams.length === 0 && (
        <div className="bg-surface-2 border border-border rounded-2xl px-4 py-12 text-center">
          <p className="text-sm font-semibold mb-1">{query.trim() ? `No results for "${query}"` : "No customers found"}</p>
          <p className="text-xs text-text-secondary">Teams and players who join Unitr will show up here.</p>
        </div>
      )}

      <div className="space-y-6">
        {showTeams && teams.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">Teams ({teams.length})</h3>
            <div className="grid md:grid-cols-2 gap-2">
              {teams.map((t) => (
                <ResultRow key={t.id} name={t.name} accent={false}
                  subtitle={[t.level, t.format, t.location].filter(Boolean).join(" · ")}
                  onInvite={() => setRecipient({ kind: "team", id: t.id, name: t.name })} />
              ))}
            </div>
          </section>
        )}

        {showPlayers && players.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">Players ({players.length})</h3>
            <div className="grid md:grid-cols-2 gap-2">
              {players.map((p) => (
                <ResultRow key={p.id} name={p.full_name} accent={true}
                  subtitle={[p.position, p.location, p.experience].filter(Boolean).join(" · ")}
                  onInvite={() => setRecipient({ kind: "player", id: p.id, name: p.full_name })} />
              ))}
            </div>
          </section>
        )}
      </div>

      {recipient && (
        <InviteModal
          recipient={recipient}
          listings={listings}
          invitedKeys={invitedKeys}
          onInvite={sendInvite}
          onClose={() => setRecipient(null)}
        />
      )}
    </div>
  );
}
