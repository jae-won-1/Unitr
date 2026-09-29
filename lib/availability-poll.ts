// The team's live availability poll and this player's answer to it.
//
// Extracted out of components/AvailabilityModal.tsx so the mobile app can share
// it — same move as lib/dues.ts and lib/game-feed.ts. The hook was always pure
// data (two Supabase reads, no JSX and no DOM); AvailabilityModal re-exports it
// so nothing importing from there had to change.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type DateOption = {
  id: string;
  date: string;
  time: string;
  day: string;
  month: string;
  dayName: string;
  location?: string;
};

export type PollRequest = { id: string; date_options: DateOption[] };
type Request = PollRequest;

// Latest poll for the team, plus whether this player has already answered.
// An empty available_date_ids is a real answer meaning "none of these" — it has
// to be distinguished from "hasn't replied", hence null vs [].
export function useAvailabilityPoll(teamId: string | null, userId: string | undefined) {
  const [request, setRequest] = useState<Request | null>(null);
  const [myAnswer, setMyAnswer] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!teamId || !userId) { setLoading(false); return; }
    const { data: req } = await supabase
      .from("availability_requests")
      .select("id, date_options")
      .eq("team_id", teamId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!req) { setRequest(null); setMyAnswer(null); setLoading(false); return; }

    const { data: mine } = await supabase
      .from("availability_responses")
      .select("available_date_ids")
      .eq("request_id", req.id)
      .eq("player_id", userId)
      .maybeSingle();

    setRequest(req as Request);
    setMyAnswer(mine ? (mine.available_date_ids as string[]) : null);
    setLoading(false);
  }, [teamId, userId]);

  useEffect(() => { load(); }, [load]);

  return { request, myAnswer, loading, reload: load };
}
