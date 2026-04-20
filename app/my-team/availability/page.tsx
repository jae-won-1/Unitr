"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useRole } from "@/contexts/RoleContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type DateOption = {
  id: string;
  date: string;
  time: string;
  day: string;
  month: string;
  dayName: string;
};

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

// ── Helpers ──────────────────────────────────────────────────
function getInitials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

function parseDateOption(dateStr: string, timeStr: string): DateOption {
  const d = new Date(dateStr + "T" + timeStr);
  const day = String(d.getDate()).padStart(2, "0");
  const monthNames = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const month = monthNames[d.getMonth()];
  const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const dayName = dayNames[d.getDay()];
  const display = `${dayName.slice(0,3)}, ${day} ${month} ${d.getFullYear()}`;
  return { id: crypto.randomUUID(), date: display, time: timeStr, day, month, dayName };
}

// ── Player View ───────────────────────────────────────────────
function PlayerAvailability() {
  const { user } = useAuth();
  const [request, setRequest] = useState<AvailabilityRequest | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      // Get player's team
      const { data: membership } = await supabase
        .from("team_members")
        .select("team_id")
        .eq("player_id", user.id)
        .eq("status", "approved")
        .maybeSingle();

      if (!membership) { setLoading(false); return; }

      // Get latest availability request for that team
      const { data: req } = await supabase
        .from("availability_requests")
        .select("*")
        .eq("team_id", membership.team_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!req) { setLoading(false); return; }
      setRequest(req);

      // Check if player already submitted
      const { data: existing } = await supabase
        .from("availability_responses")
        .select("available_date_ids")
        .eq("request_id", req.id)
        .eq("player_id", user.id)
        .maybeSingle();

      if (existing) {
        setSelected(existing.available_date_ids ?? []);
        setSubmitted(true);
      }

      setLoading(false);
    })();
  }, [user]);

  const toggle = (id: string) =>
    setSelected((prev) => prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]);

  const handleSubmit = async () => {
    if (!user || !request) return;
    setSaving(true);
    await supabase.from("availability_responses").upsert({
      request_id: request.id,
      player_id: user.id,
      available_date_ids: selected,
    }, { onConflict: "request_id,player_id" });
    setSaving(false);
    setSubmitted(true);
  };

  if (loading) return <div className="py-12 text-center text-sm text-text-secondary">Loading…</div>;

  if (!request) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-text-secondary">No availability request yet.</p>
        <p className="text-xs text-text-secondary mt-1">Your captain hasn't sent one yet. Check back later.</p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="w-16 h-16 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <p className="text-lg font-bold">Availability submitted!</p>
        <p className="text-sm text-text-secondary text-center max-w-[240px]">
          Your captain will see your response. You'll be notified once a match date is confirmed.
        </p>
        <a href="/" className="px-6 py-3 rounded-xl bg-accent text-black font-bold text-sm">Back to Home</a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-accent/10 border border-accent/30 rounded-xl p-4">
        <p className="text-sm font-semibold text-accent mb-1">Action needed</p>
        <p className="text-xs text-text-secondary">
          Your captain has proposed the following dates for the next match. Tap all the dates you're available for.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {request.date_options.map((opt) => {
          const isSelected = selected.includes(opt.id);
          return (
            <button
              key={opt.id}
              onClick={() => toggle(opt.id)}
              className={`flex items-center gap-4 p-4 rounded-2xl border transition-all text-left ${
                isSelected ? "bg-accent/10 border-accent/60" : "bg-surface-2 border-border"
              }`}
            >
              <div className={`w-14 h-14 rounded-xl flex flex-col items-center justify-center flex-shrink-0 ${isSelected ? "bg-accent text-black" : "bg-background"}`}>
                <span className="text-[10px] font-bold uppercase">{opt.month}</span>
                <span className="text-2xl font-bold leading-none">{opt.day}</span>
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">{opt.dayName}</p>
                <p className="text-xs text-text-secondary">{opt.date} · KO {opt.time}</p>
              </div>
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${isSelected ? "border-accent bg-accent" : "border-border"}`}>
                {isSelected && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
              </div>
            </button>
          );
        })}
      </div>

      <button
        onClick={handleSubmit}
        disabled={selected.length === 0 || saving}
        className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {saving ? (
          <><svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Saving…</>
        ) : `Submit Availability (${selected.length} selected)`}
      </button>
    </div>
  );
}

// ── Captain Create Request Form ───────────────────────────────
function CreateRequestForm({ teamId, onCreated }: { teamId: string; onCreated: (req: AvailabilityRequest) => void }) {
  const { user } = useAuth();
  const [rows, setRows] = useState([
    { date: "", time: "14:00" },
    { date: "", time: "14:00" },
    { date: "", time: "11:00" },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateRow = (i: number, field: "date" | "time", value: string) => {
    setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  };

  const addRow = () => {
    if (rows.length < 5) setRows((prev) => [...prev, { date: "", time: "14:00" }]);
  };

  const removeRow = (i: number) => {
    if (rows.length > 1) setRows((prev) => prev.filter((_, idx) => idx !== i));
  };

  const handleSubmit = async () => {
    if (!user) return;
    const filled = rows.filter((r) => r.date && r.time);
    if (filled.length < 2) { setError("Add at least 2 date options."); return; }
    setSaving(true);
    setError(null);

    const date_options = filled.map((r) => parseDateOption(r.date, r.time));

    const { data, error: insertError } = await supabase
      .from("availability_requests")
      .insert({ team_id: teamId, captain_id: user.id, date_options })
      .select()
      .single();

    setSaving(false);
    if (insertError) { setError(insertError.message); return; }
    onCreated(data);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-surface-2 border border-border rounded-xl p-4">
        <p className="text-sm font-semibold mb-1">Send availability request</p>
        <p className="text-xs text-text-secondary">Add 2–5 date options. Your squad will vote on which they can make.</p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {rows.map((row, i) => (
          <div key={i} className="bg-surface-2 border border-border rounded-xl p-3 flex items-center gap-3">
            <div className="flex-1 flex flex-col gap-2">
              <input
                type="date"
                value={row.date}
                onChange={(e) => updateRow(i, "date", e.target.value)}
                className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/60"
              />
              <input
                type="time"
                value={row.time}
                onChange={(e) => updateRow(i, "time", e.target.value)}
                className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/60"
              />
            </div>
            {rows.length > 1 && (
              <button onClick={() => removeRow(i)} className="w-8 h-8 rounded-full border border-border flex items-center justify-center flex-shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {rows.length < 5 && (
        <button onClick={addRow} className="flex items-center gap-2 text-sm text-accent font-medium py-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          Add date option
        </button>
      )}

      <button
        onClick={handleSubmit}
        disabled={saving}
        className="w-full py-3.5 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {saving ? (
          <><svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Sending…</>
        ) : "Send to Squad"}
      </button>
    </div>
  );
}

// ── Captain View ──────────────────────────────────────────────
function CaptainAvailability() {
  const { user } = useAuth();
  const router = useRouter();
  const [teamId, setTeamId] = useState<string | null>(null);
  const [request, setRequest] = useState<AvailabilityRequest | null>(null);
  const [responses, setResponses] = useState<PlayerResponse[]>([]);
  const [totalMembers, setTotalMembers] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      // Get captain's team
      const { data: team } = await supabase
        .from("teams")
        .select("id")
        .eq("captain_id", user.id)
        .maybeSingle();

      if (!team) { setLoading(false); return; }
      setTeamId(team.id);

      // Count approved members
      const { count } = await supabase
        .from("team_members")
        .select("*", { count: "exact", head: true })
        .eq("team_id", team.id)
        .eq("status", "approved");
      setTotalMembers(count ?? 0);

      // Get latest request
      const { data: req } = await supabase
        .from("availability_requests")
        .select("*")
        .eq("team_id", team.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!req) { setLoading(false); return; }
      setRequest(req);

      // Get all responses
      const { data: resps } = await supabase
        .from("availability_responses")
        .select("player_id, available_date_ids, profiles(full_name)")
        .eq("request_id", req.id);

      setResponses((resps ?? []) as PlayerResponse[]);
      setLoading(false);
    })();
  }, [user]);

  const countAvailable = (dateId: string) =>
    responses.filter((r) => r.available_date_ids.includes(dateId)).length;

  const getBestDate = () => {
    if (!request) return null;
    return request.date_options.reduce((best, d) =>
      countAvailable(d.id) > countAvailable(best.id) ? d : best
    );
  };

  const handleConfirm = () => {
    if (!chosen || !request) return;
    const d = request.date_options.find((o) => o.id === chosen);
    if (d) {
      // Build ISO date from stored display date by parsing the stored date
      const months: Record<string, string> = { JAN:"01",FEB:"02",MAR:"03",APR:"04",MAY:"05",JUN:"06",JUL:"07",AUG:"08",SEP:"09",OCT:"10",NOV:"11",DEC:"12" };
      const isoDate = `${d.date.split(" ")[3]}-${months[d.month] ?? "01"}-${d.day}`;
      localStorage.setItem("unitr_confirmed_date", JSON.stringify({
        display: d.date, isoDate, time: d.time, dayName: d.dayName,
      }));
    }
    router.push("/play/create");
  };

  if (loading) return <div className="py-12 text-center text-sm text-text-secondary">Loading…</div>;

  if (!teamId) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-text-secondary">You need to register a team first.</p>
        <a href="/my-team/create" className="mt-3 inline-block px-5 py-2.5 rounded-xl bg-accent text-black font-bold text-sm">Register Team</a>
      </div>
    );
  }

  if (!request) {
    return <CreateRequestForm teamId={teamId} onCreated={setRequest} />;
  }

  const best = getBestDate();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div className="bg-surface-2 border border-border rounded-xl p-4 flex-1">
          <p className="text-xs text-text-secondary mb-1">
            {responses.length}/{totalMembers} players responded
          </p>
          <p className="text-sm font-semibold">Select the best date for your match</p>
        </div>
        <button
          onClick={() => { setRequest(null); }}
          className="ml-3 px-3 py-2 rounded-xl border border-border text-xs text-text-secondary"
        >
          New request
        </button>
      </div>

      {best && (
        <div className="bg-accent/10 border border-accent/40 rounded-2xl p-4 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-accent text-black flex flex-col items-center justify-center flex-shrink-0">
            <span className="text-[9px] font-bold uppercase">{best.month}</span>
            <span className="text-xl font-bold leading-none">{best.day}</span>
          </div>
          <div>
            <p className="text-xs text-accent font-semibold uppercase tracking-wider mb-0.5">Best availability</p>
            <p className="text-sm font-bold">{best.dayName} · {best.time}</p>
            <p className="text-xs text-text-secondary">{countAvailable(best.id)}/{totalMembers} players available</p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {request.date_options.map((opt) => {
          const count = countAvailable(opt.id);
          const pct = totalMembers > 0 ? Math.round((count / totalMembers) * 100) : 0;
          const isBest = best?.id === opt.id;
          const isChosen = chosen === opt.id;
          const availablePlayers = responses.filter((r) => r.available_date_ids.includes(opt.id));
          const unavailablePlayers = responses.filter((r) => !r.available_date_ids.includes(opt.id));

          return (
            <button
              key={opt.id}
              onClick={() => setChosen(opt.id)}
              className={`rounded-2xl border p-4 text-left transition-all ${
                isChosen ? "bg-accent/10 border-accent/60"
                : isBest ? "bg-surface-2 border-accent/30"
                : "bg-surface-2 border-border"
              }`}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center flex-shrink-0 ${isChosen ? "bg-accent text-black" : "bg-background"}`}>
                  <span className="text-[9px] font-bold uppercase">{opt.month}</span>
                  <span className="text-xl font-bold leading-none">{opt.day}</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{opt.dayName}</p>
                    {isBest && <span className="text-[10px] font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded-md">Best</span>}
                  </div>
                  <p className="text-xs text-text-secondary">KO {opt.time}</p>
                </div>
                <span className="text-sm font-bold text-accent">{count}/{totalMembers}</span>
              </div>

              <div className="w-full h-1.5 bg-background rounded-full mb-2">
                <div className={`h-1.5 rounded-full transition-all ${isBest || isChosen ? "bg-accent" : "bg-border"}`} style={{ width: `${pct}%` }} />
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                {availablePlayers.map((p) => {
                  const name = p.profiles?.full_name ?? "Player";
                  return (
                    <div key={p.player_id} title={name}
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border bg-accent/20 border-accent/40 text-accent">
                      {getInitials(name)}
                    </div>
                  );
                })}
                {unavailablePlayers.map((p) => {
                  const name = p.profiles?.full_name ?? "Player";
                  return (
                    <div key={p.player_id} title={name}
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border bg-surface border-border text-text-secondary opacity-40">
                      {getInitials(name)}
                    </div>
                  );
                })}
              </div>
            </button>
          );
        })}
      </div>

      <button
        disabled={!chosen}
        onClick={handleConfirm}
        className="w-full py-3.5 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Confirm Date &amp; Post Match
      </button>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────
export default function AvailabilityPage() {
  const { role } = useRole();

  return (
    <div className="flex flex-col min-h-screen px-4 pt-12 pb-8">
      <div className="flex items-center gap-3 mb-6">
        <a href={role === "captain" ? "/my-team" : "/"}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </a>
        <div>
          <h1 className="text-xl font-bold">
            {role === "captain" ? "Team Availability" : "Your Availability"}
          </h1>
          <p className="text-xs text-text-secondary mt-0.5">
            {role === "captain"
              ? "See which date works best for your squad"
              : "Select the dates you can play"}
          </p>
        </div>
      </div>

      {role === "captain" ? <CaptainAvailability /> : <PlayerAvailability />}
    </div>
  );
}
