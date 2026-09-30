// Manage Match for a friendly — the mobile port of
// app/my-team/match/[matchId]/page.tsx. The captain (or a co-captain) manages;
// everyone else, ringers included, reads.
//
// Same four tabs as the web, read as a matchday screen is: what is this game
// (Info), who's coming (Attendance), who's playing (Lineup), how we play
// (Tactics). The same records, written the same way:
//   • the availability answer is match_confirmations keyed on match_id, and
//     sits above the tabs because it's the one question every player opens the
//     page to answer — hidden once a result exists;
//   • the lineup and tactics are this team's private match_tactics row (the
//     opposition never sees it), upserted on match_id,team_id, with the
//     RESOLVED formation written so a size mismatch can't leave an invisible
//     lineup;
//   • a saved setup loads as a copy, its players filtered to who can play;
//   • tasks and ringer requests are their own components, same tables.
//
// Submit Result is its own screen (app/result/[matchId].tsx); this one
// re-reads on focus so a result filed there shows on return. Nothing on this
// screen moves money.

import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { loadLeadership } from '@/lib/team-leadership';
import { fmtKickoff } from '@/lib/match-dates';
import {
  DEFAULT_FORMATION,
  PLAY_STYLES,
  formatLabelForSize,
  formationKeysFor,
  resolveFormation,
  slotsFor,
  teamSizeFromFormat,
} from '@/lib/formations';
import { loadTeamTactics, type TeamTactic } from '@/lib/team-tactics';
import type { ConfirmStatus } from '@/lib/event-availability';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';
import { AvailabilityButtons } from '~/components/availability-buttons';
import { PitchBoard } from '~/components/pitch-board';
import { MatchTasks } from '~/components/match-tasks';
import { RingerRequestPanel } from '~/components/ringer-request-panel';
import { initialsOf } from '~/components/chat';

type PitchInfo = { id?: string; name: string; address?: string; price: number; format?: string };
type Match = {
  id: string;
  postId: string;
  postingTeamId: string;
  challengingTeamId: string;
  postingTeamName: string;
  challengingTeamName: string;
  pitch: PitchInfo | null;
  format: string | null;
  date: string;
  time: string;
};
type Confirmation = { player_id: string; team_id: string; status: string; full_name: string; is_ringer: boolean };
type ResultPlayer = { player_id: string; name: string; started: boolean; subbed_on: boolean; goals: number };
type Score = { teamScore: number; opponentScore: number };
type Tab = 'info' | 'attendance' | 'lineup' | 'tactics';

const TABS: { key: Tab; label: string }[] = [
  { key: 'info', label: 'Info' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'lineup', label: 'Lineup' },
  { key: 'tactics', label: 'Tactics' },
];

