"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import ChallengePanel, { type MatchPost, type PitchOption } from "@/components/ChallengePanel";
import { fmtKickoff, isKickoffPast } from "@/lib/match-dates";

// Captain's side of "Suggest to team": the games squad players have put
// forward, with the actions a captain actually has — challenge the post, enter
// the tournament, or dismiss it.
//
// Exception-based, like join requests: the strip only exists when there is
// something pending, so home stays quiet when there is nothing to decide.

type Suggestion = {
  id: string;
  kind: "match" | "tournament";
  suggestedBy: string;
  // Populated for kind === "match" — the full post shape ChallengePanel needs.
  post?: MatchPost;
  // Populated for kind === "tournament".
  tournament?: { id: string; title: string; pitchName: string; date: string; pricePence: number };
};

export function useTeamSuggestions(teamId: string | null) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!teamId) { setSuggestions([]); setLoading(false); return; }

    const { data: rows, error } = await supabase
      .from("match_suggestions")
      .select("id, kind, post_id, suggested_by")
      .eq("team_id", teamId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error || !rows || rows.length === 0) { setSuggestions([]); setLoading(false); return; }

    const matchIds = rows.filter((r) => r.kind === "match").map((r) => r.post_id);
    const tourIds = rows.filter((r) => r.kind === "tournament").map((r) => r.post_id);
    const suggesterIds = [...new Set(rows.map((r) => r.suggested_by))];

    const [{ data: posts }, { data: tours }, { data: profs }] = await Promise.all([
      matchIds.length
        ? supabase.from("match_posts").select("*").in("id", matchIds).eq("status", "open")
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      tourIds.length
        ? supabase.from("open_matches")
            .select("id, title, pitch_name, match_date, start_time, price_per_team_pence")
            .in("id", tourIds).neq("status", "cancelled")
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      supabase.from("profiles").select("id, full_name").in("id", suggesterIds),
    ]);

    const nameById = new Map((profs ?? []).map((p) => [p.id, p.full_name as string]));
    const postById = new Map((posts ?? []).map((p) => [p.id as string, p]));
    const tourById = new Map((tours ?? []).map((t) => [t.id as string, t]));

    const mapped: Suggestion[] = [];
    for (const r of rows) {
      const who = nameById.get(r.suggested_by) ?? "A teammate";

      if (r.kind === "match") {
        const p = postById.get(r.post_id) as Record<string, string> | undefined;
        // Dropped rather than shown as dead: the post was matched, taken down,
        // or has already kicked off since it was suggested.
        if (!p || isKickoffPast(p.match_date, p.match_time)) continue;
        mapped.push({
          id: r.id, kind: "match", suggestedBy: who,
          post: {
            id: p.id,
            team_id: p.team_id,
            captain_id: p.captain_id,
            team: p.team_name,
            location: p.team_location ?? "",
            date: fmtKickoff(p.match_date, p.match_time),
            match_date: p.match_date,
            match_time: p.match_time,
            pitchOptions: ((p.pitch_options ?? []) as unknown) as PitchOption[],
            description: p.description ?? "",
            availabilityMatch: false,
            status: p.status,
            payment_mode: p.payment_mode ?? "credit",
            pitchSecured: Boolean(p.pitch_secured),
            securedBookingId: p.secured_booking_id ?? null,
          },
        });
      } else {
        const t = tourById.get(r.post_id) as Record<string, string> | undefined;
        if (!t || isKickoffPast(t.match_date, t.start_time)) continue;
        mapped.push({
          id: r.id, kind: "tournament", suggestedBy: who,
          tournament: {
            id: t.id,
            title: t.title,
            pitchName: t.pitch_name,
            date: fmtKickoff(t.match_date, t.start_time),
            pricePence: Number(t.price_per_team_pence ?? 0),
          },
        });
      }
    }

    setSuggestions(mapped);
    setLoading(false);
  }, [teamId]);

  useEffect(() => { load(); }, [load]);

  const resolve = useCallback(async (id: string, status: "accepted" | "dismissed") => {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
    await supabase.from("match_suggestions").update({ status }).eq("id", id);
  }, []);

  return { suggestions, loading, resolve, reload: load };
}

function SuggestionRow({ suggestion, onResolve }: {
  suggestion: Suggestion;
  onResolve: (id: string, status: "accepted" | "dismissed") => void;
}) {
  const [challenging, setChallenging] = useState(false);
  const s = suggestion;

  return (
    <div className="bg-surface-2 border border-border rounded-xl p-3">
      <p className="text-[10px] text-text-secondary uppercase tracking-wider font-semibold mb-1.5">
        {s.suggestedBy} suggested
      </p>

      {s.kind === "match" && s.post ? (
        <>
          <p className="text-sm font-bold truncate">vs {s.post.team}</p>
          <p className="text-xs text-text-secondary mt-0.5">{s.post.date}</p>
          <p className="text-xs text-text-secondary">{s.post.location || "Location TBC"}</p>
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={() => onResolve(s.id, "dismissed")}
              className="flex-1 py-2 rounded-lg border border-border text-xs font-semibold text-text-secondary">
              Dismiss
            </button>
            <button type="button" onClick={() => setChallenging(true)}
              className="flex-[2] py-2 rounded-lg bg-accent text-black text-xs font-bold">
              {s.post.pitchSecured ? "Join — Pitch Secured" : "Challenge Team"}
            </button>
          </div>
          {challenging && (
            <ChallengePanel
              post={s.post}
              onClose={() => setChallenging(false)}
              onMatched={() => { setChallenging(false); onResolve(s.id, "accepted"); }}
            />
          )}
        </>
      ) : s.tournament ? (
        <>
          <p className="text-sm font-bold truncate">{s.tournament.title}</p>
          <p className="text-xs text-text-secondary mt-0.5">{s.tournament.date}</p>
          <p className="text-xs text-text-secondary">
            {s.tournament.pitchName} · £{(s.tournament.pricePence / 100).toFixed(2)} per team
          </p>
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={() => onResolve(s.id, "dismissed")}
              className="flex-1 py-2 rounded-lg border border-border text-xs font-semibold text-text-secondary">
              Dismiss
            </button>
            <a href={`/play/tournament/${s.tournament.id}`}
              className="flex-[2] py-2 rounded-lg bg-accent text-black text-xs font-bold text-center">
              Enter Tournament
            </a>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function SuggestionsStrip({ teamId }: { teamId: string | null }) {
  const { suggestions, resolve } = useTeamSuggestions(teamId);
  const [open, setOpen] = useState(false);

  if (suggestions.length === 0) return null;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="w-full flex items-center gap-3 bg-indigo-500/10 border border-indigo-500/30 rounded-2xl p-4 text-left">
        <div className="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#818CF8" strokeWidth="2" strokeLinecap="round">
            <path d="M12 2a5 5 0 0 0-5 5c0 3.5 5 11 5 11s5-7.5 5-11a5 5 0 0 0-5-5z"/><circle cx="12" cy="7" r="2"/>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-indigo-300">
            {suggestions.length} game{suggestions.length === 1 ? "" : "s"} your squad suggested
          </p>
          <p className="text-xs text-text-secondary mt-0.5 truncate">Review and decide whether to enter</p>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm bg-[#141414] border border-border rounded-2xl p-6 max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <p className="font-bold text-lg">Squad Suggestions</p>
              <button onClick={() => setOpen(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <p className="text-xs text-text-secondary mb-4">Games your players want the team to enter.</p>

            <div className="space-y-3">
              {suggestions.map((s) => (
                <SuggestionRow key={s.id} suggestion={s} onResolve={resolve} />
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
