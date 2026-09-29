// One game inside a tournament — the mobile port of
// app/my-team/tournament-match/[fixtureId]/page.tsx.
//
// Everything that reads or writes is shared: the fixture, its "is this ours?"
// test and the saved plan (lib/tournament-match.ts), the formations and the
// size-aware fallbacks (lib/formations.ts), and the availability answer.
// Two rules carried over from the web page:
//   • availability is per TOURNAMENT, not per game — the answer here is the
//     one for the whole day, and the tally is the tournament's;
//   • results belong to the organiser — there's no score entry here, only the
//     score once it exists.
//
// The web's Info / Attendance / Lineup / Tactics tabs become three: Tactics
// (style and notes) sits under the lineup board, which is where a captain is
// when they think of it. Not ported: loading a saved team preset into the
// lineup — presets live in the web's TacticsTab component, not in lib/.

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { loadLeadership } from '@/lib/team-leadership';
import { fmtKickoff } from '@/lib/match-dates';
import {
  PLAY_STYLES,
  formatLabelForSize,
  formationKeysFor,
  resolveFormation,
  slotsFor,
  teamSizeFromFormat,
} from '@/lib/formations';
import {
  EMPTY_TACTICS,
  loadFixtureTactics,
  loadTournamentFixture,
  saveFixtureTactics,
  sideOf,
  type FixtureTactics,
  type TeamTournamentFixture,
} from '@/lib/tournament-match';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';
import { AvailabilityButtons } from '~/components/availability-buttons';
import { PitchBoard } from '~/components/pitch-board';
import { initialsOf } from '~/components/chat';

type Tournament = { id: string; title: string; match_date: string; start_time: string; pitch_name: string; format: string | null };
type SquadMember = { player_id: string; full_name: string; status: string; is_ringer: boolean };
type Tab = 'info' | 'attendance' | 'lineup';