export default function ManageMatch() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const { user } = useAuth();

  const [match, setMatch] = useState<Match | null | undefined>(undefined);
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [isCaptain, setIsCaptain] = useState(false);
  const [confirmations, setConfirmations] = useState<Confirmation[]>([]);
  const [originalPost, setOriginalPost] = useState<{ match_date: string; match_time: string } | null>(null);
  const [tab, setTab] = useState<Tab>('info');

  const [formation, setFormation] = useState(DEFAULT_FORMATION);
  const [style, setStyle] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [lineup, setLineup] = useState<Record<number, string>>({});
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [presets, setPresets] = useState<TeamTactic[] | null>([]);
  const [presetOpen, setPresetOpen] = useState(false);

  const [verified, setVerified] = useState(false);
  const [myResult, setMyResult] = useState<Score | null>(null);
  const [oppResult, setOppResult] = useState<Score | null>(null);
  const [myResultPlayers, setMyResultPlayers] = useState<ResultPlayer[]>([]);
  const [oppResultPlayers, setOppResultPlayers] = useState<ResultPlayer[]>([]);

  const load = useCallback(async () => {
    if (!user || !matchId) return;
    const { data: m } = await supabase.from('matches').select('*').eq('id', matchId).maybeSingle();
    if (!m) {
      setMatch(null);
      return;
    }
    const [{ data: pt }, { data: ct }] = await Promise.all([
      supabase.from('teams').select('name, format').eq('id', m.posting_team_id).maybeSingle(),
      supabase.from('teams').select('name').eq('id', m.challenging_team_id).maybeSingle(),
    ]);
    const pitch = (m.confirmed_pitch as PitchInfo | null) ?? null;
    setMatch({
      id: m.id,
      postId: m.post_id,
      postingTeamId: m.posting_team_id,
      challengingTeamId: m.challenging_team_id,
      postingTeamName: (pt?.name as string) ?? 'Unknown',
      challengingTeamName: (ct?.name as string) ?? 'Unknown',
      pitch,
      // How many a side: the pitch the opponent picked, else the posting team's format.
      format: pitch?.format || (pt?.format as string | null) || null,
      date: m.match_date,
      time: m.match_time,
    });

    // is_ringer arrives with supabase_ringers.sql; without it the select fails,
    // so fall back to the pre-ringer shape rather than lose the squad list.
    type Row = { player_id: string; team_id: string; status: string; is_ringer?: boolean; profiles: { full_name: string } | null };
    const first = await supabase
      .from('match_confirmations')
      .select('player_id, team_id, status, is_ringer, profiles(full_name)')
      .eq('match_id', m.id);
    const rows = (first.data ??
      (await supabase.from('match_confirmations').select('player_id, team_id, status, profiles(full_name)').eq('match_id', m.id)).data) as Row[] | null;
    const confs = (rows ?? []).map((c) => ({
      player_id: c.player_id,
      team_id: c.team_id,
      status: c.status,
      full_name: (c.profiles as unknown as { full_name: string } | null)?.full_name ?? 'Unknown',
      is_ringer: Boolean(c.is_ringer),
    }));
    setConfirmations(confs);

    // Which side of this game the viewer is on. A ringer's row names the team
    // they played for, which may not be their own; otherwise it's the team
    // they run or play in. "Captain" means whoever runs THAT team — a
    // co-captain manages a match exactly as the captain does.
    const led = await loadLeadership(user.id);
    const mine = confs.find((c) => c.player_id === user.id)?.team_id;
    const inMatch = (t: string | null | undefined) => (t === m.posting_team_id || t === m.challenging_team_id ? t : null);
    const tid = inMatch(mine) ?? inMatch(led?.teamId) ?? null;
    setMyTeamId(tid);
    setIsCaptain(Boolean(led?.canManage && led.teamId === tid));

    // Did the confirmed slot move from what was posted (an alt-time pitch)?
    if (m.post_id) {
      const { data: post } = await supabase.from('match_posts').select('match_date, match_time').eq('id', m.post_id).maybeSingle();
      setOriginalPost((post as { match_date: string; match_time: string } | null) ?? null);
    }

    if (tid) {
      const { data: tac } = await supabase.from('match_tactics').select('*').eq('match_id', m.id).eq('team_id', tid).maybeSingle();
      if (tac) {
        setFormation(tac.formation ?? DEFAULT_FORMATION);
        setStyle(tac.style ?? null);
        setNotes(tac.notes ?? '');
        setLineup((tac.lineup ?? {}) as Record<number, string>);
      }
      void loadTeamTactics(tid).then(setPresets);

      // Results: both teams' submissions, the players each named, and whether
      // the two agreed (matches.result_verified).
      const [{ data: results }, { data: players }] = await Promise.all([
        supabase.from('match_results').select('team_id, team_score, opponent_score').eq('match_id', m.id),
        supabase.from('match_result_players').select('team_id, player_id, started, subbed_on, goals').eq('match_id', m.id),
      ]);
      const ids = [...new Set((players ?? []).map((p) => p.player_id as string))];
      const { data: profs } = ids.length
        ? await supabase.from('profiles').select('id, full_name').in('id', ids)
        : { data: [] as { id: string; full_name: string }[] };
      const nameById = new Map((profs ?? []).map((p) => [p.id as string, p.full_name as string]));
      setVerified(Boolean(m.result_verified));
      const oppId = tid === m.posting_team_id ? m.challenging_team_id : m.posting_team_id;
      const toScore = (r?: { team_score: number; opponent_score: number }) => (r ? { teamScore: r.team_score, opponentScore: r.opponent_score } : null);
      setMyResult(toScore((results ?? []).find((r) => r.team_id === tid)));
      setOppResult(toScore((results ?? []).find((r) => r.team_id === oppId)));
      type P = { team_id: string; player_id: string; started: boolean; subbed_on: boolean; goals: number };
      const toPlayer = (p: P): ResultPlayer => ({ ...p, name: nameById.get(p.player_id) ?? 'Player' });
      setMyResultPlayers(((players ?? []) as P[]).filter((p) => p.team_id === tid).map(toPlayer));
      setOppResultPlayers(((players ?? []) as P[]).filter((p) => p.team_id === oppId).map(toPlayer));
    }
  }, [user, matchId]);

  // On focus, not just on mount: coming back from Submit Result must show it.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (match === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  if (match === null) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Match not found.</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const isPoster = myTeamId === match.postingTeamId;
  const myTeamName = myTeamId ? (isPoster ? match.postingTeamName : match.challengingTeamName) : match.postingTeamName;
  const opponentId = myTeamId ? (isPoster ? match.challengingTeamId : match.postingTeamId) : match.challengingTeamId;
  const opponentName = myTeamId ? (isPoster ? match.challengingTeamName : match.postingTeamName) : match.challengingTeamName;

  const teamSize = teamSizeFromFormat(match.format);
  const activeFormation = resolveFormation(formation, teamSize);
  const slots = slotsFor(activeFormation, teamSize);

  const myConfs = confirmations.filter((c) => c.team_id === myTeamId);
  const oppConfs = confirmations.filter((c) => c.team_id === opponentId);
  // Pickable: anyone who hasn't ruled themselves out — a captain builds a
  // shape before the last replies land.
  const candidates = myConfs.filter((c) => c.status !== 'declined');
  const nameById = new Map<string, string>([
    ...confirmations.map((c): [string, string] => [c.player_id, c.full_name]),
    ...myResultPlayers.map((p): [string, string] => [p.player_id, p.name]),
  ]);

  const hasResult = !!myResult || !!oppResult;
  const timeChanged = originalPost ? originalPost.match_time !== match.time || originalPost.match_date !== match.date : false;
  const myScorers = myResultPlayers.filter((p) => p.goals > 0);
  const oppScorers = oppResultPlayers.filter((p) => p.goals > 0);
  const myStarters = myResultPlayers.filter((p) => p.started);
  const myBench = myResultPlayers.filter((p) => p.subbed_on);

  const attIn = myConfs.filter((c) => c.status === 'confirmed').length;
  const attOut = myConfs.filter((c) => c.status === 'declined').length;
  const attPending = myConfs.length - attIn - attOut;
  const oppIn = oppConfs.filter((c) => c.status === 'confirmed').length;

  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    setSaveNote(null);
    set(v);
  };

  const assign = (slot: number, playerId: string | null) => {
    setSaveNote(null);
    setLineup((prev) => {
      const next = { ...prev };
      // One slot per player — picking someone already placed moves them here.
      for (const [k, v] of Object.entries(next)) if (v === playerId) delete next[Number(k)];
      if (playerId) next[slot] = playerId;
      else delete next[slot];
      return next;
    });
    setPickerSlot(null);
  };

  const applyPreset = (p: TeamTactic) => {
    setSaveNote(null);
    setFormation(p.formation);
    setStyle(p.style);
    setNotes(p.notes ?? '');
    const eligible = new Set(candidates.map((c) => c.player_id));
    setLineup(Object.fromEntries(Object.entries(p.lineup ?? {}).filter(([, pid]) => eligible.has(pid))) as Record<number, string>);
    setPresetOpen(false);
  };

  const save = async () => {
    if (!myTeamId) return;
    setSaving(true);
    setSaveNote(null);
    const { error } = await supabase.from('match_tactics').upsert(
      { match_id: match.id, team_id: myTeamId, formation: activeFormation, style, notes, lineup },
      { onConflict: 'match_id,team_id' },
    );
    setSaving(false);
    setSaveNote(error ? "Couldn't save. Try again." : 'Saved — the squad can see it now.');
  };

  // Your own tap moves your own row in the attendance list, or the tab a
  // scroll away still calls you Pending.
  const onMyAnswer = (status: ConfirmStatus) => {
    if (!user || !myTeamId) return;
    setConfirmations((prev) =>
      prev.some((c) => c.player_id === user.id)
        ? prev.map((c) => (c.player_id === user.id ? { ...c, status } : c))
        : [...prev, { player_id: user.id, team_id: myTeamId, status, full_name: 'You', is_ringer: false }],
    );
  };

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
        <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      <Text style={styles.heading} numberOfLines={2}>
        {myTeamName} vs {opponentName}
      </Text>

      {!hasResult && myTeamId && user && (
        <AvailabilityButtons target={{ matchId: match.id }} playerId={user.id} teamId={myTeamId} onChanged={onMyAnswer} />
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {TABS.map((t) => (
          <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tab, tab === t.key && styles.tabOn]}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {tab === 'info' && (
        <View style={{ gap: 12 }}>
          <View style={[styles.card, { gap: 14 }]}>
            <View style={styles.scoreRow}>
              <TeamDisc name={myTeamName} mine styles={styles} />
              <View style={{ alignItems: 'center', paddingHorizontal: 8 }}>
                {hasResult ? (
                  <>
                    <Text style={styles.score}>
                      {myResult?.teamScore ?? 0} – {myResult?.opponentScore ?? 0}
                    </Text>
                    <Text style={styles.small}>{verified ? 'Full time' : 'Pending'}</Text>
                  </>
                ) : (
                  <Text style={styles.small}>No result yet</Text>
                )}
              </View>
              <TeamDisc name={opponentName} styles={styles} />
            </View>
            <View style={styles.divider} />
            <View style={{ alignItems: 'center', gap: 2 }}>
              <Text style={styles.small}>{fmtKickoff(match.date, match.time)}</Text>
              {!!match.pitch?.name && <Text style={styles.small}>{match.pitch.name}</Text>}
            </View>
            {(myScorers.length > 0 || oppScorers.length > 0) && (
              <>
                <View style={styles.divider} />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    {myScorers.map((p) => (
                      <Text key={p.player_id} style={styles.small}>
                        ⚽ {p.name}
                        {p.goals > 1 ? ` ×${p.goals}` : ''}
                      </Text>
                    ))}
                  </View>
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    {oppScorers.map((p) => (
                      <Text key={p.player_id} style={styles.small}>
                        {p.name}
                        {p.goals > 1 ? ` ×${p.goals}` : ''} ⚽
                      </Text>
                    ))}
                  </View>
                </View>
              </>
            )}
            {!myResult && isCaptain && (
              <Pressable
                onPress={() => router.push({ pathname: '/result/[matchId]', params: { matchId: match.id } })}
                style={styles.resultBtn}>
                <Text style={styles.primaryText}>Submit Result</Text>
              </Pressable>
            )}
            {myResult && !verified && !oppResult && (
              <Text style={[styles.small, { color: '#B07400', textAlign: 'center' }]}>Waiting for {opponentName} to submit their result</Text>
            )}
          </View>

          {myTeamId && user && (
            <MatchTasks
              matchId={match.id}
              teamId={myTeamId}
              userId={user.id}
              isCaptain={isCaptain}
              squad={myConfs.map((c) => ({ player_id: c.player_id, full_name: c.full_name }))}
            />
          )}
        </View>
      )}

      {tab === 'attendance' && (
        <View style={{ gap: 10 }}>
          <Text style={styles.section}>{myTeamName} · your squad</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {([
              ['Attendees', attIn],
              ['Awaiting reply', attPending],
              ['Unavailable', attOut],
            ] as const).map(([label, n]) => (
              <View key={label} style={styles.stat}>
                <Text style={styles.statN}>{n}</Text>
                <Text style={styles.statLabel}>{label}</Text>
              </View>
            ))}
          </View>
          {timeChanged && (
            <View style={styles.warn}>
              <Text style={styles.warnText}>
                Kickoff moved since this match was posted — replies below may predate the change. Worth asking your squad to
                confirm again.
              </Text>
            </View>
          )}
          {myConfs.length === 0 && oppConfs.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>No squad yet</Text>
              <Text style={styles.muted}>Attendance appears once the match is confirmed and your squad is attached.</Text>
            </View>
          ) : (
            <>
              <AttendanceGroup title={myTeamName} subtitle="Your squad" rows={myConfs} highlight styles={styles} />
              <AttendanceGroup title={opponentName} subtitle={`${oppIn} confirmed`} rows={oppConfs} styles={styles} />
            </>
          )}
        </View>
      )}

      {tab === 'lineup' && (
        <View style={{ gap: 12 }}>
          {!hasResult ? (
            <>
              <Text style={styles.section}>
                {myTeamName} · Starting lineup · {formatLabelForSize(teamSize)}
              </Text>
              <Text style={styles.small}>{isCaptain ? 'Tap a position to assign' : 'Set by captain'}</Text>
              {isCaptain && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {formationKeysFor(teamSize).map((f) => (
                    <Pressable key={f} onPress={() => edit(setFormation)(f)} style={[styles.chip, activeFormation === f && styles.chipOn]}>
                      <Text style={[styles.chipText, activeFormation === f && styles.chipTextOn]}>{f}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
              <PitchBoard slots={slots} lineup={lineup} nameById={nameById} onSlotPress={isCaptain ? setPickerSlot : undefined} />

              <View style={styles.card}>
                <Text style={styles.section}>
                  Available players ({candidates.filter((p) => p.status === 'confirmed').length} of {candidates.length} confirmed)
                </Text>
                {candidates.length === 0 ? (
                  <Text style={styles.muted}>Nobody available for this match yet.</Text>
                ) : (
                  candidates.map((p, i) => {
                    const starting = Object.values(lineup).includes(p.player_id);
                    return (
                      <View key={p.player_id} style={[styles.person, i > 0 && styles.personDivider]}>
                        <Disc name={p.full_name} styles={styles} />
                        <Text style={styles.personName} numberOfLines={1}>
                          {p.full_name}
                        </Text>
                        {p.is_ringer && <Badge label="Ringer" tone="blue" styles={styles} />}
                        {p.status !== 'confirmed' && <Badge label="Pending" tone="amber" styles={styles} />}
                        {starting ? <Badge label="Starting" tone="green" styles={styles} /> : <Text style={styles.small}>Bench</Text>}
                      </View>
                    );
                  })
                )}
              </View>

              {isCaptain ? (
                <Pressable onPress={save} disabled={saving} style={[styles.primary, saving && { opacity: 0.6 }]}>
                  {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Save Lineup</Text>}
                </Pressable>
              ) : Object.keys(lineup).length === 0 ? (
                <Text style={[styles.small, { textAlign: 'center' }]}>The captain hasn&apos;t set the lineup yet.</Text>
              ) : null}
              {!!saveNote && <Text style={styles.small}>{saveNote}</Text>}

              {isCaptain && myTeamId && user && <RingerRequestPanel matchId={match.id} teamId={myTeamId} userId={user.id} />}
            </>
          ) : (
            <>
              {myStarters.length > 0 && (
                <>
                  <Text style={styles.section}>{myTeamName} · Starting XI</Text>
                  <PitchBoard
                    slots={slots}
                    // The saved lineup where there is one; otherwise the
                    // result's starters in order, as on the web.
                    lineup={Object.keys(lineup).length > 0 ? lineup : Object.fromEntries(myStarters.map((p, i) => [i, p.player_id]))}
                    nameById={nameById}
                  />
                </>
              )}
              {myBench.length > 0 && (
                <View style={styles.card}>
                  <Text style={styles.section}>Bench</Text>
                  {myBench.map((p) => (
                    <ResultRow key={p.player_id} p={p} styles={styles} />
                  ))}
                </View>
              )}
              {oppResultPlayers.length > 0 && (
                <View style={styles.card}>
                  <Text style={styles.section}>{opponentName}</Text>
                  {oppResultPlayers
                    .filter((p) => p.started)
                    .map((p) => (
                      <ResultRow key={p.player_id} p={p} styles={styles} />
                    ))}
                  {oppResultPlayers.some((p) => p.subbed_on) && <Text style={[styles.section, { marginTop: 8 }]}>Bench</Text>}
                  {oppResultPlayers
                    .filter((p) => p.subbed_on)
                    .map((p) => (
                      <ResultRow key={p.player_id} p={p} styles={styles} />
                    ))}
                </View>
              )}
              {myStarters.length === 0 && oppResultPlayers.length === 0 && (
                <Text style={styles.muted}>No lineup was recorded with the result.</Text>
              )}
            </>
          )}
        </View>
      )}

      {tab === 'tactics' && (
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Match plan</Text>
              <Text style={styles.small}>{isCaptain ? 'Private to your team — the opposition never sees it.' : 'Set by your captain.'}</Text>
            </View>
            <Pressable
              disabled={!isCaptain || !presets || presets.length === 0}
              onPress={() => setPresetOpen(true)}
              style={[styles.smallBtn, (!isCaptain || !presets || presets.length === 0) && { opacity: 0.4 }]}>
              <Text style={styles.smallBtnText}>Load saved</Text>
            </Pressable>
          </View>
          {isCaptain && presets !== null && presets.length === 0 && (
            <Text style={styles.small}>No saved setups yet — create one in My Team → Tactics.</Text>
          )}

          <View style={[styles.card, { gap: 12 }]}>
            <Text style={styles.section}>Formation</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {formationKeysFor(teamSize).map((f) => (
                <Pressable
                  key={f}
                  disabled={!isCaptain}
                  onPress={() => edit(setFormation)(f)}
                  style={[styles.chip, activeFormation === f && styles.chipOn, !isCaptain && activeFormation !== f && { opacity: 0.5 }]}>
                  <Text style={[styles.chipText, activeFormation === f && styles.chipTextOn]}>{f}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Text style={styles.section}>Play style</Text>
            <View style={styles.chips}>
              {PLAY_STYLES.map((s) => {
                const on = style === s;
                return (
                  <Pressable
                    key={s}
                    disabled={!isCaptain}
                    onPress={() => edit(setStyle)(on ? null : s)}
                    style={[styles.chip, on && styles.chipOn, !isCaptain && !on && { opacity: 0.5 }]}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{s}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.section}>Instructions</Text>
            {isCaptain ? (
              <TextInput
                value={notes}
                onChangeText={edit(setNotes)}
                multiline
                placeholder="What the squad needs to do in this game."
                placeholderTextColor={theme.textSecondary}
                style={styles.notes}
              />
            ) : (
              <Text style={styles.muted}>{notes || 'No instructions set yet.'}</Text>
            )}
          </View>
          {isCaptain && (
            <Pressable onPress={save} disabled={saving} style={[styles.primary, saving && { opacity: 0.6 }]}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Save Tactics</Text>}
            </Pressable>
          )}
          {!!saveNote && <Text style={styles.small}>{saveNote}</Text>}
        </View>
      )}

      <Modal visible={presetOpen} transparent animationType="slide" onRequestClose={() => setPresetOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setPresetOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.cardTitle}>Load a saved setup</Text>
            <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: 6 }}>
              {(presets ?? []).map((p) => (
                <Pressable key={p.id} onPress={() => applyPreset(p)} style={styles.pick}>
                  <Text style={styles.personName}>{p.title}</Text>
                  <Text style={styles.small}>{[p.situation, p.formation, p.style].filter(Boolean).join(' · ')}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={pickerSlot !== null} transparent animationType="slide" onRequestClose={() => setPickerSlot(null)}>
        <Pressable style={styles.scrim} onPress={() => setPickerSlot(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.cardTitle}>{pickerSlot !== null ? `Assign ${slots[pickerSlot]?.position ?? ''}` : ''}</Text>
            {pickerSlot !== null && lineup[pickerSlot] && (
              <Pressable onPress={() => assign(pickerSlot, null)} style={[styles.pick, { borderColor: theme.danger + '55' }]}>
                <Text style={[styles.personName, { color: theme.danger }]}>Clear this position</Text>
              </Pressable>
            )}
            <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: 6 }}>
              {candidates.length === 0 && <Text style={styles.muted}>No confirmed players to assign.</Text>}
              {candidates.map((c) => {
                const placedAt = Object.entries(lineup).find(([, v]) => v === c.player_id)?.[0];
                const here = placedAt !== undefined && Number(placedAt) === pickerSlot;
                return (
                  <Pressable
                    key={c.player_id}
                    onPress={() => pickerSlot !== null && assign(pickerSlot, c.player_id)}
                    style={[styles.pick, here && styles.pickOn]}>
                    <Text style={styles.personName}>{c.full_name}</Text>
                    <Text style={styles.small}>
                      {c.status === 'confirmed' ? 'Available' : 'No reply yet'}
                      {placedAt !== undefined ? ` · ${here ? 'here' : `in ${slots[Number(placedAt)]?.position ?? 'another slot'}`}` : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function TeamDisc({ name, mine, styles }: { name: string; mine?: boolean; styles: Styles }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 6 }}>
      <View style={[styles.teamDisc, mine && styles.teamDiscMine]}>
        <Text style={[styles.teamDiscText, mine && styles.teamDiscTextMine]}>{initialsOf(name)}</Text>
      </View>
      <Text style={styles.teamName} numberOfLines={2}>
        {name}
      </Text>
    </View>
  );
}

function Disc({ name, styles }: { name: string; styles: Styles }) {
  return (
    <View style={styles.personDisc}>
      <Text style={styles.personInitials}>{initialsOf(name)}</Text>
    </View>
  );
}

function Badge({ label, tone, styles }: { label: string; tone: 'green' | 'red' | 'amber' | 'blue'; styles: Styles }) {
  const map = {
    green: ['#E7F8EC', '#B7E8C6', '#0E7A3C'],
    red: ['#FDECEC', '#F5C2C2', '#C53030'],
    amber: ['#FFF6E3', '#F5DCA6', '#B07400'],
    blue: ['#EAF0FF', '#C6D4FF', '#335FFF'],
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: map[0], borderColor: map[1] }]}>
      <Text style={[styles.badgeText, { color: map[2] }]}>{label}</Text>
    </View>
  );
}

// One team's replies, headed by whose they are — two squads can both have a Jack.
function AttendanceGroup({
  title,
  subtitle,
  rows,
  highlight,
  styles,
}: {
  title: string;
  subtitle: string;
  rows: Confirmation[];
  highlight?: boolean;
  styles: Styles;
}) {
  return (
    <View style={[styles.card, highlight && styles.cardHighlight]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={[styles.cardTitle, { marginBottom: 0, flexShrink: 1 }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.small}>{subtitle}</Text>
      </View>
      {rows.length === 0 ? (
        <Text style={styles.muted}>No replies yet.</Text>
      ) : (
        rows.map((c, i) => (
          <View key={c.player_id} style={[styles.person, i > 0 && styles.personDivider]}>
            <Disc name={c.full_name} styles={styles} />
            <Text style={styles.personName} numberOfLines={1}>
              {c.full_name}
            </Text>
            {c.is_ringer && <Badge label="Ringer" tone="blue" styles={styles} />}
            <Badge
              label={c.status === 'confirmed' ? 'In' : c.status === 'declined' ? 'Out' : 'Pending'}
              tone={c.status === 'confirmed' ? 'green' : c.status === 'declined' ? 'red' : 'amber'}
              styles={styles}
            />
          </View>
        ))
      )}
    </View>
  );
}

function ResultRow({ p, styles }: { p: ResultPlayer; styles: Styles }) {
  return (
    <View style={styles.person}>
      <Disc name={p.name} styles={styles} />
      <Text style={styles.personName} numberOfLines={1}>
        {p.subbed_on ? '▲ ' : ''}
        {p.name}
      </Text>
      {p.goals > 0 && <Text style={styles.small}>⚽ {p.goals}</Text>}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.background },
    content: { padding: 20, paddingTop: 56, paddingBottom: 48, gap: 12 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: theme.background },
    back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
    backText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 15 },
    heading: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 21 },
    muted: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
    small: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
    link: { color: theme.accentInk, fontFamily: fonts.semibold, fontSize: 14 },
    section: { color: theme.textSecondary, fontFamily: fonts.bold, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      padding: 14,
      ...cardShadow,
    },
    cardHighlight: { borderColor: theme.accent + '55' },
    cardTitle: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 15, marginBottom: 6 },
    tab: { borderWidth: 1, borderColor: theme.border, borderRadius: 11, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: theme.surface },
    tabOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    tabText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 12 },
    tabTextOn: { color: '#fff', fontFamily: fonts.bold },
    scoreRow: { flexDirection: 'row', alignItems: 'center' },
    score: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 40, lineHeight: 44 },
    divider: { height: 1, backgroundColor: theme.border },
    teamDisc: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: theme.surface2,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    teamDiscMine: { backgroundColor: '#E7F8EC', borderColor: '#B7E8C6' },
    teamDiscText: { color: theme.textSecondary, fontFamily: fonts.extrabold, fontSize: 14 },
    teamDiscTextMine: { color: theme.accentInk },
    teamName: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 12, textAlign: 'center' },
    resultBtn: { backgroundColor: theme.danger, borderRadius: radius.btn, paddingVertical: 14, alignItems: 'center' },
    stat: { flex: 1, backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: radius.btn, padding: 10, alignItems: 'center' },
    statN: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 22 },
    statLabel: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 10, textAlign: 'center' },
    warn: { backgroundColor: '#FFF6E3', borderColor: '#F5DCA6', borderWidth: 1, borderRadius: 12, padding: 10 },
    warnText: { color: '#B07400', fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
    person: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
    personDivider: { borderTopWidth: 1, borderTopColor: theme.border },
    personDisc: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: theme.surface2,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    personInitials: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 10 },
    personName: { flex: 1, color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 14 },
    badge: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
    badgeText: { fontFamily: fonts.semibold, fontSize: 10 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1, borderColor: theme.border, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: theme.surface },
    chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    chipText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 12 },
    chipTextOn: { color: '#fff' },
    notes: {
      minHeight: 100,
      textAlignVertical: 'top',
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: radius.btn,
      padding: 12,
      color: theme.textPrimary,
      fontFamily: fonts.regular,
      fontSize: 14,
      backgroundColor: theme.background,
    },
    primary: { backgroundColor: theme.accent, borderRadius: radius.btn, paddingVertical: 14, alignItems: 'center' },
    primaryText: { color: '#fff', fontFamily: fonts.bold, fontSize: 15 },
    smallBtn: { borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
    smallBtnText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 12 },
    scrim: { flex: 1, backgroundColor: theme.scrim, justifyContent: 'flex-end' },
    sheet: { backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 34, gap: 8 },
    pick: { borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
    pickOn: { borderColor: theme.accent, backgroundColor: theme.successBg },
  });
