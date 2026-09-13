#!/usr/bin/env node
//
// Which supabase_*.sql files have actually been run?
//
//   node scripts/check-migrations.mjs            # summary
//   node scripts/check-migrations.mjs --verbose  # name every missing object
//
// Migrations here are applied by hand in the Supabase SQL editor, so the repo
// has no record of what a given database has seen. Asking "did I run that one?"
// weeks later is guesswork, and guessing wrong either skips a migration or
// re-runs one. This asks the database instead.
//
// It reads every supabase_*.sql, pulls out the tables, columns and functions
// the file creates, and checks them against the live schema — PostgREST serves
// its whole OpenAPI spec from one request, so this is a single round trip and
// no arbitrary SQL. Uses SUPABASE_SERVICE_ROLE_KEY from .env.local.
//
// WHAT IT CANNOT SEE: RLS policies, grants and revokes, triggers, and the
// bodies of functions that already existed. A file that only tightens policies
// (supabase_core_tables_rls.sql, and the policy half of
// supabase_pilot_security.sql) can therefore report "applied" off its other
// objects while its policies are not — objects are the evidence available, and
// the script says so rather than pretending otherwise.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");

// ── Credentials ─────────────────────────────────────────────────────────
function readEnv() {
  const out = { ...process.env };
  const file = path.join(root, ".env.local");
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const i = line.indexOf("=");
      if (i < 1 || line.trimStart().startsWith("#")) continue;
      const k = line.slice(0, i).trim();
      if (!out[k]) out[k] = line.slice(i + 1).trim();
    }
  }
  return out;
}

const env = readEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL and a key in .env.local");
  process.exit(1);
}

// ── What the live database has ──────────────────────────────────────────
const res = await fetch(`${url}/rest/v1/`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
if (!res.ok) {
  console.error(`Could not read the schema: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const spec = await res.json();

const liveColumns = new Map(); // table -> Set(column)
for (const [table, def] of Object.entries(spec.definitions ?? {})) {
  liveColumns.set(table, new Set(Object.keys(def.properties ?? {})));
}
const liveFunctions = new Set(
  Object.keys(spec.paths ?? {})
    .filter((p) => p.startsWith("/rpc/"))
    .map((p) => p.slice(5)),
);

// ── What each file claims to create ─────────────────────────────────────
function parse(sql) {
  // Strip line comments so a commented-out rollback block (every migration
  // here ends with one) is not mistaken for live statements.
  const text = sql.replace(/^\s*--.*$/gm, "");
  const tables = new Set();
  const columns = [];   // [table, column]
  const functions = new Set();

  for (const m of text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?/gi)) {
    tables.add(m[1]);
  }

  // One `alter table` can add several columns, comma-separated across lines.
  for (const m of text.matchAll(/alter\s+table\s+(?:only\s+)?(?:public\.)?"?(\w+)"?([\s\S]*?);/gi)) {
    const table = m[1];
    for (const c of m[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/gi)) {
      columns.push([table, c[1]]);
    }
  }

  // Trigger functions are not callable over PostgREST, so they never appear in
  // the spec and would read as permanently missing. Skip them.
  for (const m of text.matchAll(
    /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\)\s*returns\s+(\w+)/gi,
  )) {
    if (m[3].toLowerCase() === "trigger") continue;
    functions.add(m[1]);
  }

  return { tables, columns, functions };
}

// ── Compare ─────────────────────────────────────────────────────────────
const files = fs
  .readdirSync(root)
  .filter((f) => f.startsWith("supabase_") && f.endsWith(".sql"))
  .sort();

const rows = [];
for (const file of files) {
  const { tables, columns, functions } = parse(fs.readFileSync(path.join(root, file), "utf8"));
  const found = [];
  const missing = [];

  for (const t of tables) {
    (liveColumns.has(t) ? found : missing).push(`table ${t}`);
  }
  for (const [t, c] of columns) {
    // A column on a table that does not exist is reported by the table, not twice.
    if (!liveColumns.has(t)) continue;
    (liveColumns.get(t).has(c) ? found : missing).push(`${t}.${c}`);
  }
  for (const f of functions) {
    (liveFunctions.has(f) ? found : missing).push(`function ${f}()`);
  }

  const checked = found.length + missing.length;
  let status;
  if (checked === 0) status = "NO OBJECTS";           // policy/grant-only file
  else if (missing.length === 0) status = "applied";
  else if (found.length === 0) status = "NOT RUN";
  else status = "PARTIAL";

  rows.push({ file, status, found: found.length, checked, missing });
}

// ── Report ──────────────────────────────────────────────────────────────
const mark = { applied: "ok  ", "NOT RUN": "MISS", PARTIAL: "PART", "NO OBJECTS": "  ? " };
const width = Math.max(...rows.map((r) => r.file.length));

console.log(`\n${spec.info?.title ?? "database"} — ${files.length} migration files\n`);
for (const r of rows) {
  const detail = r.checked === 0 ? "no tables/columns/functions to check — policies or grants only"
                                 : `${r.found}/${r.checked} objects`;
  console.log(`  ${mark[r.status]}  ${r.file.padEnd(width)}  ${detail}`);
  if (verbose || r.status === "PARTIAL") {
    for (const m of r.missing) console.log(`        missing: ${m}`);
  }
}

const notRun = rows.filter((r) => r.status === "NOT RUN");
const partial = rows.filter((r) => r.status === "PARTIAL");
console.log("");
if (notRun.length) console.log(`  NOT RUN  ${notRun.map((r) => r.file).join(", ")}`);
if (partial.length) console.log(`  PARTIAL  ${partial.map((r) => r.file).join(", ")}`);
if (!notRun.length && !partial.length) console.log("  Every migration's objects are present.");
console.log(
  "\n  Objects only. Policies, grants and triggers are invisible here — a file\n" +
  "  that only tightens RLS can look applied when it is not.\n",
);
