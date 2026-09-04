import type { SupabaseClient } from "@supabase/supabase-js";

// Cashing leftover team credit back out to the cards that funded it.
//
// The rule the captain asked for is "everyone gets the same amount back".
// The rule Stripe imposes is "a refund goes against a charge, and never
// exceeds it". Those disagree the moment contributions were uneven: split
// £50 equally between someone who put in £100 and someone who put in £10 and
// the second refund is £15 against a £10 charge, which Stripe rejects.
//
// So: equal is the target, what each person actually paid is the ceiling, and
// anything a capped player can't take is re-shared among those with headroom
// left. With even contributions — the normal case — it is a plain equal split.

export type Contributor = {
  playerId: string;
  name: string;
  contributedPence: number;   // card money this player put into the team pot
  refundedPence: number;      // already handed back
  refundablePence: number;    // contributed − refunded, floored at 0
};

export type Allocation = { playerId: string; amountPence: number };

export type AllocationResult = {
  allocations: Allocation[];
  // Credit with no card behind it to return: cash top-ups the captain
  // recorded by hand, or money put in by players who have already been
  // refunded in full. It stays in the team's balance.
  unallocatedPence: number;
};

// Water-filling: hand out an equal share, let anyone who hits their ceiling
// stop, re-share what they couldn't take, repeat. Each pass either fills
// someone to their cap or empties the pot, so it terminates.
export function allocateEqually(totalPence: number, contributors: Contributor[]): AllocationResult {
  const alloc = new Map<string, number>();
  const cap = new Map<string, number>();
  for (const c of contributors) {
    if (c.refundablePence > 0) {
      alloc.set(c.playerId, 0);
      cap.set(c.playerId, c.refundablePence);
    }
  }

  let remaining = Math.max(0, Math.round(totalPence));

  for (;;) {
    const open = [...alloc.keys()].filter((id) => alloc.get(id)! < cap.get(id)!);
    if (open.length === 0 || remaining === 0) break;

    const share = Math.floor(remaining / open.length);
    if (share === 0) {
      // Fewer pence left than people. Give them out one at a time, biggest
      // headroom first, so the last few pennies land somewhere predictable
      // rather than being dropped.
      open.sort((a, b) => {
        const ha = cap.get(a)! - alloc.get(a)!;
        const hb = cap.get(b)! - alloc.get(b)!;
        return hb - ha || a.localeCompare(b);
      });
      for (const id of open) {
        if (remaining === 0) break;
        alloc.set(id, alloc.get(id)! + 1);
        remaining -= 1;
      }
      break;
    }

    for (const id of open) {
      const take = Math.min(share, cap.get(id)! - alloc.get(id)!);
      alloc.set(id, alloc.get(id)! + take);
      remaining -= take;
    }
  }

  return {
    allocations: [...alloc.entries()]
      .filter(([, amount]) => amount > 0)
      .map(([playerId, amountPence]) => ({ playerId, amountPence })),
    unallocatedPence: remaining,
  };
}

// Who put card money into this team, and how much of it is still refundable.
export async function loadContributors(
  client: SupabaseClient,
  teamId: string,
): Promise<Contributor[]> {
  const { data, error } = await client
    .from("team_card_contributions")
    .select("player_id, contributed_pence, refunded_pence")
    .eq("team_id", teamId);
  if (error) throw new Error(error.message);

  const rows = (data ?? []).filter((r) => (r.contributed_pence ?? 0) > 0);
  if (rows.length === 0) return [];

  // teams.captain_id → profiles has no FK in the schema cache, and neither
  // does this view — fetch names separately and merge (see CLAUDE.md).
  const ids = rows.map((r) => r.player_id as string);
  const { data: profiles } = await client
    .from("profiles").select("id, full_name").in("id", ids);
  const names = new Map((profiles ?? []).map((p) => [p.id as string, (p.full_name as string) ?? "Player"]));

  return rows
    .map((r) => {
      const contributedPence = Math.round(r.contributed_pence ?? 0);
      const refundedPence = Math.round(r.refunded_pence ?? 0);
      return {
        playerId: r.player_id as string,
        name: names.get(r.player_id as string) ?? "Player",
        contributedPence,
        refundedPence,
        refundablePence: Math.max(0, contributedPence - refundedPence),
      };
    })
    .sort((a, b) => b.refundablePence - a.refundablePence || a.name.localeCompare(b.name));
}

export type RefundableIntent = { paymentIntentId: string; refundablePence: number };

// One player's payments into this team, newest first, each with what is left
// to refund against it. A player's allocation is spread across these because
// a single refund can only ever target one charge.
export async function loadRefundableIntents(
  client: SupabaseClient,
  teamId: string,
  playerId: string,
): Promise<RefundableIntent[]> {
  const { data: deposits } = await client
    .from("team_credit_transactions")
    .select("stripe_payment_intent_id, amount_pence, created_at")
    .eq("team_id", teamId)
    .eq("player_id", playerId)
    .eq("type", "deposit")
    .not("stripe_payment_intent_id", "is", null)
    .order("created_at", { ascending: false });

  const { data: refunds } = await client
    .from("team_credit_transactions")
    .select("refunded_payment_intent_id, amount_pence")
    .eq("team_id", teamId)
    .eq("type", "refund")
    .not("refunded_payment_intent_id", "is", null);

  const takenByIntent = new Map<string, number>();
  for (const r of refunds ?? []) {
    const key = r.refunded_payment_intent_id as string;
    takenByIntent.set(key, (takenByIntent.get(key) ?? 0) + Math.abs(r.amount_pence as number));
  }

  return (deposits ?? [])
    .map((d) => {
      const id = d.stripe_payment_intent_id as string;
      return {
        paymentIntentId: id,
        refundablePence: Math.max(0, Math.round(d.amount_pence as number) - (takenByIntent.get(id) ?? 0)),
      };
    })
    .filter((i) => i.refundablePence > 0);
}
