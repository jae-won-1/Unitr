"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Player = { id: string; full_name: string; position: string | null; location: string | null };
type Team = { id: string; name: string; location: string; level: string };
type Tab = "all" | "players" | "teams";

export default function HomeSearchBar() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [open, setOpen] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
          .select("id, full_name, position, location")
          .ilike("full_name", q)
          .eq("account_type", "player")
          .limit(5),
        supabase.from("teams")
          .select("id, name, location, level")
          .ilike("name", q)
          .limit(5),
      ]);
      setPlayers(playerData ?? []);
      setTeams(teamData ?? []);
      setLoading(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  function goToResults() {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (tab !== "all") params.set("tab", tab);
    setOpen(false);
    router.push(`/search?${params.toString()}`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      goToResults();
    }
  }

  const showPlayers = tab === "all" || tab === "players";
  const showTeams = tab === "all" || tab === "teams";
  const hasResults = players.length > 0 || teams.length > 0;

  return (
    <div ref={containerRef} className="relative mb-6">
      <div className="relative">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          type="text"
          autoCapitalize="none"
          autoCorrect="off"
          enterKeyHint="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search players or teams…"
          className="w-full bg-surface border border-border rounded-btn pl-10 pr-10 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60"
        />
        {loading && (
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          </div>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 mt-2 bg-surface border border-border rounded-2xl p-3 z-40 shadow-xl">
          <div className="flex gap-2 mb-3">
            {(["all", "players", "teams"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors capitalize ${tab === t ? "bg-accent text-white border-accent" : "bg-surface-2 text-text-secondary border-border"}`}
              >
                {t}
              </button>
            ))}
          </div>

          {!query.trim() ? (
            <p className="text-xs text-text-secondary text-center py-3">Start typing to find players &amp; teams.</p>
          ) : !loading && !hasResults ? (
            <p className="text-xs text-text-secondary text-center py-3">No results for &ldquo;{query}&rdquo;.</p>
          ) : (
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {showPlayers && players.map((p) => {
                const initials = p.full_name.split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                return (
                  <a
                    key={p.id}
                    href={`/profile/${p.id}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-surface-2"
                  >
                    <div className="w-8 h-8 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] font-bold text-accent-ink">{initials}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{p.full_name}</p>
                      <p className="text-[11px] text-text-secondary truncate">{[p.position, p.location].filter(Boolean).join(" · ") || "Player"}</p>
                    </div>
                  </a>
                );
              })}
              {showTeams && teams.map((t) => {
                const initials = t.name.split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                return (
                  <a
                    key={t.id}
                    href={`/my-team/${t.id}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-surface-2"
                  >
                    <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] font-bold text-text-secondary">{initials}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{t.name}</p>
                      <p className="text-[11px] text-text-secondary truncate">{[t.level, t.location].filter(Boolean).join(" · ")}</p>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
