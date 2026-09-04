"use client";

import { useCallback, useEffect, useState } from "react";
import { authedDelete } from "@/lib/authed-fetch";
import { useRouter } from "next/navigation";
import { useRole } from "@/contexts/RoleContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import AvailabilityPollForm, { DateOption } from "@/components/AvailabilityPollForm";

type AvailabilityRequest = {
  id: string;
  team_id: string;
  captain_id: string;
  date_options: DateOption[];
  created_at: string;
};

type PlayerResponse = {
  player_id: string;
  available_date_ids: string[];
  profiles: { full_name: string } | null;
};

// ── Helpers ───────────────────────────────────────────────────
const AVAIL_MONTHS: Record<string, number> = {
  JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11,
};

function getInitials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

function isExpired(opt: DateOption): boolean {
  const m = opt.date.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m) return false;
  const mo = AVAIL_MONTHS[m[2].toUpperCase()];
  if (mo === undefined) return false;
  const [h, min] = opt.time.split(":").map(Number);
  return new Date(Number(m[3]), mo, Number(m[1]), h, min) < new Date();
}

// ── Captain responses view ────────────────────────────────────
function CaptainResponsesView({
  request, responses, totalMembers, onNewRequest, user,
}: {
  request: AvailabilityRequest; responses: PlayerResponse[]; totalMembers: number;
  onNewRequest: () => void; user: { id: string };
}) {
  const router = useRouter();
  const [chosenDates, setChosenDates] = useState<string[]>([]);

  const countAvailable = (id: string) => responses.filter((r) => r.available_date_ids.includes(id)).length;
  const best = request.date_options.reduce((b, d) => countAvailable(d.id) > countAvailable(b.id) ? d : b, request.date_options[0]);

  const toggleDate = (id: string) =>
    setChosenDates((p) => p.includes(id) ? p.filter((d) => d !== id) : p.length < 3 ? [...p, id] : p);

  const handleConfirm = () => {
    if (chosenDates.length === 0) return;
    const selectedOptions = request.date_options.filter((o) => chosenDates.includes(o.id));
    localStorage.setItem("unitr_confirmed_dates", JSON.stringify(selectedOptions));
    router.push("/play/create");
  };

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex items-center justify-between">
        <div className="bg-surface border border-border rounded-btn p-4 flex-1">
          <p className="text-xs text-text-secondary mb-1">{responses.length}/{totalMembers} players responded</p>
          <p className="text-sm font-semibold">Select up to 3 dates to post matches</p>
        </div>
        <button onClick={async () => {
          await authedDelete("/api/availability/delete", { requestId: request.id });
          onNewRequest();
        }} className="ml-3 px-3 py-2 rounded-xl border border-border text-xs text-text-secondary">
          New request
        </button>
      </div>

      {chosenDates.length > 0 && (
        <div className="bg-accent/10 border border-accent/30 rounded-xl px-4 py-3 flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          <p className="text-xs text-accent-ink font-medium">
            {chosenDates.length} date{chosenDates.length > 1 ? "s" : ""} selected
          </p>
        </div>
      )}

      {best && (
        <div className="bg-surface-2 border border-accent/20 rounded-2xl p-4 flex items-center gap-3">
          <div className="w-12 h-12 rounded-btn bg-accent text-white flex flex-col items-center justify-center flex-shrink-0">
            <span className="text-[9px] font-bold uppercase">{best.month}</span>
            <span className="text-xl font-extrabold leading-none">{best.day}</span>
          </div>
          <div>
            <p className="text-xs text-accent-ink font-semibold uppercase tracking-wider mb-0.5">Best availability</p>
            <p className="text-sm font-bold">{best.dayName} · {best.time}</p>
            <p className="text-xs text-text-secondary">{countAvailable(best.id)}/{totalMembers} available</p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {request.date_options.map((opt) => {
          const count = countAvailable(opt.id);
          const pct = totalMembers > 0 ? Math.round((count / totalMembers) * 100) : 0;
          const isBest = best?.id === opt.id;
          const idx = chosenDates.indexOf(opt.id);
          const isChosen = idx !== -1;
          const available = responses.filter((r) => r.available_date_ids.includes(opt.id));
          const unavailable = responses.filter((r) => !r.available_date_ids.includes(opt.id));

          return (
            <button key={opt.id} onClick={() => toggleDate(opt.id)}
              className={`rounded-2xl border p-4 text-left transition-all ${isChosen ? "bg-accent/10 border-accent/60" : isBest ? "bg-surface-2 border-accent/30" : "bg-surface-2 border-border"}`}>
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center flex-shrink-0 relative ${isChosen ? "bg-accent text-white" : "bg-background"}`}>
                  <span className="text-[9px] font-bold uppercase">{opt.month}</span>
                  <span className="text-xl font-extrabold leading-none">{opt.day}</span>
                  {isChosen && (
                    <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black border border-accent flex items-center justify-center">
                      <span className="text-[10px] font-bold text-accent-ink">{idx + 1}</span>
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{opt.dayName}</p>
                    {isBest && <span className="text-[10px] font-bold text-accent-ink bg-accent/10 px-1.5 py-0.5 rounded-md">Best</span>}
                  </div>
                  <p className="text-xs text-text-secondary">
                    KO {opt.time}{opt.location ? ` · ${opt.location}` : ""}
                  </p>
                </div>
                <span className="text-sm font-bold text-accent-ink">{count}/{totalMembers}</span>
              </div>
              <div className="w-full h-1.5 bg-background rounded-full mb-2">
                <div className={`h-1.5 rounded-full transition-all ${isBest || isChosen ? "bg-accent" : "bg-border"}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {available.map((p) => {
                  const name = p.profiles?.full_name ?? "Player";
                  return <div key={p.player_id} title={name} className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border bg-accent/20 border-accent text-accent-ink">{getInitials(name)}</div>;
                })}
                {unavailable.map((p) => {
                  const name = p.profiles?.full_name ?? "Player";
                  return <div key={p.player_id} title={name} className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border bg-surface border-border text-text-secondary opacity-40">{getInitials(name)}</div>;
                })}
              </div>
            </button>
          );
        })}
      </div>

      <button disabled={chosenDates.length === 0} onClick={handleConfirm}
        className="w-full py-3.5 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed">
        {chosenDates.length === 0 ? "Select dates to post" : `Post ${chosenDates.length} Match${chosenDates.length > 1 ? "es" : ""} →`}
      </button>
    </div>
  );
}

// ── Player availability tab ───────────────────────────────────
function PlayerAvailabilityTab({ userId }: { userId: string }) {
  const [request, setRequest] = useState<AvailabilityRequest | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: membership } = await supabase.from("team_members").select("team_id")
        .eq("player_id", userId).eq("status", "approved").maybeSingle();
      if (!membership) { setLoading(false); return; }

      const { data: req } = await supabase.from("availability_requests").select("*")
        .eq("team_id", membership.team_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!req) { setLoading(false); return; }

      const active = (req.date_options as DateOption[]).filter((o) => !isExpired(o));
      if (active.length === 0) { setLoading(false); return; }
      setRequest({ ...req, date_options: active });

      const { data: existing } = await supabase.from("availability_responses").select("available_date_ids")
        .eq("request_id", req.id).eq("player_id", userId).maybeSingle();
      if (existing) { setSelected(existing.available_date_ids ?? []); setSubmitted(true); }
      setLoading(false);
    })();
  }, [userId]);

  const toggle = (id: string) =>
    setSelected((p) => p.includes(id) ? p.filter((d) => d !== id) : [...p, id]);

  const handleSubmit = async () => {
    if (!request) return;
    setSaving(true);
    await supabase.from("availability_responses").upsert(
      { request_id: request.id, player_id: userId, available_date_ids: selected },
      { onConflict: "request_id,player_id" }
    );
    setSaving(false);
    setSubmitted(true);
  };

  if (loading) return <div className="py-12 text-center text-sm text-text-secondary">Loading…</div>;
  if (!request) return (
    <div className="py-12 text-center">
      <p className="text-sm text-text-secondary">No availability request yet.</p>
      <p className="text-xs text-text-secondary mt-1">Your captain hasn&apos;t sent one yet.</p>
    </div>
  );
  if (submitted) return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <div className="w-16 h-16 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <p className="text-lg font-bold">Availability submitted!</p>
      <p className="text-sm text-text-secondary text-center max-w-[240px]">Your captain will see your response.</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="bg-accent/10 border border-accent/30 rounded-xl p-4">
        <p className="text-sm font-semibold text-accent-ink mb-1">Action needed</p>
        <p className="text-xs text-text-secondary">Tap all the dates you can play.</p>
      </div>
      <div className="flex flex-col gap-3">
        {request.date_options.map((opt) => {
          const isSel = selected.includes(opt.id);
          return (
            <button key={opt.id} onClick={() => toggle(opt.id)}
              className={`flex items-center gap-4 p-4 rounded-2xl border transition-all text-left ${isSel ? "bg-accent/10 border-accent/60" : "bg-surface-2 border-border"}`}>
              <div className={`w-14 h-14 rounded-xl flex flex-col items-center justify-center flex-shrink-0 ${isSel ? "bg-accent text-white" : "bg-background"}`}>
                <span className="text-[10px] font-bold uppercase">{opt.month}</span>
                <span className="text-2xl font-extrabold leading-none">{opt.day}</span>
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">{opt.dayName}</p>
                <p className="text-xs text-text-secondary">
                  {opt.date} · KO {opt.time}{opt.location ? ` · ${opt.location}` : ""}
                </p>
              </div>
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${isSel ? "border-accent bg-accent" : "border-border"}`}>
                {isSel && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
              </div>
            </button>
          );
        })}
      </div>
      <button onClick={handleSubmit} disabled={selected.length === 0 || saving}
        className="w-full py-3 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
        {saving ? <><svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Saving…</> : `Submit (${selected.length} selected)`}
      </button>
    </div>
  );
}

// ── Captain availability tab ──────────────────────────────────
function CaptainAvailabilityTab({ userId }: { userId: string }) {
  const [teamId, setTeamId] = useState<string | null>(null);
  const [request, setRequest] = useState<AvailabilityRequest | null | undefined>(undefined);
  const [responses, setResponses] = useState<PlayerResponse[]>([]);
  const [totalMembers, setTotalMembers] = useState(0);
  const [loading, setLoading] = useState(true);

  // Callback rather than an inline effect body so posting a poll can re-run it.
  // Without that the captain stayed staring at the create form after sending.
  const load = useCallback(async () => {
    {
      const { data: team } = await supabase.from("teams").select("id").eq("captain_id", userId).maybeSingle();
      if (!team) { setLoading(false); return; }
      setTeamId(team.id);

      const { count } = await supabase.from("team_members").select("*", { count: "exact", head: true })
        .eq("team_id", team.id).eq("status", "approved");
      setTotalMembers(count ?? 0);

      const { data: req } = await supabase.from("availability_requests").select("*")
        .eq("team_id", team.id).order("created_at", { ascending: false }).limit(1).maybeSingle();

      if (!req) { setRequest(null); setLoading(false); return; }
      const active = (req.date_options as DateOption[]).filter((o) => !isExpired(o));
      if (active.length === 0) {
        await authedDelete("/api/availability/delete", { requestId: req.id });
        setRequest(null); setLoading(false); return;
      }
      setRequest({ ...req, date_options: active });

      const { data: resps } = await supabase.from("availability_responses")
        .select("player_id, available_date_ids, profiles(full_name)").eq("request_id", req.id);
      setResponses((resps ?? []) as unknown as PlayerResponse[]);
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="py-12 text-center text-sm text-text-secondary">Loading…</div>;
  if (!teamId) return (
    <div className="py-12 text-center">
      <p className="text-sm text-text-secondary">Register a team first.</p>
      <a href="/my-team/create" className="mt-3 inline-block px-5 py-2.5 rounded-btn bg-accent text-white font-bold text-sm">Register Team</a>
    </div>
  );
  if (!request) return (
    <AvailabilityPollForm teamId={teamId} captainId={userId} onCreated={load} />
  );

  return (
    <CaptainResponsesView
      request={request} responses={responses} totalMembers={totalMembers}
      user={{ id: userId }}
      onNewRequest={() => { setRequest(null); setResponses([]); }}
    />
  );
}

// ── Page ──────────────────────────────────────────────────────
export default function CollectAvailabilityPage() {
  const { user } = useAuth();
  const { role, roleLoading } = useRole();

  if (roleLoading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  );

  return (
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <a href="/my-team">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </a>
        <div>
          <h1 className="text-xl font-extrabold">
            {role === "captain" ? "Collect Availability" : "My Availability"}
          </h1>
          <p className="text-xs text-text-secondary">
            {role === "captain" ? "Send date options to your squad" : "Respond to your captain's request"}
          </p>
        </div>
      </div>

      {user && (role === "captain"
        ? <CaptainAvailabilityTab userId={user.id} />
        : <PlayerAvailabilityTab userId={user.id} />)}
    </div>
  );
}
