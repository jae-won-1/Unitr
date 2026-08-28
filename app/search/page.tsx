"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Player = {
  id: string;
  full_name: string;
  position: string | null;
  location: string | null;
  experience: string | null;
};

type Team = {
  id: string;
  name: string;
  location: string;
  level: string;
  format: string;
};

type Tab = "all" | "players" | "teams";

function FollowIcon({ active }: { active: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke={active ? "#0E7A3C" : "#5A6478"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <line x1="19" y1="8" x2="19" y2="14"/>
      <line x1="16" y1="11" x2="22" y2="11"/>
    </svg>
  );
}

function ViewIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="#5A6478" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

function MessageIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="#5A6478" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  );
}

function SearchContent() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [tab, setTab] = useState<Tab>((searchParams.get("tab") as Tab) ?? "all");
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(false);
  const [followedPlayers, setFollowedPlayers] = useState<Set<string>>(new Set());
  const [followedTeams, setFollowedTeams] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!query.trim()) {
      setPlayers([]);
      setTeams([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      const q = `%${query.trim()}%`;
      const [{ data: playerData }, { data: teamData }] = await Promise.all([
        supabase.from("profiles")
          .select("id, full_name, position, location, experience")
          .ilike("full_name", q)
          .eq("account_type", "player")
          .limit(20),
        supabase.from("teams")
          .select("id, name, location, level, format")
          .ilike("name", q)
          .limit(20),
      ]);
      setPlayers(playerData ?? []);
      setTeams(teamData ?? []);
      setLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const toggleFollowPlayer = (id: string) =>
    setFollowedPlayers((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const toggleFollowTeam = (id: string) =>
    setFollowedTeams((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const showPlayers = tab === "all" || tab === "players";
  const showTeams = tab === "all" || tab === "teams";
  const hasResults = players.length > 0 || teams.length > 0;

  return (
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-6">
      <header className="mb-5">
        <h1 className="text-2xl font-extrabold mb-4">Search</h1>
        <div className="relative">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="search"
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search players or teams…"
            className="w-full bg-surface border border-border rounded-btn pl-10 pr-10 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60"
          />
          {loading && (
            <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
              <div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            </div>
          )}
        </div>
      </header>

      {query.trim() && (
        <div className="flex gap-2 mb-5">
          {(["all", "players", "teams"] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors capitalize ${tab === t ? "bg-accent text-white border-accent" : "bg-surface-2 text-text-secondary border-border"}`}>
              {t}
            </button>
          ))}
        </div>
      )}

      {!query.trim() && (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <div className="w-16 h-16 rounded-full bg-surface-2 border border-border flex items-center justify-center">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
          </div>
          <p className="text-sm font-semibold">Find players & teams</p>
          <p className="text-xs text-text-secondary max-w-[220px]">Search by name to discover players and teams on Unitr.</p>
        </div>
      )}

      {query.trim() && !loading && !hasResults && (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
          <p className="text-sm font-semibold">No results for &ldquo;{query}&rdquo;</p>
          <p className="text-xs text-text-secondary">Try a different name or check your spelling.</p>
        </div>
      )}

      <div className="space-y-6">

        {/* Players */}
        {showPlayers && players.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
              Players ({players.length})
            </h3>
            <div className="space-y-2">
              {players.map((p) => {
                const initials = p.full_name.split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                const subtitle = [p.position, p.location, p.experience].filter(Boolean).join(" · ") || "No info set";
                const followed = followedPlayers.has(p.id);
                return (
                  <div key={p.id} className="bg-surface border border-border shadow-card rounded-card px-4 py-3 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-accent-ink">{initials}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{p.full_name}</p>
                      <p className="text-xs text-text-secondary truncate">{subtitle}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => toggleFollowPlayer(p.id)}
                        title={followed ? "Unfollow" : "Follow"}
                        className={`w-8 h-8 rounded-full border flex items-center justify-center transition-colors ${followed ? "bg-accent/10 border-accent" : "bg-surface border-border"}`}>
                        <FollowIcon active={followed} />
                      </button>
                      <a href={`/profile/${p.id}`} title="View profile"
                        className="w-8 h-8 rounded-full border border-border bg-surface flex items-center justify-center">
                        <ViewIcon />
                      </a>
                      <a href={`/messages?userId=${p.id}`} title="Message"
                        className="w-8 h-8 rounded-full border border-border bg-surface flex items-center justify-center">
                        <MessageIcon />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Teams */}
        {showTeams && teams.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
              Teams ({teams.length})
            </h3>
            <div className="space-y-2">
              {teams.map((t) => {
                const initials = t.name.split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                const subtitle = [t.level, t.format, t.location].filter(Boolean).join(" · ");
                const followed = followedTeams.has(t.id);
                return (
                  <div key={t.id} className="bg-surface border border-border shadow-card rounded-card px-4 py-3 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-text-secondary">{initials}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{t.name}</p>
                      <p className="text-xs text-text-secondary truncate">{subtitle}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => toggleFollowTeam(t.id)}
                        title={followed ? "Unbookmark" : "Bookmark"}
                        className={`w-8 h-8 rounded-full border flex items-center justify-center transition-colors ${followed ? "bg-accent/10 border-accent" : "bg-surface border-border"}`}>
                        <svg width="15" height="15" viewBox="0 0 24 24"
                          fill={followed ? "#0E7A3C" : "none"}
                          stroke={followed ? "#0E7A3C" : "#5A6478"}
                          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                        </svg>
                      </button>
                      <a href={`/my-team/${t.id}`} title="View team"
                        className="w-8 h-8 rounded-full border border-border bg-surface flex items-center justify-center">
                        <ViewIcon />
                      </a>
                      <a href={`/messages?teamId=${t.id}`} title="Message"
                        className="w-8 h-8 rounded-full border border-border bg-surface flex items-center justify-center">
                        <MessageIcon />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>}>
      <SearchContent />
    </Suspense>
  );
}
