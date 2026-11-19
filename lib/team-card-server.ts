import { stripe } from "@/lib/stripe";
import { adminSupabase } from "@/lib/supabase-admin";
import { loadNames, STRIPE_LIVEMODE } from "@/lib/team-finance-server";
import type { TeamCard } from "@/lib/team-finance";

// The team card — server half (supabase_team_card.sql). A card a leader saves
// on a Stripe customer that belongs to the team, used to pay for the team's
// event entries (lib/event-entry-server.ts).

export type TeamCardRow = {
  team_id: string;
  stripe_customer_id: string;
  stripe_payment_method_id: string | null;
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
  funding: string | null;
  saved_by: string | null;
};

/** Thrown while supabase_team_card.sql hasn't been run. */
export class TeamCardTableMissing extends Error {}

const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

export async function loadTeamCard(teamId: string): Promise<TeamCardRow | null> {
  const { data, error } = await adminSupabase
    .from("team_cards")
    .select("team_id, stripe_customer_id, stripe_payment_method_id, brand, last4, exp_month, exp_year, funding, saved_by")
    .eq("team_id", teamId).eq("livemode", STRIPE_LIVEMODE).maybeSingle();
  if (error) {
    if (MISSING_TABLE.has(error.code ?? "")) throw new TeamCardTableMissing();
    throw new Error(`team card lookup failed: ${error.message}`);
  }
  return (data as TeamCardRow | null) ?? null;
}

/** The team's Stripe customer, created the first time a leader adds a card. */
export async function ensureTeamCustomer(teamId: string): Promise<string> {
  const existing = await loadTeamCard(teamId);
  if (existing) return existing.stripe_customer_id;

  const { data: team } = await adminSupabase.from("teams").select("name").eq("id", teamId).maybeSingle();
  const customer = await stripe.customers.create(
    {
      name: (team?.name as string | undefined)?.trim() || "Uniter team",
      metadata: { teamId, type: "uniter_team" },
    },
    // Two leaders tapping at once must not give the team two customers.
    { idempotencyKey: `team-customer-${teamId}-${STRIPE_LIVEMODE ? "live" : "test"}` },
  );
  const { error } = await adminSupabase.from("team_cards").upsert(
    { team_id: teamId, livemode: STRIPE_LIVEMODE, stripe_customer_id: customer.id },
    { onConflict: "team_id,livemode", ignoreDuplicates: true },
  );
  if (error) throw new Error(`team card row failed: ${error.message}`);
  return (await loadTeamCard(teamId))?.stripe_customer_id ?? customer.id;
}

/** What a leader's screen shows: the saved card, or nothing. */
export async function describeTeamCard(row: TeamCardRow | null, callerId: string): Promise<TeamCard | null> {
  if (!row?.stripe_payment_method_id) return null;
  const savedByName = row.saved_by ? (await loadNames([row.saved_by])).get(row.saved_by) ?? null : null;
  return {
    brand: row.brand,
    last4: row.last4,
    expMonth: row.exp_month,
    expYear: row.exp_year,
    funding: row.funding,
    savedByName,
    savedByMe: row.saved_by === callerId,
  };
}
