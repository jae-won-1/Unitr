// Finish the test-data purge, in foreign-key-safe order.
//
// The first attempt deleted tables in an order that ignored several
// non-cascading FKs (messages->matches, pitch_bookings->match_posts,
// open_matches->pitch_bookings, pitch_bookings->pitches), so those deletes
// failed and everything downstream of them survived. This one walks the graph
// leaf-first instead.
//
//   node scripts/finish-purge.mjs           # dry run
//   node scripts/finish-purge.mjs --apply   # write
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const apply = process.argv.includes("--apply");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const DELETE_TEAM_NAMES = new Set(["RegentFC","KCL 5","EarlsfieldFC","Team 1","OrielFC","Wimbledon FC"]);
// Team 2's captain stays: Team 2 is kept alive and needs one.
const KEEP_ACCOUNT_IDS = new Set(["585e9fdf-f7f6-4e0f-9cec-aa8f6c43a758"]);
const KEEP_EMAILS = new Set([
  "jay1choii1@gmail.com","bigchoi3635@gmail.com","jaewon.choi@kcl.ac.uk","jkang030408@gmail.com",
  "vxbrandon00@gmail.com","vanja.bucher@gmail.com","emilytony1108@gmail.com","unitradmin@gmail.com",
  "jjkang517@gamil.com","koreankim@gmail.com","sghailane65@gmail.com","imadzaman.p@gmail.com",
  "gjtpdud96@naver.com","jeehan.kim05@gmail.com","jb9809@naver.com",
]);

const { data: teams } = await db.from("teams").select("id,name");
const delTeamIds = teams.filter(t => DELETE_TEAM_NAMES.has(t.name)).map(t=>t.id);
const delTeamSet = new Set(delTeamIds);

const { data: mp } = await db.from("match_posts").select("id,team_id");
const delPostIds = mp.filter(r=>delTeamSet.has(r.team_id)).map(r=>r.id);

const { data: matches } = await db.from("matches").select("id,posting_team_id,challenging_team_id");
const delMatchIds = matches.filter(r=>delTeamSet.has(r.posting_team_id)||delTeamSet.has(r.challenging_team_id)).map(r=>r.id);

const { data: om } = await db.from("open_matches").select("id,title");
const { data: pb } = await db.from("pitch_bookings").select("id");
const { data: pitches } = await db.from("pitches").select("id,name");

let page=1, users=[];
for(;;){const {data}=await db.auth.admin.listUsers({page,perPage:200});users=users.concat(data.users);if(data.users.length<200)break;page++;}
const delUsers = users.filter(u => !KEEP_EMAILS.has((u.email??"").toLowerCase()) && !KEEP_ACCOUNT_IDS.has(u.id));

console.log("matches           ", delMatchIds.length, "/", matches.length);
console.log("open_matches      ", om.length, "/", om.length, "(all — every pitch is dummy)");
console.log("pitch_bookings    ", pb.length, "/", pb.length, "(all)");
console.log("match_posts       ", delPostIds.length, "/", mp.length, "(Team 2's + Twickenham's survive)");
console.log("pitches           ", pitches.length, "/", pitches.length, "(all)");
console.log("teams             ", delTeamIds.length, "/", teams.length, ":", teams.filter(t=>delTeamSet.has(t.id)).map(t=>t.name).join(", "));
console.log("accounts          ", delUsers.length, ":", delUsers.map(u=>u.email).join(", "));

if (!apply) { console.log("\n[DRY RUN] nothing written. Re-run with --apply"); process.exit(0); }

console.log("\n=== APPLYING (leaf-first) ===");
const step = async (label, fn) => {
  const { error, count } = await fn();
  console.log(` ${label}: ${error ? "ERROR " + error.message : "deleted " + count}`);
};
// 1. matches — `messages` is already empty, so nothing references these now.
await step("matches", () => db.from("matches").delete({ count:"exact" }).in("id", delMatchIds));
// 2. open_matches BEFORE pitch_bookings: open_matches.booking_id -> pitch_bookings has no cascade.
await step("open_matches", () => db.from("open_matches").delete({ count:"exact" }).not("id","is",null));
// 3. Break the match_posts <-> pitch_bookings cycle. secured_booking_id points at
//    a booking, and that booking's post_id points back, so neither table can go
//    first. Every booking is dummy and being deleted, so a post that claims a
//    secured pitch has to stop claiming it — leaving pitch_secured true with no
//    booking behind it is a lie the booking UI would trip over.
await step("match_posts.secured_booking_id -> null", () =>
  db.from("match_posts").update({ secured_booking_id: null, pitch_secured: false }, { count:"exact" })
    .not("secured_booking_id","is",null));
// 4. pitch_bookings BEFORE match_posts and pitches: it references both without cascade.
await step("pitch_bookings", () => db.from("pitch_bookings").delete({ count:"exact" }).not("id","is",null));
// 4. match_posts — now unreferenced.
await step("match_posts", () => db.from("match_posts").delete({ count:"exact" }).in("id", delPostIds));
// 5. pitches — now unreferenced.
await step("pitches", () => db.from("pitches").delete({ count:"exact" }).not("id","is",null));
// 6. teams, then the accounts behind them.
await step("teams", () => db.from("teams").delete({ count:"exact" }).in("id", delTeamIds));
await step("profiles", () => db.from("profiles").delete({ count:"exact" }).in("id", delUsers.map(u=>u.id)));
let ok=0, fail=[];
for (const u of delUsers) {
  const { error } = await db.auth.admin.deleteUser(u.id);
  if (error) fail.push(`${u.email}: ${error.message}`); else ok++;
}
console.log(` auth users: deleted ${ok}${fail.length ? "\n   FAILED:\n   " + fail.join("\n   ") : ""}`);
