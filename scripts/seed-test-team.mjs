// Seed a test squad and give test teams credit to play with.
//
// Creates (or reuses) a captain and four players, registers them as the team
// "test2", and grants £200 of credit each to "test2" and the existing "test".
//
// The credit is a 'deposit' ledger row with no PaymentIntent and no player —
// the same shape record_cash_credit writes, which /admin/finance already
// reports as manual credit ("no money moved") apart from card top-ups, so
// Stripe still reconciles against the card figure. No player means it never
// pays down a joining fee and is never allocated to anyone's card on a
// cash-out (lib/team-refunds.ts reads deposits per player).
//
// Run against the database in .env.local (service-role key required):
//   SEED_PASSWORD=<password> node scripts/seed-test-team.mjs          dry run
//   SEED_PASSWORD=<password> node scripts/seed-test-team.mjs --apply  write
// Credit only, to teams named on the command line (no accounts, no password):
//   node scripts/seed-test-team.mjs --credit-only --teams=Nomoney,test --apply
// Safe to re-run: existing accounts, the team and memberships are reused, and
// a team that already has its £200 test grant is not credited twice.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const apply = process.argv.includes("--apply");
const creditOnly = process.argv.includes("--credit-only");
const teamsArg = process.argv.find((a) => a.startsWith("--teams="));
const password = process.env.SEED_PASSWORD;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceKey) { console.error("SUPABASE_SERVICE_ROLE_KEY is not set in .env.local."); process.exit(1); }
if (!creditOnly && (!password || password.length < 6)) {
  console.error("Set SEED_PASSWORD (6+ characters) — every seeded account signs in with it.");
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const NEW_TEAM = "test2";
const CREDIT_TEAMS = teamsArg
  ? teamsArg.slice("--teams=".length).split(",").map((t) => t.trim()).filter(Boolean)
  : ["test", NEW_TEAM];
const GRANT_PENCE = 20000;

// example.com is reserved and never delivers, so nothing is ever mailed.
const PEOPLE = [
  { email: "test2.captain@example.com", name: "Test2 Captain", position: "CM" },
  { email: "test2.player1@example.com", name: "Test2 Player 1", position: "GK" },
  { email: "test2.player2@example.com", name: "Test2 Player 2", position: "CB" },
  { email: "test2.player3@example.com", name: "Test2 Player 3", position: "CAM" },
  { email: "test2.player4@example.com", name: "Test2 Player 4", position: "ST" },
];

console.log(`Database: ${url}`);
console.log(apply ? "Mode: APPLY — writing\n" : "Mode: dry run — pass --apply to write\n");

function fail(what, error) {
  console.error(`${what}: ${error.message}`);
  process.exit(1);
}

if (!creditOnly) await seedSquad();
async function seedSquad() {
// ── Accounts ────────────────────────────────────────────────────────────
const { data: listed, error: listErr } = await db.auth.admin.listUsers({ perPage: 1000 });
if (listErr) fail("Could not list users", listErr);
const byEmail = new Map(listed.users.map((u) => [u.email?.toLowerCase(), u]));

const ids = [];
for (const p of PEOPLE) {
  let user = byEmail.get(p.email);
  if (user) {
    console.log(`  account   ${p.email} exists`);
  } else if (!apply) {
    console.log(`  account   ${p.email} would be created`);
  } else {
    const { data, error } = await db.auth.admin.createUser({
      email: p.email, password, email_confirm: true, user_metadata: { full_name: p.name },
    });
    if (error) fail(`Could not create ${p.email}`, error);
    user = data.user;
    console.log(`  account   ${p.email} created`);
  }
  ids.push(user?.id ?? null);

  if (!user) continue;
  const { data: profile } = await db.from("profiles").select("id").eq("id", user.id).maybeSingle();
  if (profile) continue;
  if (!apply) { console.log(`  profile   ${p.name} would be created`); continue; }

  // The same row lib/register-profile.ts writes at sign-up.
  const row = {
    id: user.id, full_name: p.name, location: "London", position: p.position, positions: [p.position],
    experience: "Casual", games_per_month: "1-2", preferred_football_type: "friendly",
    age_group: "25-34", gender: "male", account_type: "player",
  };
  let { error } = await db.from("profiles").insert(row);
  if (error?.message.includes("positions")) {
    delete row.positions;
    ({ error } = await db.from("profiles").insert(row));
  }
  if (error) fail(`Could not create profile for ${p.email}`, error);
  console.log(`  profile   ${p.name} created`);
}

// ── The team ────────────────────────────────────────────────────────────
const [captainId, ...playerIds] = ids;

const { data: existingTeams, error: teamErr } = await db.from("teams").select("id, name, captain_id").ilike("name", NEW_TEAM);
if (teamErr) fail("Could not read teams", teamErr);
let teamId = existingTeams[0]?.id ?? null;

if (existingTeams.length > 1) {
  console.error(`\nMore than one team is named "${NEW_TEAM}" — resolve that by hand first.`);
  process.exit(1);
}
if (teamId) {
  console.log(`\n  team      "${NEW_TEAM}" exists`);
  if (captainId && existingTeams[0].captain_id !== captainId) {
    console.error(`  "${NEW_TEAM}" is captained by someone else — refusing to add players to it.`);
    process.exit(1);
  }
} else if (!apply) {
  console.log(`\n  team      "${NEW_TEAM}" would be created`);
} else {
  // The row /my-team/create writes. No joining fee, so the squad can vote
  // available straight away (lib/availability-gate.ts).
  const row = {
    name: NEW_TEAM, location: "London", level: "Casual", format: "5-a-side", formats: ["5-a-side"],
    description: "Test team — not a real squad.", captain_id: captainId,
    joining_fee_pence: 0, gender_category: "male",
  };
  let { data, error } = await db.from("teams").insert(row).select("id").single();
  if (error?.message.includes("formats")) {
    delete row.formats;
    ({ data, error } = await db.from("teams").insert(row).select("id").single());
  }
  if (error) fail(`Could not create "${NEW_TEAM}"`, error);
  teamId = data.id;
  console.log(`\n  team      "${NEW_TEAM}" created`);
}

if (teamId) {
  for (const [i, playerId] of playerIds.entries()) {
    if (!playerId) continue;
    const { data: other } = await db.from("team_members")
      .select("team_id").eq("player_id", playerId).eq("status", "approved").neq("team_id", teamId);
    if (other?.length) { console.log(`  member    ${PEOPLE[i + 1].name} is in another squad — skipped`); continue; }
    if (!apply) { console.log(`  member    ${PEOPLE[i + 1].name} would be added`); continue; }
    const { error } = await db.from("team_members")
      .upsert({ team_id: teamId, player_id: playerId, status: "approved" }, { onConflict: "team_id,player_id" });
    if (error) fail(`Could not add ${PEOPLE[i + 1].name}`, error);
    console.log(`  member    ${PEOPLE[i + 1].name} approved`);
  }
} else if (!apply) {
  console.log(`  member    ${playerIds.length} players would be added`);
}
}

// ── Credit ──────────────────────────────────────────────────────────────
console.log("");
for (const name of CREDIT_TEAMS) {
  // Matched with surrounding spaces ignored: a name typed as "Test " in the
  // app is still the team called Test.
  const { data: candidates, error } = await db.from("teams").select("id, name").ilike("name", `%${name}%`);
  const teams = (candidates ?? []).filter((t) => t.name.trim().toLowerCase() === name.toLowerCase());
  if (error) fail(`Could not read team "${name}"`, error);
  if (teams.length === 0) {
    console.log(`  credit    "${name}" ${name === NEW_TEAM && !apply ? "would get £200 once created" : "not found — skipped"}`);
    const { data: near } = await db.from("teams").select("name").ilike("name", `%${name}%`).limit(10);
    if (near?.length) console.log(`            similar names: ${near.map((t) => `"${t.name}"`).join(", ")}`);
    continue;
  }
  if (teams.length > 1) { console.log(`  credit    ${teams.length} teams named "${name}" — skipped, ambiguous`); continue; }
  const id = teams[0].id;

  const { data: prior } = await db.from("team_credit_transactions").select("id")
    .eq("team_id", id).eq("type", "deposit").eq("amount_pence", GRANT_PENCE)
    .is("player_id", null).is("stripe_payment_intent_id", null).limit(1);
  if (prior?.length) { console.log(`  credit    "${name}" already has its test grant — skipped`); continue; }
  if (!apply) { console.log(`  credit    "${name}" would get £${GRANT_PENCE / 100}`); continue; }

  const { data: bal } = await db.from("team_credits").select("balance_pence").eq("team_id", id).maybeSingle();
  const next = (bal?.balance_pence ?? 0) + GRANT_PENCE;
  const { error: balErr } = await db.from("team_credits")
    .upsert({ team_id: id, balance_pence: next, updated_at: new Date().toISOString() }, { onConflict: "team_id" });
  if (balErr) fail(`Could not credit "${name}"`, balErr);
  const { error: txErr } = await db.from("team_credit_transactions")
    .insert({ team_id: id, player_id: null, type: "deposit", amount_pence: GRANT_PENCE });
  if (txErr) fail(`Credited "${name}" but could not write its ledger row — add it by hand`, txErr);
  console.log(`  credit    "${name}" +£${GRANT_PENCE / 100} → balance £${(next / 100).toFixed(2)}`);
}

if (!creditOnly) console.log(`\nSign in with any of the emails above and the SEED_PASSWORD you chose.`);
