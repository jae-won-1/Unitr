"use client";

// The Tactics route still exists — roughly a dozen links across the app point
// at it — but it no longer owns any UI of its own. My Team > Tactics is the
// real home now, and this page renders the same component so a deep link and a
// tab tap land on identical content rather than two implementations that drift.
//
// It also used to be the last consumer of contexts/TacticsContext, the
// localStorage tactics blob. That's gone: setups live in team_tactics, scoped
// to the team and visible to the whole squad.

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/contexts/RoleContext";
import { supabase } from "@/lib/supabase";
import TacticsTab from "@/components/my-team/TacticsTab";

export default function TacticsPage() {
  const { user } = useAuth();
  const { role, roleLoading } = useRole();
  const [teamId, setTeamId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!user) { setTeamId(null); return; }
    async function load() {
      const { data: captained } = await supabase
        .from("teams").select("id").eq("captain_id", user!.id).maybeSingle();
      if (captained?.id) { setTeamId(captained.id); return; }
      const { data: mem } = await supabase
        .from("team_members").select("team_id")
        .eq("player_id", user!.id).eq("status", "approved").maybeSingle();
      setTeamId(mem?.team_id ?? null);
    }
    load();
  }, [user]);

  const loading = roleLoading || teamId === undefined;

  return (
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-24">
      <div className="flex items-center gap-3 mb-6">
        <a href="/my-team?tab=tactics" aria-label="Back to My Team">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </a>
        <div>
          <h1 className="text-xl font-extrabold">Tactics</h1>
          <p className="text-xs text-text-secondary">Your team&apos;s saved setups</p>
        </div>
      </div>

      {loading ? (
        <div className="py-12 flex justify-center"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>
      ) : !user || !teamId ? (
        <div className="bg-surface border border-border shadow-card rounded-card p-6 text-center">
          <p className="text-sm font-semibold mb-1">No team yet</p>
          <p className="text-xs text-text-secondary mb-4">Join or register a team to build tactical setups.</p>
          <a href="/my-team" className="inline-block px-5 py-2.5 rounded-btn bg-accent text-white font-bold text-xs">Go to My Team</a>
        </div>
      ) : (
        <TacticsTab teamId={teamId} userId={user.id} isCaptain={role === "captain"} />
      )}
    </div>
  );
}
