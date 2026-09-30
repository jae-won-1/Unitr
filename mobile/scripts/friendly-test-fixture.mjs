// Seed / remove a confirmed friendly for NMcaptain's "Test " team, to test
// Manage Match (and anything else friendly-shaped) from the phone or the web.
//
//   node mobile/scripts/friendly-test-fixture.mjs seed
//   node mobile/scripts/friendly-test-fixture.mjs open-post [pounds]
//   node mobile/scripts/friendly-test-fixture.mjs undo
//
// `open-post` (after `seed`) adds an OPEN post by the opponent team for
// NMcaptain to Challenge from the phone's Find a game feed. The pitch costs
// [pounds] (default 2, so each side pays £1), and the opponent's account is
// given enough test credit to pay its own half. Pick more than twice the Test
// team's balance to try the shortfall ("Pay £X towards your half").
// Accepting it moves real rows in the live ledger; `undo` puts back whatever
// the accept took from the Test team and removes the rest.
//
// Run from the repo root. Uses the service-role key in .env.local, so it
// writes to the LIVE database — seed right before testing, undo right after.
//
// What it seeds, all tagged [RN-PORT TEST], one week out at 19:00, 8-a-side:
//   • an opponent team, "[RN-PORT TEST] Opponents", captained by Test Captain
//     (testcaptain@gmail.com) — the only test team is "Test ", and a team
//     playing itself makes both squads the same list;
//   • the rows a real accepted challenge leaves behind, so the Calendar, My
//     Team and Home all find it: a `matched` match_posts row by NMcaptain, an
//     `accepted` challenges row by Test Captain, and the `matches` row;
//   • a pending match_confirmations row for each squad member on both sides
//     (NMcaptain, nmplayer, Test Captain), as ChallengePanel writes them.
//
// No money: the pitch costs £0, hold_pence is 0, and no booking, credit hold
// or payment row is written. The one exposure while seeded: the opponent team
// is a real team row, so it shows in "teams to join" on the live site until
// `undo` removes it.
//
// `undo` also removes whatever testing added to the match — tactics, tasks,
// ringer requests and signups, results — then the match, post, challenge and
// the opponent team.
//
// State lives in mobile/scripts/.friendly-fixture.json (gitignored).

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
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const TEST_TEAM = "5acdfadd-9fee-4d5c-9fcf-9552abda7bfc"; // "Test ", captained by NMcaptain
const NM_CAPTAIN = "fc1a8311-4fcb-4fe5-8be5-8d4c25aa925b"; // nmcaptain@gmail.com
const OPP_CAPTAIN = "e32a7622-b0da-47af-9433-7ed801818e99"; // testcaptain@gmail.com
const TAG = "[RN-PORT TEST]";
const stateFile = path.join(root, "mobile", "scripts", ".friendly-fixture.json");

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function daysAhead(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

const save = (state) => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

async function seed() {
  if (fs.existsSync(stateFile)) {
    console.error("Already seeded — run `undo` first.", stateFile);
    process.exit(1);
  }
  const captains = await must("opponent captain's teams", db.from("teams").select("id").eq("captain_id", OPP_CAPTAIN));
  const memberships = await must("opponent captain's squads", db.from("team_members").select("team_id").eq("player_id", OPP_CAPTAIN));
  if (captains.length || memberships.length) {
    throw new Error("testcaptain@gmail.com is already in a team — pick another opponent captain.");
  }

  const state = { oppTeamId: null, postId: null, challengeId: null, matchId: null, openPostId: null };
  save(state); // first, so a failure below still leaves enough for undo

  const when = daysAhead(7);
  const date = isoOf(when);
  const time = "19:00";
  const pitch = { name: `${TAG} Test pitch`, address: "Not a real pitch", price: 0, format: "8-a-side", time };

  const opp = await must("insert opponent team", db.from("teams").insert({
    name: `${TAG} Opponents`,
    captain_id: OPP_CAPTAIN,
    location: "Test",
    level: "Casual",
    format: "8-a-side",
    description: `${TAG} Temporary opponent for testing — please ignore.`,
  }).select("id, name").single());
  state.oppTeamId = opp.id;
  save(state);

  const test = await must("read Test team", db.from("teams").select("name, location").eq("id", TEST_TEAM).single());

  const post = await must("insert post", db.from("match_posts").insert({
    team_id: TEST_TEAM,
    captain_id: NM_CAPTAIN,
    team_name: test.name,
    team_location: test.location ?? "",
    status: "matched",
    payment_mode: "individual",
    hold_pence: 0,
    match_date: date,
    match_time: time,
    day_name: DAY_NAMES[when.getDay()],
    pitch_options: [pitch],
  }).select("id").single());
  state.postId = post.id;
  save(state);

  const challenge = await must("insert challenge", db.from("challenges").insert({
    post_id: post.id,
    challenger_team_id: opp.id,
    challenger_team_name: opp.name,
    challenger_captain_id: OPP_CAPTAIN,
    selected_pitch: pitch,
    status: "accepted",
  }).select("id").single());
  state.challengeId = challenge.id;
  save(state);

  const match = await must("insert match", db.from("matches").insert({
    post_id: post.id,
    posting_team_id: TEST_TEAM,
    challenging_team_id: opp.id,
    confirmed_pitch: pitch,
    match_date: date,
    match_time: time,
  }).select("id").single());
  state.matchId = match.id;
  save(state);

  // Approved squad + both captains, pending — what accepting a challenge writes.
  const members = await must("squads", db.from("team_members").select("player_id, team_id")
    .in("team_id", [TEST_TEAM, opp.id]).eq("status", "approved"));
  const everyone = [
    ...members,
    { player_id: NM_CAPTAIN, team_id: TEST_TEAM },
    { player_id: OPP_CAPTAIN, team_id: opp.id },
  ].filter((p, i, all) => all.findIndex((x) => x.player_id === p.player_id) === i);
  await must("insert confirmations", db.from("match_confirmations").insert(
    everyone.map((p) => ({ match_id: match.id, player_id: p.player_id, team_id: p.team_id, status: "pending" })),
  ));

  console.log("Seeded.");
  console.log(`  friendly   Test  vs ${opp.name}, ${date} ${time}, 8-a-side, £0`);
  console.log(`  match      ${match.id}`);
  console.log(`  squads     ${everyone.length} players asked "are you playing?" (all pending)`);
  console.log("Sign in as nmcaptain@gmail.com (captain) or nmplayer@gmail.com (player):");
  console.log("  Calendar → tap the friendly → Manage match.");
  console.log("Run `undo` when you're done.");
}

async function openPost(pounds) {
  if (!fs.existsSync(stateFile)) throw new Error("Run `seed` first — the open post belongs to its opponent team.");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  if (state.openPostId) throw new Error("There's already an open test post — run `undo` first.");
  const price = Number.isFinite(pounds) && pounds > 0 ? pounds : 2;
  const when = daysAhead(9);
  const pitch = { id: "rn-port-test-option", name: `${TAG} Challenge pitch`, address: "Not a real pitch", price, format: "8-a-side", time: "20:00" };
  const post = await must("insert open post", db.from("match_posts").insert({
    team_id: state.oppTeamId,
    captain_id: OPP_CAPTAIN,
    team_name: `${TAG} Opponents`,
    team_location: "Test",
    status: "open",
    payment_mode: "individual",
    hold_pence: 0,
    match_date: isoOf(when),
    match_time: "20:00",
    day_name: DAY_NAMES[when.getDay()],
    pitch_options: [pitch],
    description: `${TAG} Testing the mobile app — please don't challenge.`,
  }).select("id").single());
  state.openPostId = post.id;
  save(state);
  // The opponent pays its own half (the poster absorbs the odd penny).
  const posterHalf = Math.ceil(Math.round(price * 100) / 2);
  await must("opponent credit", db.from("team_credits").upsert(
    { team_id: state.oppTeamId, balance_pence: posterHalf, reserved_pence: 0 }, { onConflict: "team_id" }));
  const test = await must("Test team credit", db.from("team_credits").select("balance_pence, reserved_pence").eq("team_id", TEST_TEAM).maybeSingle());
  const half = Math.round(price * 100) - posterHalf;
  console.log(`Open post by ${TAG} Opponents: ${isoOf(when)} 20:00, pitch £${price.toFixed(2)} (each side ~£${(half / 100).toFixed(2)}).`);
  console.log(`Test team has £${(((test?.balance_pence ?? 0) - (test?.reserved_pence ?? 0)) / 100).toFixed(2)} available — ${((test?.balance_pence ?? 0) - (test?.reserved_pence ?? 0)) >= half ? "enough to accept outright" : "SHORT, so you'll be asked to pay the gap"}.`);
  console.log("As nmcaptain: Home → Find a game → Matches → Challenge.");
}

async function undo() {
  if (!fs.existsSync(stateFile)) {
    console.error("Nothing to undo — no state file.", stateFile);
    process.exit(1);
  }
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  // A table that doesn't exist on this database is skipped rather than
  // stopping the undo.
  const soft = async (label, promise) => {
    const { error } = await promise;
    if (error && !/does not exist|schema cache/i.test(error.message)) throw new Error(`${label}: ${error.message}`);
  };

  // The open post, and anything accepting it did: the ledger debits are put
  // back on each team's balance before their rows go.
  if (state.openPostId) {
    const accepted = (await db.from("matches").select("id").eq("post_id", state.openPostId)).data ?? [];
    for (const { id } of accepted) {
      const rows = (await db.from("team_credit_transactions").select("team_id, amount_pence").eq("match_id", id)).data ?? [];
      for (const r of rows) {
        const cur = (await db.from("team_credits").select("balance_pence").eq("team_id", r.team_id).maybeSingle()).data;
        if (cur) await must("restore balance", db.from("team_credits").update({ balance_pence: cur.balance_pence - r.amount_pence }).eq("team_id", r.team_id));
      }
      await must("ledger rows", db.from("team_credit_transactions").delete().eq("match_id", id));
      await must("confirmations", db.from("match_confirmations").delete().eq("match_id", id));
      await soft("tactics", db.from("match_tactics").delete().eq("match_id", id));
      await must("accepted match", db.from("matches").delete().eq("id", id));
    }
    await must("challenge on open post", db.from("challenges").delete().eq("post_id", state.openPostId));
    await soft("booking on open post", db.from("pitch_bookings").delete().eq("post_id", state.openPostId));
    await must("open post", db.from("match_posts").delete().eq("id", state.openPostId));
  }

  const m = state.matchId;

  // Children of the match first — whatever testing created. A table that
  // doesn't exist on this database is skipped rather than stopping the undo.
  if (m) {
    const tasks = (await db.from("match_tasks").select("id").eq("match_id", m)).data ?? [];
    if (tasks.length) await soft("task ticks", db.from("match_task_done").delete().in("task_id", tasks.map((t) => t.id)));
    await soft("tasks", db.from("match_tasks").delete().eq("match_id", m));
    const reqs = (await db.from("ringer_requests").select("id").eq("match_id", m)).data ?? [];
    if (reqs.length) await soft("ringer signups", db.from("ringer_signups").delete().in("request_id", reqs.map((r) => r.id)));
    await soft("ringer requests", db.from("ringer_requests").delete().eq("match_id", m));
    await soft("tactics", db.from("match_tactics").delete().eq("match_id", m));
    await soft("result players", db.from("match_result_players").delete().eq("match_id", m));
    await soft("results", db.from("match_results").delete().eq("match_id", m));
    await must("confirmations", db.from("match_confirmations").delete().eq("match_id", m));
    await must("match", db.from("matches").delete().eq("id", m));
  }
  if (state.challengeId) await must("challenge", db.from("challenges").delete().eq("id", state.challengeId));
  if (state.postId) await must("post", db.from("match_posts").delete().eq("id", state.postId));
  if (state.oppTeamId) {
    await soft("opponent credits", db.from("team_credits").delete().eq("team_id", state.oppTeamId));
    await soft("opponent squad", db.from("team_members").delete().eq("team_id", state.oppTeamId));
    await must("opponent team", db.from("teams").delete().eq("id", state.oppTeamId));
  }

  fs.unlinkSync(stateFile);
  console.log("Removed the test friendly, its post and challenge, everything added to it, and the opponent team.");
}

const cmd = process.argv[2];
try {
  if (cmd === "seed") await seed();
  else if (cmd === "open-post") await openPost(Number(process.argv[3]));
  else if (cmd === "undo") await undo();
  else {
    console.error("Usage: node mobile/scripts/friendly-test-fixture.mjs seed|open-post [pounds]|undo");
    process.exit(1);
  }
} catch (err) {
  console.error(err.message);
  console.error("If this was `seed`, run `undo` to remove whatever was written.");
  process.exit(1);
}
