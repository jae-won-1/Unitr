// PHASE 0 BRIDGE SPIKE — delete once Phase 1 puts a real screen here.
//
// This screen exists to answer one question before any porting work is built on
// top of it: does the mobile app actually get to run the web app's business
// logic, unmodified, from its own folder?
//
// It imports lib/match-dates.ts — the same file app/calendar/page.tsx imports —
// through the @shared/lib alias, and exercises two things that would each sink
// the shared-logic plan in a different way:
//
//   1. RESOLUTION. If Metro cannot reach outside mobile/, the import fails and
//      nothing below renders. That is the whole layout decision, tested.
//
//   2. HERMES Intl. match-dates.ts decides whether a fixture has kicked off by
//      formatting "now" as a Europe/London wall clock, so the answer never
//      depends on the viewer's device timezone. React Native runs on Hermes,
//      not V8, and Hermes has historically shipped without full ICU — where the
//      `timeZone` option is *silently ignored* rather than throwing. That
//      failure mode is invisible until a player in a different timezone sees
//      the wrong fixtures, so it is probed directly rather than assumed.

import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { fmtKickoff, isKickoffPast, sortKey, toDateKey } from '@shared/lib/match-dates';

// `blocking: false` means a failure is known-survivable under the current
// deployment assumptions (see the timeZone note below) — it should be visible
// but must not be read as "do not proceed".
type Check = { name: string; pass: boolean; detail: string; blocking?: boolean };

function runChecks(): Check[] {
  const checks: Check[] = [];
  const eq = (name: string, actual: unknown, expected: unknown) =>
    checks.push({
      name,
      pass: actual === expected,
      detail: `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`,
    });

  // --- 1. The shared module is reachable and behaves ---------------------
  eq('toDateKey passes ISO through', toDateKey('2026-07-30'), '2026-07-30');
  eq('toDateKey parses legacy display shape', toDateKey('Wed, 03 JUN 2026'), '2026-06-03');
  eq('toDateKey returns "" for junk', toDateKey('not a date'), '');
  eq('toDateKey handles null', toDateKey(null), '');

  // The actual bug this file was written to kill: compared raw, the legacy
  // string sorts ABOVE the ISO one ("W" > "2"), so a played June fixture shows
  // as upcoming forever. Normalised, June must sort below July.
  checks.push({
    name: 'legacy date sorts before later ISO date',
    pass: toDateKey('Wed, 03 JUN 2026') < toDateKey('2026-07-30'),
    detail: `raw comparison is still wrong ("Wed, 03 JUN 2026" > "2026-07-30" = ${
      'Wed, 03 JUN 2026' > '2026-07-30'
    }), normalised must be right`,
  });

  eq('sortKey pads kickoff time', sortKey('2026-07-30', '9:00'), '2026-07-30 09:00');

  // --- 2. Hermes Intl -----------------------------------------------------
  // isKickoffPast() leans on Intl twice, and the two failures have VERY
  // different consequences, so they are checked separately.
  const instant = new Date('2026-01-15T12:00:00Z');
  let london = '', seoul = '';
  try {
    london = instant.toLocaleString('sv-SE', { timeZone: 'Europe/London' });
    seoul = instant.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' });
  } catch (e) {
    london = seoul = `threw: ${String(e)}`;
  }

  // (B) BLOCKING, regardless of where the app is used.
  // "sv-SE" is chosen because Swedish formatting yields a sortable
  // "YYYY-MM-DD HH:mm:ss". If Hermes lacks the locale and falls back to en-US
  // ("1/15/2026, 12:00:00 PM"), the string comparison in isKickoffPast inverts
  // — "2026-…" < "1/15/…" is false — and NOTHING is ever past. The feed stops
  // filtering played games, fixtures never leave Upcoming, and the event
  // take-down button never hides, which is a refund path. This breaks in
  // London exactly as badly as anywhere else.
  checks.push({
    name: 'BLOCKING — sv-SE gives a sortable date format',
    pass: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(london),
    detail: `want "YYYY-MM-DD HH:mm:ss", got "${london}"`,
  });

  // (A) Not blocking while every player is in the UK on a UK-set phone: if the
  // timeZone option is ignored, the fallback is device-local time, which in
  // London IS Europe/London. Kept because it is free to check and becomes
  // load-bearing the moment anyone uses the app from another timezone.
  // Midday UTC in January is 12:00 in London (GMT) and 21:00 in Seoul (KST);
  // if timeZone is ignored, both render identically.
  checks.push({
    name: 'non-blocking (UK-only) — timeZone option honoured',
    pass: london.startsWith('2026-01-15 12:00') && seoul.startsWith('2026-01-15 21:00'),
    detail: `London=${london}  Seoul=${seoul}`,
    blocking: false,
  });

  // And the function that depends on it.
  eq('isKickoffPast: 2020 fixture is past', isKickoffPast('2020-01-01', '12:00'), true);
  eq('isKickoffPast: 2099 fixture is not', isKickoffPast('2099-01-01', '12:00'), false);
  eq(
    'isKickoffPast reads the legacy shape too',
    isKickoffPast('Wed, 03 JUN 2020', '12:00'),
    true,
  );

  // Deliberately NOT an exact-string match. toLocaleDateString's `weekday:
  // "short"` separator moves with the engine's ICU version — Node 24 renders
  // "Sat 13 Jun", browsers render "Sat, 13 Jun", and Hermes is a third data
  // point. The comma is cosmetic, so assert the parts that carry meaning and
  // print the real output so the difference stays visible rather than being
  // baked into a brittle assertion.
  const kickoff = fmtKickoff('2026-06-13', '16:00');
  checks.push({
    name: 'fmtKickoff renders day, month and time',
    pass: /Sat/.test(kickoff) && /13 Jun/.test(kickoff) && kickoff.endsWith('16:00'),
    detail: kickoff,
  });

  return checks;
}

