// The captain's availability poll — the mobile port of the captain half of
// app/my-team/collect-availability/page.tsx.
//
// Two states. With a live poll: the squad's answers per proposed slot (count,
// "Best", who's in), and Close poll. Without one (or on "New poll"): propose
// 1–5 slots and send. Creating goes through the shared createAvailabilityPoll
// (lib/availability-poll.ts), which carries the one-live-poll-per-team rule —
// posting a new poll deletes the old one and its answers first — so the phone
// can't end up with two.
//
// Not ported: the web's "select up to 3 dates → post matches" hand-off, which
// opens the match-posting flow. Posting a match isn't on mobile yet.

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { loadLedTeam } from '@/lib/team-leadership';
import {
  createAvailabilityPoll,
  deleteAvailabilityPoll,
  type DateOption,
  type PollRow,
} from '@/lib/availability-poll';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';
import { DatePicker, TimePicker } from '~/components/date-time-pickers';
import { initialsOf } from '~/components/chat';

type Poll = { id: string; date_options: DateOption[] };
type Response = { player_id: string; available_date_ids: string[]; profiles: { full_name: string } | null };

const MONTHS: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

// Same test as the web page: an option whose kick-off has passed is dropped.
function isExpired(opt: DateOption): boolean {
  const m = opt.date.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m) return false;
  const mo = MONTHS[m[2].toUpperCase()];
  if (mo === undefined) return false;
  const [h, min] = opt.time.split(':').map(Number);
  return new Date(Number(m[3]), mo, Number(m[1]), h, min) < new Date();
}

// The phone's local calendar date; toISOString() is UTC and can name the wrong day near midnight.
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const emptyRow = (): PollRow & { location: string } => ({ date: '', time: '', location: '' });