export default function TournamentFixture() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>();
  const { user } = useAuth();

  const [fixture, setFixture] = useState<TeamTournamentFixture | null | undefined>(undefined);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState('Your team');
  const [canManage, setCanManage] = useState(false);
  const [squad, setSquad] = useState<SquadMember[]>([]);
  const [tab, setTab] = useState<Tab>('info');
  const [tactics, setTactics] = useState<FixtureTactics>({ ...EMPTY_TACTICS });
  const [tacticsAvailable, setTacticsAvailable] = useState(true);
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !fixtureId) return;
    void (async () => {
      const fx = await loadTournamentFixture(fixtureId);
      if (!fx) {
        setFixture(null);
        return;
      }
      setFixture(fx);
      const { data: om } = await supabase
        .from('open_matches')
        .select('id, title, match_date, start_time, pitch_name, format')
        .eq('id', fx.openMatchId)
        .maybeSingle();
      setTournament((om ?? null) as Tournament | null);
      const led = await loadLeadership(user.id);
      const tid = led?.teamId ?? null;
      setTeamId(tid);
      setCanManage(Boolean(led?.canManage));
      if (tid) {
        const { data: t } = await supabase.from('teams').select('name').eq('id', tid).maybeSingle();
        if (t?.name) setTeamName(t.name as string);
      }
    })();
  }, [user, fixtureId]);

  // The tournament's answers, not this game's — see the note at the top. The
  // is_ringer column may not exist yet, so a failed select retries without it.
  const loadSquad = useCallback(async () => {
    if (!fixture || !teamId) return;
    type Row = { player_id: string; status: string; is_ringer?: boolean; profiles: { full_name: string } | null };
    const first = await supabase
      .from('match_confirmations')
      .select('player_id, status, is_ringer, profiles(full_name)')
      .eq('open_match_id', fixture.openMatchId)
      .eq('team_id', teamId);
    const rows = (first.data ??
      (
        await supabase
          .from('match_confirmations')
          .select('player_id, status, profiles(full_name)')
          .eq('open_match_id', fixture.openMatchId)
          .eq('team_id', teamId)
      ).data) as Row[] | null;
    setSquad(
      (rows ?? []).map((c) => ({
        player_id: c.player_id,
        full_name: (c.profiles as unknown as { full_name: string } | null)?.full_name ?? 'Player',
        status: c.status,
        is_ringer: Boolean(c.is_ringer),
      })),
    );
  }, [fixture, teamId]);

  useEffect(() => {
    void loadSquad();
  }, [loadSquad]);

  useEffect(() => {
    if (!teamId || !fixtureId) return;
    void loadFixtureTactics(fixtureId, teamId).then((t) => {
      if (t === null) {
        setTacticsAvailable(false);
        return;
      }
      setTactics(t);
    });
  }, [fixtureId, teamId]);

  if (fixture === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  if (fixture === null) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Fixture not found.</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const side = sideOf(fixture, teamId);
  const opponent = side === 'home' ? fixture.awayTeamName : side === 'away' ? fixture.homeTeamName : null;
  const played = fixture.status === 'played' && fixture.homeScore != null && fixture.awayScore != null;
  const myScore = side === 'home' ? fixture.homeScore : fixture.awayScore;
  const oppScore = side === 'home' ? fixture.awayScore : fixture.homeScore;
  const kickoff = tournament ? fmtKickoff(tournament.match_date, fixture.scheduledTime ?? tournament.start_time) : fixture.scheduledTime ?? '';

  const teamSize = teamSizeFromFormat(tournament?.format);
  const activeFormation = resolveFormation(tactics.formation, teamSize);
  const slots = slotsFor(activeFormation, teamSize);
  const nameById = new Map(squad.map((s) => [s.player_id, s.full_name]));
  // Anyone who hasn't ruled themselves out can be picked.
  const candidates = squad.filter((s) => s.status !== 'declined');
  const canEdit = canManage && side !== null && tacticsAvailable;
  const setTac = (patch: Partial<FixtureTactics>) => {
    setSaveNote(null);
    setTactics((prev) => ({ ...prev, ...patch }));
  };

  const assign = (slot: number, playerId: string | null) => {
    const next = { ...tactics.lineup };
    // One player, one slot: picking someone already placed moves them here.
    for (const [k, v] of Object.entries(next)) if (v === playerId) delete next[Number(k)];
    if (playerId) next[slot] = playerId;
    else delete next[slot];
    setTac({ lineup: next });
    setPickerSlot(null);
  };

  const save = async () => {
    if (!teamId || !fixtureId) return;
    setSaving(true);
    setSaveNote(null);
    // Saves write the resolved formation — the size's default when the stored
    // one belongs to another size — the same as the web.
    const ok = await saveFixtureTactics(fixtureId, teamId, { ...tactics, formation: activeFormation });
    setSaving(false);
    setSaveNote(ok ? 'Saved — the squad can see it now.' : "Couldn't save. Fixture lineups may not be set up on this database yet.");
  };

  const header = side ? `${teamName} vs ${opponent}` : `${fixture.homeTeamName} vs ${fixture.awayTeamName}`;
  const tally = {
    in: squad.filter((s) => s.status === 'confirmed').length,
    out: squad.filter((s) => s.status === 'declined').length,
    waiting: squad.filter((s) => s.status !== 'confirmed' && s.status !== 'declined').length,
  };

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
        <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      <Text style={styles.heading} numberOfLines={2}>{header}</Text>
      <Text style={styles.sub}>{tournament?.title ?? 'Tournament'}</Text>

      {side === null ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your team isn&apos;t in this fixture</Text>
          <Text style={styles.muted}>
            {fixture.homeTeamName} play {fixture.awayTeamName}
            {kickoff ? ` · ${kickoff}` : ''}.{fixture.refereeName ? ` Referee: ${fixture.refereeName}.` : ''}
          </Text>
        </View>
      ) : (
        <>
          {!played && teamId && user && (
            <View style={{ gap: 6 }}>
              <Text style={styles.small}>Can you make this tournament? Your answer covers every game of the day.</Text>
              <AvailabilityButtons target={{ openMatchId: fixture.openMatchId }} playerId={user.id} teamId={teamId} />
            </View>
          )}

          <View style={styles.tabs}>
            {(['info', 'attendance', 'lineup'] as Tab[]).map((t) => (
              <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabOn]}>
                <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>
                  {t === 'info' ? 'Info' : t === 'attendance' ? 'Attendance' : 'Lineup'}
                </Text>
              </Pressable>
            ))}
          </View>

          {tab === 'info' && (
            <View style={[styles.card, { gap: 14 }]}>
              <View style={styles.scoreRow}>
                <TeamDisc name={teamName} mine styles={styles} />
                <View style={{ alignItems: 'center', paddingHorizontal: 8 }}>
                  {played ? (
                    <>
                      <Text style={styles.score}>
                        {myScore} – {oppScore}
                      </Text>
                      <Text style={styles.small}>Full time</Text>
                    </>
                  ) : (
                    <Text style={styles.small}>No result yet</Text>
                  )}
                </View>
                <TeamDisc name={opponent ?? ''} styles={styles} />
              </View>
              <View style={styles.divider} />
              <View style={{ alignItems: 'center', gap: 2 }}>
                {!!kickoff && <Text style={styles.small}>{kickoff}</Text>}
                {!!tournament?.pitch_name && <Text style={styles.small}>{tournament.pitch_name}</Text>}
                <Text style={styles.small}>
                  {side === 'home' ? 'Home' : 'Away'} · Game {fixture.slotIndex + 1}
                </Text>
                <Text style={styles.small}>
                  Ref: {fixture.refereeName ?? 'unassigned'}
                  {fixture.refereeTeamName ? ` (${fixture.refereeTeamName})` : ''}
                </Text>
              </View>
              <View style={styles.divider} />
              <Text style={styles.small}>
                The organiser enters every score. The full schedule and standings are on the tournament page on
                the web app.
              </Text>
            </View>
          )}

          {tab === 'attendance' && (
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {([
                  ['Attendees', tally.in],
                  ['Awaiting reply', tally.waiting],
                  ['Unavailable', tally.out],
                ] as const).map(([label, n]) => (
                  <View key={label} style={styles.stat}>
                    <Text style={styles.statN}>{n}</Text>
                    <Text style={styles.statLabel}>{label}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.small}>Answers for the tournament as a whole — the squad answers once for the day.</Text>
              <View style={styles.card}>
                {squad.length === 0 ? (
                  <Text style={styles.muted}>Nobody has answered yet.</Text>
                ) : (
                  squad.map((s, i) => (
                    <View key={s.player_id} style={[styles.person, i > 0 && styles.personDivider]}>
                      <View style={styles.personDisc}>
                        <Text style={styles.personInitials}>{initialsOf(s.full_name)}</Text>
                      </View>
                      <Text style={styles.personName} numberOfLines={1}>{s.full_name}</Text>
                      {s.is_ringer && <Badge label="Ringer" tone="blue" styles={styles} />}
                      <Badge
                        label={s.status === 'confirmed' ? 'In' : s.status === 'declined' ? 'Out' : 'Pending'}
                        tone={s.status === 'confirmed' ? 'green' : s.status === 'declined' ? 'red' : 'amber'}
                        styles={styles}
                      />
                    </View>
                  ))
                )}
              </View>
            </View>
          )}

          {tab === 'lineup' && (
            <View style={{ gap: 12 }}>
              <Text style={styles.small}>
                {formatLabelForSize(teamSize)} · {canEdit ? 'tap a position to pick a player' : 'set by your captain'}
              </Text>
              {!tacticsAvailable && <Text style={styles.muted}>Fixture lineups aren&apos;t set up on this database yet.</Text>}
              {canEdit && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {formationKeysFor(teamSize).map((f) => (
                    <Pressable key={f} onPress={() => setTac({ formation: f })} style={[styles.chip, activeFormation === f && styles.chipOn]}>
                      <Text style={[styles.chipText, activeFormation === f && styles.chipTextOn]}>{f}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
              <PitchBoard
                slots={slots}
                lineup={tactics.lineup}
                nameById={nameById}
                onSlotPress={canEdit ? (i) => setPickerSlot(i) : undefined}
              />

              <Text style={styles.label}>Style</Text>
              <View style={styles.chips}>
                {PLAY_STYLES.map((s) => {
                  const on = tactics.style === s;
                  return (
                    <Pressable
                      key={s}
                      disabled={!canEdit}
                      onPress={() => setTac({ style: on ? null : s })}
                      style={[styles.chip, on && styles.chipOn, !canEdit && !on && { opacity: 0.5 }]}>
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{s}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.label}>Notes</Text>
              {canEdit ? (
                <TextInput
                  value={tactics.notes}
                  onChangeText={(v) => setTac({ notes: v })}
                  multiline
                  placeholder="Set pieces, who takes corners, anything the squad should know"
                  placeholderTextColor={theme.textSecondary}
                  style={styles.notes}
                />
              ) : (
                <Text style={styles.muted}>{tactics.notes || 'No notes yet.'}</Text>
              )}
              {canEdit && (
                <Pressable onPress={save} disabled={saving} style={[styles.primary, saving && { opacity: 0.6 }]}>
                  {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Save lineup</Text>}
                </Pressable>
              )}
              {!!saveNote && <Text style={styles.small}>{saveNote}</Text>}
            </View>
          )}
        </>
      )}

      <Modal visible={pickerSlot !== null} transparent animationType="slide" onRequestClose={() => setPickerSlot(null)}>
        <Pressable style={styles.scrim} onPress={() => setPickerSlot(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.cardTitle}>
              {pickerSlot !== null ? `Who plays ${slots[pickerSlot]?.position}?` : ''}
            </Text>
            <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: 6 }}>
              {candidates.length === 0 && (
                <Text style={styles.muted}>Nobody has said they can play yet.</Text>
              )}
              {candidates.map((c) => {
                const placedAt = Object.entries(tactics.lineup).find(([, v]) => v === c.player_id)?.[0];
                return (
                  <Pressable key={c.player_id} onPress={() => pickerSlot !== null && assign(pickerSlot, c.player_id)} style={styles.pick}>
                    <Text style={styles.personName}>{c.full_name}</Text>
                    <Text style={styles.small}>
                      {c.status === 'confirmed' ? 'Available' : 'No reply yet'}
                      {placedAt !== undefined ? ` · in ${slots[Number(placedAt)]?.position ?? 'another slot'}` : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {pickerSlot !== null && tactics.lineup[pickerSlot] && (
              <Pressable onPress={() => assign(pickerSlot, null)} style={styles.textBtn}>
                <Text style={[styles.textBtnText, { color: theme.danger }]}>Clear this position</Text>
              </Pressable>
            )}
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
      <Text style={styles.teamName} numberOfLines={2}>{name}</Text>
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

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.background },
    content: { padding: 20, paddingTop: 56, paddingBottom: 48, gap: 12 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: theme.background },
    back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
    backText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 15 },
    heading: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 21 },
    sub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, marginTop: -8 },
    muted: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
    small: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
    link: { color: theme.accentInk, fontFamily: fonts.semibold, fontSize: 14 },
    label: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 13 },
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      padding: 14,
      ...cardShadow,
    },
    cardTitle: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 15, marginBottom: 6 },
    tabs: { flexDirection: 'row', gap: 8 },
    tab: { flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 11, paddingVertical: 10, alignItems: 'center', backgroundColor: theme.surface },
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
    stat: { flex: 1, backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: radius.btn, padding: 10, alignItems: 'center' },
    statN: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 22 },
    statLabel: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 10, textAlign: 'center' },
    person: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
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
      minHeight: 90,
      textAlignVertical: 'top',
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: radius.btn,
      padding: 12,
      color: theme.textPrimary,
      fontFamily: fonts.regular,
      fontSize: 14,
      backgroundColor: theme.surface,
    },
    primary: { backgroundColor: theme.accent, borderRadius: radius.btn, paddingVertical: 14, alignItems: 'center' },
    primaryText: { color: '#fff', fontFamily: fonts.bold, fontSize: 15 },
    scrim: { flex: 1, backgroundColor: theme.scrim, justifyContent: 'flex-end' },
    sheet: { backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 34, gap: 8 },
    pick: { borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
    textBtn: { alignItems: 'center', paddingVertical: 8 },
    textBtnText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 13 },
  });
