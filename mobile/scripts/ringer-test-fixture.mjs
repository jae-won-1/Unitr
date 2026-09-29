// Seed / remove the rows needed to test a Fill In payment from the phone.
//
//   node mobile/scripts/ringer-test-fixture.mjs seed
//   node mobile/scripts/ringer-test-fixture.mjs undo
//
// Run from the repo root. Uses the service-role key in .env.local, so it
// writes to the LIVE database — which is why it is two commands and not one,
// and why `seed` should be run right before a test and `undo` right after.
//
// What it seeds, all tagged [RN-PORT TEST]:
//   • a friendly one week out, "Test " vs "Test " (NMcaptain's test team on
//     both sides — no real team is touched)
//   • one open ringer request on it, £5, one spot, posted by NMcaptain
//
// Who pays: Test Captain (testcaptain@gmail.com). It is in no squad, so the
// request isn't hidden from it the way a team's own request is hidden from its
// members. Its profile holds a LIVE Stripe customer id, which a test-mode
// server can't use ("No such customer"), so `seed` saves that id and clears
// it, and `undo` puts it back. Without the restore, that account's live
// payments would later fail against a test-mode customer id.
//
// The one exposure while seeded: Fill In is a global feed, so the request is
// visible to every signed-in user on the live site too. The notes say not to
// join and the window should be minutes. `undo` deletes the ringer signup and
// match confirmation the test payment creates, then the request and match.
//
// State lives in mobile/scripts/.ringer-fixture.json (gitignored) between the
// two commands.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(path.join(root, "package.json"));
const { createClient } = require("@supabase/supabase-js");

const envFile = path.join(root, ".env.local");
if (!fs.existsSync(envFile)) {
  console.error("Run this from the repo root — .env.local not found.");
  process.exit(1);
}
const env = Object.fromEntries(
  fs.readFileSync(envFile, "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const TEST_TEAM = "5acdfadd-9fee-4d5c-9fcf-9552abda7bfc"; // "Test ", captained by NMcaptain
const NM_CAPTAIN = "fc1a8311-4fcb-4fe5-8be5-8d4c25aa925b";
const PAYER = "e32a7622-b0da-47af-9433-7ed801818e99"; // testcaptain@gmail.com
const TAG = "[RN-PORT TEST]";
const stateFile = path.join(root, "mobile", "scripts", ".ringer-fixture.json");

function isoDaysAhead(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

async function seed() {
  if (fs.existsSync(stateFile)) {
    console.error("Already seeded — run `undo` first.", stateFile);
    process.exit(1);
  }

  const payer = await must("read payer",
    db.from("profiles").select("full_name, stripe_customer_id").eq("id", PAYER).single());
  const membership = await must("payer membership",
    db.from("team_members").select("team_id").eq("player_id", PAYER));
  if (membership.length) throw new Error("Test Captain is in a squad now — pick another payer.");

  // Written first, so a failure below still leaves enough behind for undo.
  const state = { savedCustomerId: payer.stripe_customer_id ?? null, matchId: null, requestId: null };
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

  const match = await must("insert match", db.from("matches").insert({
    posting_team_id: TEST_TEAM,
    challenging_team_id: TEST_TEAM,
    confirmed_pitch: { name: `${TAG} Test pitch` },
    match_date: isoDaysAhead(7),
    match_time: "19:00",
  }).select("id").single());
  state.matchId = match.id;
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

  const request = await must("insert ringer request", db.from("ringer_requests").insert({
    match_id: match.id,
    team_id: TEST_TEAM,
    posted_by: NM_CAPTAIN,
    positions: [],
    spots: 1,
    price_pence: 500,
    notes: `${TAG} Testing the mobile app — please don't join.`,
    status: "open",
  }).select("id").single());
  state.requestId = request.id;
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

  if (state.savedCustomerId) {
    await must("clear payer customer id",
      db.from("profiles").update({ stripe_customer_id: null }).eq("id", PAYER));
  }

  console.log("Seeded.");
  console.log(`  match      ${match.id} (${isoDaysAhead(7)} 19:00)`);
  console.log(`  request    ${request.id}`);
  console.log(`  payer      ${payer.full_name} — live customer id ${state.savedCustomerId ? "saved and cleared" : "was empty"}`);
  console.log("Sign in on the phone as testcaptain@gmail.com, open Home → Find a game → Fill In.");
  console.log("Run `undo` as soon as the test is done.");
}

async function undo() {
  if (!fs.existsSync(stateFile)) {
    console.error("Nothing to undo — no state file.", stateFile);
    process.exit(1);
  }
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));

  if (state.requestId) {
    await must("delete signups", db.from("ringer_signups").delete().eq("request_id", state.requestId));
  }
  if (state.matchId) {
    await must("delete confirmations", db.from("match_confirmations").delete().eq("match_id", state.matchId));
  }
  if (state.requestId) {
    await must("delete request", db.from("ringer_requests").delete().eq("id", state.requestId));
  }
  if (state.matchId) {
    await must("delete match", db.from("matches").delete().eq("id", state.matchId));
  }

  // Put the live customer id back — or, if the account had none, clear the
  // test-mode one the local server wrote during the payment.
  await must("restore payer customer id",
    db.from("profiles").update({ stripe_customer_id: state.savedCustomerId }).eq("id", PAYER));

  fs.unlinkSync(stateFile);
  console.log("Removed the test match, request and any signup; payer's customer id restored.");
}

const cmd = process.argv[2];
try {
  if (cmd === "seed") await seed();
  else if (cmd === "undo") await undo();
  else {
    console.error("Usage: node mobile/scripts/ringer-test-fixture.mjs seed|undo");
    process.exit(1);
  }
} catch (err) {
  console.error(err.message);
  console.error("If this was `seed`, run `undo` to remove whatever was written.");
  process.exit(1);
}