export default function CaptainPoll() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { user } = useAuth();
  const [team, setTeam] = useState<{ id: string; captain_id: string } | null | undefined>(undefined);
  const [poll, setPoll] = useState<Poll | null>(null);
  const [responses, setResponses] = useState<Response[]>([]);
  const [squadSize, setSquadSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const t = await loadLedTeam<{ id: string; captain_id: string }>(user.id, 'id, captain_id');
    setTeam(t ?? null);
    if (!t) {
      setLoading(false);
      return;
    }
    const { count } = await supabase
      .from('team_members')
      .select('*', { count: 'exact', head: true })
      .eq('team_id', t.id)
      .eq('status', 'approved');
    setSquadSize(count ?? 0);

    const { data: req } = await supabase
      .from('availability_requests')
      .select('id, date_options')
      .eq('team_id', t.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!req) {
      setPoll(null);
      setLoading(false);
      return;
    }
    const active = (req.date_options as DateOption[]).filter((o) => !isExpired(o));
    if (active.length === 0) {
      // Every slot has passed — the web closes such a poll on the captain's
      // view, so the squad stops being asked about the past.
      await deleteAvailabilityPoll(req.id);
      setPoll(null);
      setLoading(false);
      return;
    }
    setPoll({ id: req.id, date_options: active });
    const { data: resps } = await supabase
      .from('availability_responses')
      .select('player_id, available_date_ids, profiles(full_name)')
      .eq('request_id', req.id);
    setResponses((resps ?? []) as unknown as Response[]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const close = () =>
    Alert.alert('Close this poll?', 'The squad’s answers are deleted with it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Close poll',
        style: 'destructive',
        onPress: async () => {
          if (!poll) return;
          await deleteAvailabilityPoll(poll.id);
          setPoll(null);
          setResponses([]);
        },
      },
    ]);

  const count = (id: string) => responses.filter((r) => r.available_date_ids.includes(id)).length;
  const best = poll?.date_options.reduce((b, d) => (count(d.id) > count(b.id) ? d : b), poll.date_options[0]);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
        <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      <Text style={styles.heading}>Availability poll</Text>

      {loading ? (
        <ActivityIndicator color={theme.accent} style={{ marginTop: 30 }} />
      ) : !team ? (
        <Text style={styles.muted}>Only the team captain or a co-captain can run a poll.</Text>
      ) : composing || !poll ? (
        <Composer
          team={team}
          replacing={!!poll}
          onCancel={poll ? () => setComposing(false) : undefined}
          onSent={() => {
            setComposing(false);
            setLoading(true);
            void load();
          }}
          styles={styles}
          theme={theme}
        />
      ) : (
        <>
          <View style={styles.summary}>
            <Text style={styles.summaryText}>
              {responses.length}/{squadSize} players answered
            </Text>
            <Pressable onPress={() => setComposing(true)} style={styles.smallBtn}>
              <Text style={styles.smallBtnText}>New poll</Text>
            </Pressable>
          </View>
          {poll.date_options.map((opt) => {
            const n = count(opt.id);
            const pct = squadSize > 0 ? Math.round((n / squadSize) * 100) : 0;
            const isBest = best?.id === opt.id && n > 0;
            const inNames = responses.filter((r) => r.available_date_ids.includes(opt.id));
            return (
              <View key={opt.id} style={[styles.card, isBest && { borderColor: theme.accent }]}>
                <View style={styles.optHead}>
                  <View style={styles.cal}>
                    <Text style={styles.calMon}>{opt.month}</Text>
                    <Text style={styles.calDay}>{opt.day}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.optTitle}>{opt.dayName}</Text>
                      {isBest && (
                        <View style={styles.bestPill}>
                          <Text style={styles.bestText}>Best</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.optSub}>
                      KO {opt.time}
                      {opt.location ? ` · ${opt.location}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.optCount}>
                    {n}/{squadSize}
                  </Text>
                </View>
                <View style={styles.bar}>
                  <View style={[styles.barFill, { width: `${pct}%` }]} />
                </View>
                {inNames.length > 0 && (
                  <View style={styles.discs}>
                    {inNames.map((r) => (
                      <View key={r.player_id} style={styles.disc}>
                        <Text style={styles.discText}>{initialsOf(r.profiles?.full_name ?? 'Player')}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
          <Pressable onPress={close} style={styles.textBtn}>
            <Text style={[styles.textBtnText, { color: theme.danger }]}>Close poll</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function Composer({
  team,
  replacing,
  onCancel,
  onSent,
  styles,
  theme,
}: {
  team: { id: string; captain_id: string };
  replacing: boolean;
  onCancel?: () => void;
  onSent: () => void;
  styles: Styles;
  theme: ReturnType<typeof useTheme>;
}) {
  const { user } = useAuth();
  const [rows, setRows] = useState([emptyRow()]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (i: number, patch: Partial<ReturnType<typeof emptyRow>>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const filled = rows.filter((r) => r.date && r.time);

  const send = async () => {
    if (!user || filled.length === 0) {
      setError('Add at least one date and time.');
      return;
    }
    setSending(true);
    setError(null);
    const res = await createAvailabilityPoll(team.id, team.captain_id ?? user.id, filled);
    setSending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onSent();
  };

  return (
    <>
      {/* Laid out as the web's "Start a poll" (components/AvailabilityPollForm.tsx):
          Date n, then Date and Time side by side, then an optional location. */}
      <Text style={styles.muted}>
        Add the dates you're considering. Your squad votes on which they can make.
        {replacing ? ' Sending replaces the current poll and its answers.' : ''}
      </Text>
      {rows.map((row, i) => (
        <View key={i} style={styles.slot}>
          <Text style={styles.slotTitle}>Date {i + 1}</Text>
          <View style={styles.slotRow}>
            <View style={styles.slotCol}>
              <Text style={styles.fieldLabel}>Date</Text>
              <DatePicker
                value={row.date}
                onChange={(d) =>
                  // A kick-off hour already gone on the newly picked day is dropped, not kept.
                  update(i, { date: d, time: d === todayIso() && row.time && Number(row.time.slice(0, 2)) <= new Date().getHours() ? '' : row.time })
                }
              />
            </View>
            <View style={styles.slotCol}>
              <Text style={styles.fieldLabel}>Time</Text>
              <TimePicker value={row.time} selectedDate={row.date} onChange={(t) => update(i, { time: t })} />
            </View>
            {rows.length > 1 && (
              <Pressable onPress={() => setRows((p) => p.filter((_, idx) => idx !== i))} hitSlop={8} style={styles.trash}>
                <Ionicons name="trash-outline" size={16} color={theme.danger} />
              </Pressable>
            )}
          </View>
          <Text style={styles.fieldLabel}>
            Location <Text style={{ opacity: 0.6 }}>(optional)</Text>
          </Text>
          <TextInput
            value={row.location}
            onChangeText={(v) => update(i, { location: v })}
            placeholder="Where you'd play this slot"
            placeholderTextColor={theme.textSecondary}
            style={styles.input}
          />
        </View>
      ))}
      {rows.length < 5 && (
        <Pressable onPress={() => setRows((p) => [...p, emptyRow()])} style={styles.addRow}>
          <Ionicons name="add" size={18} color={theme.accentInk} />
          <Text style={styles.addRowText}>Add date option</Text>
        </Pressable>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Pressable onPress={send} disabled={sending || filled.length === 0} style={[styles.primary, (sending || filled.length === 0) && { opacity: 0.5 }]}>
        {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Send to Squad</Text>}
      </Pressable>
      {onCancel && (
        <Pressable onPress={onCancel} style={styles.textBtn}>
          <Text style={styles.textBtnText}>Keep the current poll</Text>
        </Pressable>
      )}
    </>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.background },
    content: { padding: 20, paddingTop: 56, paddingBottom: 48, gap: 12 },
    back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
    backText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 15 },
    heading: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 24 },
    muted: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
    summary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    summaryText: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14 },
    smallBtn: { borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
    smallBtnText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 12 },
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      padding: 14,
      gap: 10,
      ...cardShadow,
    },
    optHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    cal: { width: 46, height: 46, borderRadius: 12, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center' },
    calMon: { color: theme.textSecondary, fontFamily: fonts.bold, fontSize: 9 },
    calDay: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 19, lineHeight: 22 },
    optTitle: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14 },
    optSub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
    optCount: { color: theme.accentInk, fontFamily: fonts.bold, fontSize: 14 },
    bestPill: { backgroundColor: theme.successBg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
    bestText: { color: theme.accentInk, fontFamily: fonts.bold, fontSize: 10 },
    bar: { height: 6, borderRadius: 3, backgroundColor: theme.background, overflow: 'hidden' },
    barFill: { height: 6, borderRadius: 3, backgroundColor: theme.accent },
    discs: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
    disc: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: theme.successBg,
      borderWidth: 1,
      borderColor: theme.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    discText: { color: theme.accentInk, fontFamily: fonts.bold, fontSize: 10 },
    slot: { gap: 6, paddingTop: 4 },
    slotTitle: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 13 },
    slotRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
    slotCol: { flex: 1, gap: 4 },
    fieldLabel: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
    trash: {
      width: 36,
      height: 36,
      marginBottom: 4,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.danger + '55',
      backgroundColor: theme.danger + '14',
      alignItems: 'center',
      justifyContent: 'center',
    },
    input: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: radius.btn,
      paddingHorizontal: 14,
      paddingVertical: 10,
      color: theme.textPrimary,
      fontFamily: fonts.regular,
      fontSize: 14,
      backgroundColor: theme.background,
    },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
    addRowText: { color: theme.accentInk, fontFamily: fonts.semibold, fontSize: 14 },
    error: { color: theme.danger, fontFamily: fonts.regular, fontSize: 12 },
    primary: { backgroundColor: theme.accent, borderRadius: radius.btn, paddingVertical: 14, alignItems: 'center' },
    primaryText: { color: '#fff', fontFamily: fonts.bold, fontSize: 15 },
    textBtn: { alignItems: 'center', paddingVertical: 8 },
    textBtnText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 13 },
  });
