"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type Team = {
  id: string;
  name: string;
  location: string;
  level: string;
  format: string;
  description: string;
  captain_id: string;
};

type Member = { player_id: string; full_name: string; position: string | null; isCaptain?: boolean };

export default function TeamProfilePage({ params }: { params: { teamId: string } }) {
  const { user } = useAuth();
  const [team, setTeam] = useState<Team | null | undefined>(undefined);
  const [members, setMembers] = useState<Member[]>([]);
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    supabase.from("teams").select("*").eq("id", params.teamId).maybeSingle()
      .then(({ data }) => setTeam(data ?? null));

    supabase.from("team_members")
      .select("player_id, status, profiles(full_name, position)")
      .eq("team_id", params.teamId)
      .eq("status", "approved")
      .then(({ data }) => {
        setMembers(
          (data ?? []).map((m) => ({
            player_id: m.player_id as string,
            full_name: (m.profiles as { full_name: string } | null)?.full_name ?? "Unknown player",
            position: (m.profiles as { position: string | null } | null)?.position ?? null,
          }))
        );
      });
  }, [params.teamId]);

  // The captain isn't a team_members row, so fetch them separately and merge
  // into the squad list. (teams.captain_id has no FK relationship registered
  // with profiles, so it can't be embedded in the teams select above.)
  useEffect(() => {
    if (!team?.captain_id) return;
    supabase.from("profiles").select("full_name, position").eq("id", team.captain_id).maybeSingle()
      .then(({ data }) => {
        const captainEntry: Member = {
          player_id: team.captain_id,
          full_name: data?.full_name ?? "Captain",
          position: data?.position ?? null,
          isCaptain: true,
        };
        setMembers((prev) => [captainEntry, ...prev.filter((m) => m.player_id !== team.captain_id)]);
      });
  }, [team?.captain_id]);

  if (team === undefined) {
    return <div className="flex items-center justify-center min-h-screen"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;
  }

  if (!team) {
    return (
      <div className="flex items-center justify-center min-h-screen px-4">
        <p className="text-text-secondary">Team not found.</p>
      </div>
    );
  }

  const initials = team.name.split(" ").map((w) => w[0]).join("").slice(0, 2);
  const isCaptain = user?.id === team.captain_id;
  const isMember = members.some((m) => m.player_id === user?.id);

  const handleRequest = async () => {
    if (!user) return;
    await supabase.from("team_members").insert({ team_id: team.id, player_id: user.id });
    setRequested(true);
  };

  return (
    <div className="flex flex-col min-h-screen px-4 pt-12 pb-8">
      {/* Back */}
      <a href="/my-team" className="flex items-center gap-2 mb-6 text-text-secondary text-sm">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5M12 5l-7 7 7 7" />
        </svg>
        Browse Teams
      </a>

      {/* Team header */}
      <section className="flex flex-col items-center text-center mb-6">
        <div className="w-20 h-20 rounded-full bg-accent/10 border-2 border-accent flex items-center justify-center mb-3">
          <span className="text-xl font-bold text-accent">{initials}</span>
        </div>
        <h1 className="text-xl font-bold">{team.name}</h1>
        <p className="text-text-secondary text-sm mt-0.5">{team.location}</p>
        <div className="flex items-center gap-2 mt-2">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-lg ${
            team.level === "Casual" ? "bg-blue-500/10 text-blue-400"
            : team.level === "Competitive" ? "bg-orange-500/10 text-orange-400"
            : "bg-purple-500/10 text-purple-400"
          }`}>{team.level}</span>
          <span className="text-xs font-medium px-2 py-0.5 rounded-lg bg-surface-2 border border-border text-text-secondary">{team.format}</span>
        </div>
      </section>

      {/* About */}
      {team.description && (
        <section className="mb-5">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">About</h3>
          <p className="text-sm text-text-secondary leading-relaxed">{team.description}</p>
        </section>
      )}

      {/* Players */}
      <section className="mb-6">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Players ({members.length})</h3>
        {members.length === 0 ? (
          <p className="text-sm text-text-secondary">No players yet.</p>
        ) : (
          <div className="space-y-2">
            {members.map((p) => (
              <div key={p.player_id} className="bg-surface-2 border border-border rounded-xl px-4 py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-semibold text-text-secondary">{p.full_name.split(" ").map((w) => w[0]).join("").slice(0, 2)}</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium">{p.full_name}</p>
                    {p.isCaptain && (
                      <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/30 px-1.5 py-0.5 rounded-full">Captain</span>
                    )}
                  </div>
                  {p.position && <p className="text-xs text-text-secondary">{p.position}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* CTA */}
      {!isCaptain && !isMember && (
        <button
          onClick={handleRequest}
          disabled={requested || !user}
          className="w-full py-3.5 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-60"
        >
          {requested ? "Request Sent" : `Request to Join ${team.name}`}
        </button>
      )}
    </div>
  );
}
