"use client";

// Admin hub — every event this admin hosts, upcoming and past. The admin has
// no team, so the Calendar stays empty for them; this list is their calendar.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { isUpcomingDate, fmtKickoff, sortKey } from "@/lib/match-dates";
import { loadEventRevenue, fmtPence, type EventRevenue } from "@/lib/event-revenue";

type HostedEvent = {
  id: string;
  title: string;
  match_type: string;
  pitch_name: string;
  venue_address: string | null;
  match_date: string;
  start_time: string;
  max_teams: number;
  price_per_team_pence: number;
  status: string;
  joined: number;
  revenue: EventRevenue;
};

const TYPE_LABEL: Record<string, string> = { tournament: "Tournament", league: "League", match: "Friendly" };

function EventCard({ ev }: { ev: HostedEvent }) {
  const upcoming = isUpcomingDate(ev.match_date);
  return (
    <Link href={`/play/tournament/${ev.id}`}
      className="block bg-surface-2 border border-border rounded-2xl p-4 hover:border-accent/40 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <p className="font-bold text-sm truncate">{ev.title}</p>
        <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/30 px-2 py-0.5 rounded-full flex-shrink-0">
          {TYPE_LABEL[ev.match_type] ?? ev.match_type}
        </span>
      </div>
      <p className="text-xs text-text-secondary mt-1 truncate">{ev.pitch_name}{ev.venue_address ? ` · ${ev.venue_address}` : ""}</p>
      <div className="flex items-center justify-between mt-2">
        <p className="text-xs text-text-secondary">{fmtKickoff(ev.match_date, ev.start_time)}</p>
        <p className="text-xs font-semibold">
          {ev.joined}/{ev.max_teams} teams
          <span className="text-text-secondary font-normal"> · £{(ev.price_per_team_pence / 100).toFixed(2)}/team</span>
        </p>
      </div>
      {ev.status !== "open" && (
        <p className="text-[10px] font-semibold text-text-secondary mt-1 uppercase">{ev.status}</p>
      )}

      {/* What the event has actually taken. Buy-ins are debited one team at a
          time, so this is the ledger's sum rather than teams x list price —
          an invited team may have paid a discounted buy-in. */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
        <p className="text-[11px] text-text-secondary">{upcoming ? "Taken so far" : "Revenue"}</p>
        <p className="text-xs font-bold tabular-nums">
          {fmtPence(ev.revenue.collectedPence)}{ev.revenue.estimated ? " est." : ""}
          {upcoming && ev.revenue.potentialPence > ev.revenue.collectedPence && (
            <span className="text-text-secondary font-normal"> · {fmtPence(ev.revenue.potentialPence)} if full</span>
          )}
        </p>
      </div>
    </Link>
  );
}

function Section({ title, events, empty }: { title: string; events: HostedEvent[]; empty: string }) {
  return (
    <section>
      <h3 className="font-bold mb-2">{title}</h3>
      {events.length === 0 ? (
        <div className="bg-surface-2 border border-border rounded-2xl p-5 text-center">
          <p className="text-sm text-text-secondary">{empty}</p>
        </div>
      ) : (
        <div className="space-y-2">{events.map((ev) => <EventCard key={ev.id} ev={ev} />)}</div>
      )}
    </section>
  );
}

export default function AdminHubPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState<HostedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const { data, error: err } = await supabase.from("open_matches")
        .select("id, title, match_type, pitch_name, venue_address, match_date, start_time, max_teams, price_per_team_pence, status")
        .eq("organiser_admin_id", user!.id);

      if (err) {
        // 42703: organiser_admin_id doesn't exist yet — migration not run.
        setError(err.code === "42703"
          ? "Run supabase_admin_hosting.sql in the Supabase SQL editor first."
          : err.message);
        setLoading(false);
        return;
      }

      const rows = data ?? [];
      // Entry counts and takings come from the same pass — loadEventRevenue
      // reads open_match_teams anyway, so 'joined' rides along with it.
      const revenue = await loadEventRevenue(rows);
      const blank = { collectedPence: 0, payingTeams: 0, entries: 0, discountsPence: 0, potentialPence: 0, estimated: false };
      setEvents(rows.map((r) => {
        const rev = revenue.get(r.id) ?? blank;
        return { ...r, joined: rev.entries, revenue: rev } as HostedEvent;
      }));
      setLoading(false);
    }
    load();
  }, [user]);

  if (loading) return <div className="flex justify-center py-10"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;

  if (error) {
    return <div className="bg-surface-2 border border-border rounded-2xl p-5 text-center text-sm text-text-secondary">{error}</div>;
  }

  const upcoming = events
    .filter((e) => isUpcomingDate(e.match_date))
    .sort((a, b) => sortKey(a.match_date, a.start_time).localeCompare(sortKey(b.match_date, b.start_time)));
  const past = events
    .filter((e) => !isUpcomingDate(e.match_date))
    .sort((a, b) => sortKey(b.match_date, b.start_time).localeCompare(sortKey(a.match_date, a.start_time)));
  const totalCollected = events.reduce((sum, e) => sum + e.revenue.collectedPence, 0);
  const totalPayingTeams = events.reduce((sum, e) => sum + e.revenue.payingTeams, 0);
  const totalDiscounts = events.reduce((sum, e) => sum + e.revenue.discountsPence, 0);
  const estimatedTotals = events.some((e) => e.revenue.estimated);

  return (
    <div className="flex flex-col gap-6">
      <Link href="/admin/create"
        className="block w-full py-3 rounded-xl bg-accent text-black font-bold text-sm text-center">
        + Host an event
      </Link>

      {/* Everything this admin's events have taken. Admin-hosted buy-ins stay
          with the platform (the admin paid the venue in cash outside the app),
          so this total is Unitr's, not a balance owed on to anyone. */}
      <div className="bg-surface-2 border border-border rounded-2xl p-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-text-secondary">Revenue from your events</p>
            <p className="text-2xl font-extrabold tabular-nums mt-0.5">{fmtPence(totalCollected)}</p>
          </div>
          <p className="text-[11px] text-text-secondary text-right">
            {events.length} event{events.length === 1 ? "" : "s"}<br />
            {totalPayingTeams} paid entr{totalPayingTeams === 1 ? "y" : "ies"}
          </p>
        </div>
        {totalDiscounts > 0 && (
          <p className="text-[11px] text-text-secondary mt-2 pt-2 border-t border-border">
            After {fmtPence(totalDiscounts)} of invitation discounts.
          </p>
        )}
        {estimatedTotals && (
          <p className="text-[11px] text-text-secondary mt-2 pt-2 border-t border-border">
            Estimated from entries at list price — run supabase_credit_ledger.sql for exact figures.
          </p>
        )}
      </div>
      {/* Both sections always render so the page keeps a fixed shape. */}
      <Section title="Upcoming" events={upcoming} empty="Nothing hosted yet — post a tournament, league or friendly." />
      <Section title="Past" events={past} empty="Past events will appear here." />
    </div>
  );
}
