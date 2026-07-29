// Reconcile Stripe → venue_transfers.
//
// A payout is created in Stripe first and recorded in Supabase second
// (app/api/connect/venue-transfer/route.ts). If the insert ever fails, the
// money shows in the connected account but never in the venue's Reports.
// This script re-reads Stripe and writes any missing ledger row, using the
// pitchId / bookingId / teamId / openMatchId carried in transfer metadata.
//
// Run AFTER supabase_venue_payouts.sql:  node scripts/backfill-venue-transfers.mjs
// Add --apply to write; without it the script only reports what it would do.

import { readFileSync } from "node:fs";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const apply = process.argv.includes("--apply");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const { data: recorded, error } = await db.from("venue_transfers").select("stripe_transfer_id");
if (error) {
  console.error("Could not read venue_transfers:", error.message);
  process.exit(1);
}
const known = new Set(recorded.filter((r) => r.stripe_transfer_id).map((r) => r.stripe_transfer_id));

const transfers = await stripe.transfers.list({ limit: 100 });
const missing = transfers.data.filter((t) => !known.has(t.id));

if (missing.length === 0) {
  console.log(`All ${transfers.data.length} Stripe transfers are recorded. Nothing to backfill.`);
  process.exit(0);
}

console.log(`${missing.length} Stripe transfer(s) missing from venue_transfers:\n`);
for (const t of missing) {
  const md = t.metadata ?? {};
  console.log(`  ${t.id}  £${(t.amount / 100).toFixed(2)}  ${new Date(t.created * 1000).toISOString()}`);
  console.log(`    pitch=${md.pitchId || "?"} team=${md.teamId || "-"} openMatch=${md.openMatchId || "-"} booking=${md.bookingId || "-"}`);

  if (!md.pitchId) { console.log("    SKIPPED — no pitchId in metadata\n"); continue; }
  if (!apply) { console.log("    (dry run — pass --apply to write)\n"); continue; }

  const { error: insErr } = await db.from("venue_transfers").insert({
    pitch_id: md.pitchId,
    booking_id: md.bookingId || null,
    match_id: md.matchId || null,
    team_id: md.teamId || null,
    open_match_id: md.openMatchId || null,
    stripe_account_id: typeof t.destination === "string" ? t.destination : t.destination?.id ?? null,
    stripe_transfer_id: t.id,
    amount_pence: t.amount,
    currency: t.currency,
    status: "paid",
    created_at: new Date(t.created * 1000).toISOString(),
  });
  console.log(insErr ? `    FAILED — ${insErr.message}\n` : "    recorded\n");
}
