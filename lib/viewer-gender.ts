import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { loadLeadership } from "@/lib/team-leadership";
import { categoryForGender, rowCategory, type GenderCategory, type GenderFilter } from "@/lib/gender";

// Which men's/women's view a signed-in viewer opens on. Kept apart from
// lib/gender.ts so the server routes can import those rules without pulling in
// React hooks or the browser client.

// ── The viewer ──────────────────────────────────────────────────────────
export type ViewerGender = {
  /** The player's own answer — null until they've given one. */
  gender: string | null;
  /** Their team's category, when they are in one. */
  teamCategory: GenderCategory | null;
  /** What they see by default: their team's category, else their own, else
   *  null (show everything). A team wins because it's what they can enter. */
  category: GenderCategory | null;
  /** A player who has never answered, and so should be asked. */
  unanswered: boolean;
};

export const NO_VIEWER_GENDER: ViewerGender = { gender: null, teamCategory: null, category: null, unanswered: false };

export async function loadViewerGender(userId: string): Promise<ViewerGender> {
  const [{ data: profile }, led] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    loadLeadership(userId),
  ]);

  let teamCategory: GenderCategory | null = null;
  if (led?.teamId) {
    // select("*") so this still answers before the migration has been run.
    const { data: team } = await supabase.from("teams").select("*").eq("id", led.teamId).maybeSingle();
    if (team) teamCategory = rowCategory(team);
  }

  const gender = (profile?.gender as string | null | undefined) ?? null;
  const isPlayer = !profile?.account_type || profile.account_type === "player";
  return {
    gender,
    teamCategory,
    category: teamCategory ?? categoryForGender(gender),
    unanswered: Boolean(profile) && isPlayer && !gender,
  };
}

/** The viewer's gender view, or NO_VIEWER_GENDER while signed out / loading. */
export function useViewerGender(userId: string | null | undefined) {
  const [state, setState] = useState<{ viewer: ViewerGender; loading: boolean }>({
    viewer: NO_VIEWER_GENDER, loading: Boolean(userId),
  });

  useEffect(() => {
    if (!userId) { setState({ viewer: NO_VIEWER_GENDER, loading: false }); return; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    loadViewerGender(userId).then((viewer) => { if (!cancelled) setState({ viewer, loading: false }); });
    return () => { cancelled = true; };
  }, [userId]);

  return state;
}

/** The filter a feed opens on for this viewer. */
export function defaultGenderFilter(viewer: ViewerGender): GenderFilter {
  return viewer.category ?? "all";
}

/** Save the player's own answer (the one-time prompt, Edit Profile has its own). */
export async function saveOwnGender(userId: string, gender: string): Promise<string | null> {
  const { error } = await supabase.from("profiles").update({ gender }).eq("id", userId);
  return error?.message ?? null;
}