export default function BridgeSpike() {
  const checks = runChecks();
  const blockingFails = checks.filter((c) => !c.pass && c.blocking !== false).length;
  const softFails = checks.filter((c) => !c.pass && c.blocking === false).length;

  let verdict: string;
  let tone;
  if (blockingFails > 0) {
    verdict = `FAIL — ${blockingFails} blocking`;
    tone = styles.bad;
  } else if (softFails > 0) {
    verdict = `PASS — ${softFails} non-blocking issue${softFails > 1 ? 's' : ''}, safe for UK-only`;
    tone = styles.warn;
  } else {
    verdict = `PASS — all ${checks.length} checks`;
    tone = styles.ok;
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Phase 0 — shared logic bridge</Text>
      <Text style={styles.sub}>
        Importing <Text style={styles.code}>@shared/lib/match-dates</Text> — the same file the
        web app uses. Nothing here is copied.
      </Text>

      <View style={[styles.verdict, tone]}>
        <Text style={styles.verdictText}>{verdict}</Text>
      </View>

      {checks.map((c) => (
        <View key={c.name} style={styles.row}>
          <Text
            style={[
              styles.mark,
              c.pass ? styles.markOk : c.blocking === false ? styles.markWarn : styles.markBad,
            ]}>
            {c.pass ? '✓' : c.blocking === false ? '!' : '✗'}
          </Text>
          <View style={styles.rowBody}>
            <Text style={styles.name}>{c.name}</Text>
            <Text style={styles.detail}>{c.detail}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#0b0f0b' },
  content: { padding: 20, paddingTop: 64, gap: 12 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700' },
  sub: { color: '#9aa79a', fontSize: 13, lineHeight: 19 },
  code: { color: '#00E676', fontFamily: 'monospace' },
  verdict: { borderRadius: 10, padding: 14, marginTop: 8 },
  ok: { backgroundColor: '#008000' },
  warn: { backgroundColor: '#8a6d00' },
  bad: { backgroundColor: '#8b1a1a' },
  verdictText: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 6 },
  rowBody: { flex: 1 },
  mark: { fontSize: 15, fontWeight: '700', width: 16 },
  markOk: { color: '#00E676' },
  markWarn: { color: '#ffc44d' },
  markBad: { color: '#ff6b6b' },
  name: { color: '#e8efe8', fontSize: 14 },
  detail: { color: '#7d887d', fontSize: 11, fontFamily: 'monospace', marginTop: 2 },
});
