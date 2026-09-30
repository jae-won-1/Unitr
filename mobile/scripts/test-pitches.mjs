// Seed / remove dummy pitches, for testing Post a Match, Challenge and (later)
// Book a Pitch on the phone and the web.
//
//   node mobile/scripts/test-pitches.mjs seed
//   node mobile/scripts/test-pitches.mjs undo
//
// Run from the repo root. Uses the service-role key in .env.local, so it
// writes to the LIVE database.
//
// Four pitches, all named "[TEST] …", owned by testvenue@gmail.com (a venue
// manager test account — sign in as it on the web to see their bookings in
// the venue portal). A mix of formats and prices, open 07:00–22:00 every day
// except "[TEST] Riverside Cage", which is closed on Sundays so the
// "not free at your times" state can be seen. No Stripe Connect account, so a
// venue payout for one simply records as not sent.
//
// The one exposure while seeded: pitches are public, so real users of the
// live site see these in the pitch lists too. `undo` removes them together
// with their opening hours and any bookings made on them.
//
// State lives in mobile/scripts/.test-pitches.json (gitignored).

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

const VENUE_OWNER = "538c9c6a-1178-404c-ab33-04c1834bd3e4"; // testvenue@gmail.com
const stateFile = path.join(root, "mobile", "scripts", ".test-pitches.json");

const PITCHES = [
  {
    name: "[TEST] Hackney Marshes 3G",
    address: "Homerton Rd, London E9 5PF",
    lat: 51.5563, lng: -0.0319,
    price_per_hour: 60,
    formats: ["5-a-side", "7-a-side", "8-a-side"],
    surfaces: ["3G"],
    rating: 4.6,
    description: "Test pitch — floodlit 3G, changing rooms.",
    closedSunday: false,
  },
  {
    name: "[TEST] Clapham Common Astro",
    address: "Clapham Common South Side, London SW4 9DE",
    lat: 51.4561, lng: -0.1466,
    price_per_hour: 45,
    formats: ["5-a-side", "7-a-side"],
    surfaces: ["Astro"],
    rating: 4.3,
    description: "Test pitch — small-sided astro.",
    closedSunday: false,
  },
  {
    name: "[TEST] Wembley Powerleague",
    address: "Forty Ave, Wembley HA9 9PF",
    lat: 51.5599, lng: -0.2816,
    price_per_hour: 90,
    formats: ["8-a-side", "11-a-side"],
    surfaces: ["3G", "Grass"],
    rating: 4.8,
    description: "Test pitch — full size, 11-a-side.",
    closedSunday: false,
  },
  {
    name: "[TEST] Riverside Cage",
    address: "Riverside Walk, London SE1 9PH",
    lat: 51.5075, lng: -0.0996,
    price_per_hour: 40,
    formats: ["5-a-side", "8-a-side"],
    surfaces: ["Astro"],
    rating: 4.0,
    description: "Test pitch — closed on Sundays.",
    closedSunday: true,
  },
];

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
  const state = { pitchIds: [] };
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2)); // first, so undo always has it

  for (const { closedSunday, ...p } of PITCHES) {
    const row = await must(`insert ${p.name}`, db.from("pitches").insert({
      ...p,
      venue_owner_id: VENUE_OWNER,
      contact_email: "testvenue@gmail.com",
      capacity: 22,
      amenities: [],
      is_verified: true,
    }).select("id").single());
    state.pitchIds.push(row.id);
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

    // Weekly opening hours live in pitch_availability (supabase_venue.sql). A
    // database without it treats every pitch as always open — skipped, not fatal.
    const { error: hoursErr } = await db.from("pitch_availability").insert(
      Array.from({ length: 7 }, (_, day) => ({
        pitch_id: row.id,
        day_of_week: day,
        open_time: "07:00",
        close_time: "22:00",
        is_active: !(closedSunday && day === 0),
      })),
    );
    if (hoursErr && !/schema cache|does not exist/i.test(hoursErr.message)) throw new Error(`hours for ${p.name}: ${hoursErr.message}`);
    if (hoursErr) state.noHours = true;
    console.log(`  ${p.name.padEnd(30)} £${p.price_per_hour}/hr  ${p.formats.join(", ")}${closedSunday ? "  (closed Sundays)" : ""}`);
  }
  console.log(`Seeded ${state.pitchIds.length} test pitches, owned by testvenue@gmail.com.`);
  if (state.noHours) console.log("No opening-hours table on this database (supabase_venue.sql not run) — every pitch counts as open, including Riverside on Sundays.");
  console.log("They show in Post a Match → Add Pitch Option. Run `undo` to remove them.");
}

async function undo() {
  if (!fs.existsSync(stateFile)) {
    console.error("Nothing to undo — no state file.", stateFile);
    process.exit(1);
  }
  const { pitchIds = [] } = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  if (pitchIds.length) {
    await must("bookings", db.from("pitch_bookings").delete().in("pitch_id", pitchIds));
    const { error: hErr } = await db.from("pitch_availability").delete().in("pitch_id", pitchIds);
    if (hErr && !/schema cache|does not exist/i.test(hErr.message)) throw new Error(`opening hours: ${hErr.message}`);
    await must("pitches", db.from("pitches").delete().in("id", pitchIds));
  }
  fs.unlinkSync(stateFile);
  console.log(`Removed ${pitchIds.length} test pitches, their opening hours and any bookings on them.`);
  console.log("Posts that named them keep the name in their pitch options — take those down separately.");
}

const cmd = process.argv[2];
try {
  if (cmd === "seed") await seed();
  else if (cmd === "undo") await undo();
  else {
    console.error("Usage: node mobile/scripts/test-pitches.mjs seed|undo");
    process.exit(1);
  }
} catch (err) {
  console.error(err.message);
  console.error("If this was `seed`, run `undo` to remove whatever was written.");
  process.exit(1);
}
