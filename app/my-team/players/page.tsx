"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type Player = {
  id: string;
  full_name: string;
  position: string;
  experience: string;
  location: string;
};

const positions = ["All", "GK", "CB", "LB", "RB", "CDM", "CM", "CAM", "RW", "LW", "ST"];

function StatBar({ value }: { value: number }) {
  return (
    <div className="w-full h-1 bg-background rounded-full">
      <div className="h-1 bg-accent rounded-full" style={{ width: `${value}%` }} />
    </div>
  );
}

function PlayerModal({ player, onClose }: { player: Player; onClose: () => void }) {
  const initials = player.full_name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end" onClick={onClose}>
      <div className="w-full bg-surface rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="w-10 h-1 bg-border rounded-full mx-auto mb-5" />

        <div className="flex items-center gap-4 mb-5">
          <div className="w-14 h-14 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
            <span className="text-lg font-bold text-accent">{initials}</span>
          </div>
          <div>
            <p className="font-bold text-lg">{player.full_name}</p>
            <p className="text-sm text-text-secondary">{player.position} · {player.experience}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-5">
          {[
            { label: "Games Played", value: "—" },
            { label: "Goals", value: "—" },
            { label: "Assists", value: "—" },
            { label: "Win Rate", value: "—" },
          ].map((s) => (
            <div key={s.label} className="bg-surface-2 border border-border rounded-xl p-3">
              <p className="text-lg font-bold text-accent">{s.value}</p>
              <p className="text-xs text-text-secondary">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="bg-surface-2 border border-border rounded-xl p-4 mb-4 space-y-3">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Profile</p>
          <div className="flex justify-between text-xs">
            <span className="text-text-secondary">Location</span>
            <span className="font-semibold">{player.location || "—"}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-text-secondary">Experience</span>
            <span className="font-semibold">{player.experience || "—"}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-text-secondary">Position</span>
            <span className="font-semibold">{player.position || "—"}</span>
          </div>
        </div>

        <div className="bg-surface-2 border border-border rounded-xl p-4 mb-4 space-y-3">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Performance</p>
          <p className="text-xs text-text-secondary italic">Stats will populate after matches are played.</p>
          {[
            { label: "Attacking", value: 0 },
            { label: "Defending", value: 0 },
            { label: "Consistency", value: 0 },
          ].map((b) => (
            <div key={b.label}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-text-secondary">{b.label}</span>
                <span className="font-semibold text-text-secondary">—</span>
              </div>
              <StatBar value={b.value} />
            </div>
          ))}
        </div>

        <button onClick={onClose} className="w-full py-3 rounded-xl border border-border text-sm font-semibold text-text-secondary">
          Close
        </button>
      </div>
    </div>
  );
}

export default function PlayersPage() {
  const { user } = useAuth();
  const [players, setPlayers] = useState<Player[]>([]);
  const [teamName, setTeamName] = useState("");
  const [loading, setLoading] = useState(true);
  const [posFilter, setPosFilter] = useState("All");
  const [selected, setSelected] = useState<Player | null>(null);

  useEffect(() => {
    if (!user) return;

    // Get captain's team first
    supabase
      .from("teams")
      .select("id, name")
      .eq("captain_id", user.id)
      .maybeSingle()
      .then(async ({ data: team }) => {
        if (!team) { setLoading(false); return; }
        setTeamName(team.name);

        // Get approved members and their profiles
        const { data } = await supabase
          .from("team_members")
          .select("profiles(id, full_name, position, experience, location)")
          .eq("team_id", team.id)
          .eq("status", "approved");

        const profiles = (data ?? [])
          .map((row: any) => row.profiles)
          .filter(Boolean) as Player[];

        setPlayers(profiles);
        setLoading(false);
      });
  }, [user]);

  const filtered = posFilter === "All" ? players : players.filter((p) => p.position === posFilter);

  return (
    <div className="flex flex-col min-h-screen px-4 pt-12 pb-8">
      <div className="flex items-center gap-3 mb-6">
        <a href="/my-team">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </a>
        <div>
          <h1 className="text-xl font-bold">Players</h1>
          <p className="text-xs text-text-secondary">{teamName || "Your team"} · {players.length} players</p>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
        {positions.map((pos) => (
          <button
            key={pos}
            onClick={() => setPosFilter(pos)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${posFilter === pos ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"}`}
          >
            {pos}
          </button>
        ))}
      </div>

      {loading && (
        <div className="py-12 text-center text-sm text-text-secondary">Loading players…</div>
      )}

      {!loading && players.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-sm text-text-secondary">No approved players yet.</p>
          <p className="text-xs text-text-secondary mt-1">Approve join requests from the My Team page.</p>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((player) => {
          const initials = player.full_name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
          return (
            <button
              key={player.id}
              onClick={() => setSelected(player)}
              className="w-full bg-surface-2 border border-border rounded-xl px-4 py-3 flex items-center gap-3 text-left"
            >
              <div className="w-10 h-10 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-accent">{initials}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{player.full_name}</p>
                <p className="text-xs text-text-secondary">{player.position} · {player.experience}</p>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          );
        })}
      </div>

      {selected && <PlayerModal player={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
