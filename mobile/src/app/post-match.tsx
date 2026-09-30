// Post a Match — the mobile port of app/play/create/page.tsx plus the pitch
// picker half of /pitches (select mode), for the captain or a co-captain.
//
// The rule that decides anything is shared: lib/match-post.ts builds the
// match_posts rows (one bundled post per date for the ranked pitch options,
// filed under the team's captain, no money at post time) and runs the same
// "is this pitch free at this slot?" test the web's pitch picker does.
//
// Dates come from the team's live availability poll when there is one — each
// picked option becomes its own post, with the squad's votes beside it — or
// are entered by hand, up to five, exactly as on the web.
//
// "Lock in a pitch first" opens Book a Pitch (book.tsx, ?post=1) at the first
// date picked; the booking there becomes a secured post instead of this form.
// Not in this version (decided with the user, 30 Sep): giving one pitch an
// alternative time. Every pitch option is posted at the date's own time.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { loadLedTeam } from '@/lib/team-leadership';
import { pitchFormatFor } from '@/lib/formations';
import { toDateKey } from '@/lib/match-dates';
import { UNITER_FEE_RATE } from '@/lib/uniter-fee';
import { fmtFee } from '@/lib/joining-fee';
import {
  buildMatchPostRows,
  loadPitchSlotStatus,
  type PostDate,
  type PostingTeam,
  type PostPitchOption,
  type SlotStatus,
} from '@/lib/match-post';
import type { DateOption } from '@/lib/availability-poll';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';
import { DatePicker, TimePicker } from '~/components/date-time-pickers';

type Pitch = { id: string; name: string; address: string | null; price_per_hour: number; formats: string[] };

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FORMATS = ['All', '5-a-side', '7-a-side', '8-a-side', '11-a-side'];
const RANK = ['1st choice', '2nd choice', '3rd choice'];
const MAX_PITCHES = 3;

const dayNameOf = (iso: string) => DAY_NAMES[new Date(iso + 'T12:00:00').getDay()];
const perTeam = (pricePounds: number) => fmtFee(Math.round((pricePounds / 2) * (1 + UNITER_FEE_RATE) * 100));

export default function PostMatch() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { user } = useAuth();

  const [team, setTeam] = useState<PostingTeam | null | undefined>(undefined);
  const [poll, setPoll] = useState<{ id: string; date_options: DateOption[] } | null>(null);
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [pickedPoll, setPickedPoll] = useState<string[]>([]);
  const [manual, setManual] = useState([{ date: '', time: '' }]);
  const [options, setOptions] = useState<PostPitchOption[]>([]);
  const [description, setDescription] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const t = await loadLedTeam<PostingTeam>(user.id, 'id, name, location, captain_id');
      setTeam(t ?? null);
      if (!t) return;
      const { data: req } = await supabase
        .from('availability_requests')
        .select('id, date_options')
        .eq('team_id', t.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      // A poll whose every option has already kicked off offers nothing to post.
      const live = ((req?.date_options ?? []) as DateOption[]).filter((o) => {
        const key = toDateKey(o.date);
        return new Date(`${key}T${o.time}`).getTime() > Date.now();
      });
      if (!req || live.length === 0) return;
      setPoll({ id: req.id, date_options: live });
      const { data: resps } = await supabase.from('availability_responses').select('available_date_ids').eq('request_id', req.id);
      const count: Record<string, number> = {};
      for (const r of resps ?? []) for (const id of (r.available_date_ids as string[]) ?? []) count[id] = (count[id] ?? 0) + 1;
      setVotes(count);
    })();
  }, [user]);

  // The slots being posted, in the shape lib/match-post.ts takes.
  const dates: PostDate[] = useMemo(
    () =>
      poll
        ? poll.date_options
            .filter((o) => pickedPoll.includes(o.id))
            .map((o) => ({ date: toDateKey(o.date), time: o.time, dayName: o.dayName }))
        : manual.filter((d) => d.date && d.time).map((d) => ({ date: d.date, time: d.time, dayName: dayNameOf(d.date) })),
    [poll, pickedPoll, manual],
  );

  const post = async () => {
    if (!user || !team) return;
    if (dates.length === 0) {
      setError(poll ? 'Select at least one date from the poll.' : 'Add at least one date.');
      return;
    }
    if (options.length === 0) {
      setError('Add at least one pitch option.');
      return;
    }
    setSaving(true);
    setError(null);
    const rows = buildMatchPostRows(team, user.id, dates, options, description);
    const { error: insertError } = await supabase.from('match_posts').insert(rows);
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    Alert.alert(
      rows.length > 1 ? `${rows.length} matches posted` : 'Match posted',
      'Other teams can see it now. The first to accept takes it, and each team pays its half of the pitch then.',
    );
    router.replace('/calendar');
  };

  const move = (i: number, by: -1 | 1) =>
    setOptions((prev) => {
      const next = [...prev];
      const j = i + by;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  if (team === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  if (team === null) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Only a team&apos;s captain or a co-captain can post a match.</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
        <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>Create Match Post</Text>
          <Text style={styles.sub}>Post up to 3 preferred pitches — the opponent picks one</Text>
        </View>
        <View style={styles.modePill}>
          <Text style={styles.modePillText}>Split Pay</Text>
        </View>
      </View>

      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          Nothing is booked or paid yet. When a team accepts, the pitch they pick is booked and each team pays its half
          from its account.
        </Text>
      </View>

      {/* Lock in a pitch first? — Yes opens Book a Pitch at the first date
          picked; booking there posts the slot as a secured match instead. */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Lock in a pitch first?</Text>
        <Text style={styles.small}>
          Book and pay for a pitch now — it&apos;s reserved straight away and any team can take the match instantly.
          Your team is paid back their half as soon as one does. Otherwise nothing is booked until an opponent accepts,
          and the fee is split then.
        </Text>
        <Pressable
          onPress={() =>
            router.push({
              pathname: '/book',
              params: { post: '1', ...(dates[0] ? { date: dates[0].date, time: dates[0].time } : {}) },
            })
          }
          style={styles.lockIn}>
          <Text style={styles.lockInText}>Yes, book a pitch</Text>
        </Pressable>
      </View>

      {!!error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Dates */}
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>Match Dates</Text>
          {poll && (
            <View style={styles.tag}>
              <Text style={styles.tagText}>From availability poll</Text>
            </View>
          )}
        </View>
        {poll ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.small}>Pick one or more — each becomes its own post to maximise your chance of a match.</Text>
            {poll.date_options.map((o) => {
              const on = pickedPoll.includes(o.id);
              const n = votes[o.id] ?? 0;
              return (
                <Pressable
                  key={o.id}
                  onPress={() => setPickedPoll((prev) => (prev.includes(o.id) ? prev.filter((x) => x !== o.id) : [...prev, o.id]))}
                  style={[styles.option, on && styles.optionOn]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.optionTitle, on && { color: theme.accentInk }]}>
                      {o.dayName} · {o.time}
                    </Text>
                    <Text style={styles.small}>
                      {o.date}
                      {o.location ? ` · ${o.location}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.votes}>
                    {n} vote{n === 1 ? '' : 's'}
                  </Text>
                  <View style={[styles.tick, on && styles.tickOn]}>{on && <Ionicons name="checkmark" size={13} color="#fff" />}</View>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            <Text style={styles.small}>Add date options, or run an availability poll first to collect squad votes.</Text>
            {manual.map((d, i) => (
              <View key={i} style={{ gap: 6 }}>
                <Text style={styles.slotTitle}>Date {i + 1}</Text>
                <View style={styles.slotRow}>
                  <View style={styles.slotCol}>
                    <Text style={styles.fieldLabel}>Date</Text>
                    <DatePicker value={d.date} onChange={(v) => setManual((p) => p.map((x, k) => (k === i ? { ...x, date: v } : x)))} />
                  </View>
                  <View style={styles.slotCol}>
                    <Text style={styles.fieldLabel}>Time</Text>
                    <TimePicker value={d.time} selectedDate={d.date} onChange={(v) => setManual((p) => p.map((x, k) => (k === i ? { ...x, time: v } : x)))} />
                  </View>
                  {manual.length > 1 && (
                    <Pressable onPress={() => setManual((p) => p.filter((_, k) => k !== i))} hitSlop={8} style={styles.trash}>
                      <Ionicons name="trash-outline" size={16} color={theme.danger} />
                    </Pressable>
                  )}
                </View>
                {!!d.date && !!d.time && (() => {
                  const diff = new Date(`${d.date}T${d.time}`).getTime() - Date.now();
                  return diff > 0 && diff < 86400000;
                })() && (
                  <View style={styles.warn}>
                    <Text style={styles.warnText}>
                      That&apos;s less than 24 hours away — there may not be time for another team to find it.
                    </Text>
                  </View>
                )}
              </View>
            ))}
            {manual.length < 5 && (
              <Pressable onPress={() => setManual((p) => [...p, { date: '', time: '' }])} style={styles.addRow}>
                <Ionicons name="add" size={18} color={theme.accentInk} />
                <Text style={styles.addRowText}>Add another date</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      {/* Pitch options */}
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>Pitch Options</Text>
          <Text style={styles.small}>
            {options.length}/{MAX_PITCHES}
          </Text>
        </View>
        <Text style={styles.small}>Up to 3 pitches in order of preference. The opponent picks one of them when they accept.</Text>
        {options.map((p, i) => (
          <View key={p.id} style={styles.pitchRow}>
            <View style={styles.rankDisc}>
              <Text style={styles.rankText}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.optionTitle} numberOfLines={1}>
                {p.name}
              </Text>
              <Text style={styles.small}>
                {p.format} · {perTeam(p.price)}/hr each · {RANK[i]}
              </Text>
            </View>
            {options.length > 1 && (
              <View style={{ flexDirection: 'row', gap: 2 }}>
                <Pressable onPress={() => move(i, -1)} disabled={i === 0} hitSlop={6} style={i === 0 && { opacity: 0.25 }}>
                  <Ionicons name="chevron-up" size={18} color={theme.textSecondary} />
                </Pressable>
                <Pressable onPress={() => move(i, 1)} disabled={i === options.length - 1} hitSlop={6} style={i === options.length - 1 && { opacity: 0.25 }}>
                  <Ionicons name="chevron-down" size={18} color={theme.textSecondary} />
                </Pressable>
              </View>
            )}
            <Pressable onPress={() => setOptions((prev) => prev.filter((x) => x.id !== p.id))} hitSlop={8}>
              <Ionicons name="close" size={18} color={theme.danger} />
            </Pressable>
          </View>
        ))}
        {options.length < MAX_PITCHES && (
          <Pressable onPress={() => setPickerOpen(true)} style={styles.addPitch}>
            <Ionicons name="add" size={16} color={theme.textSecondary} />
            <Text style={styles.addPitchText}>Add Pitch Option</Text>
          </Pressable>
        )}
      </View>

      <Text style={styles.fieldLabelStrong}>
        Description <Text style={styles.small}>(optional)</Text>
      </Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        multiline
        placeholder="Tell teams what to expect..."
        placeholderTextColor={theme.textSecondary}
        style={styles.textarea}
      />

      <Pressable onPress={post} disabled={saving} style={[styles.primary, saving && { opacity: 0.6 }]}>
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryText}>{dates.length > 1 ? `Post ${dates.length} Matches` : 'Post Match'}</Text>
        )}
      </Pressable>

      {pickerOpen && (
        <PitchPicker
          dates={dates}
          picked={options}
          onClose={() => setPickerOpen(false)}
          onDone={(next) => {
            setOptions(next);
            setPickerOpen(false);
          }}
        />
      )}
    </ScrollView>
  );
}

// The pitch list — the select mode of the web's /pitches: real venues only,
// a format filter, each pitch's per-team price, and whether it's free at every
// date being posted. A pitch that's booked or closed at all of them can't be
// picked; one free at some of them can.
function PitchPicker({
  dates,
  picked,
  onClose,
  onDone,
}: {
  dates: PostDate[];
  picked: PostPitchOption[];
  onClose: () => void;
  onDone: (options: PostPitchOption[]) => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [pitches, setPitches] = useState<Pitch[] | null>(null);
  const [format, setFormat] = useState('All');
  const [chosen, setChosen] = useState<PostPitchOption[]>(picked);
  const [status, setStatus] = useState<Record<string, SlotStatus[]>>({});

  useEffect(() => {
    void supabase
      .from('pitches')
      .select('id, name, address, price_per_hour, formats')
      .not('venue_owner_id', 'is', null)
      .eq('is_verified', true)
      .order('rating', { ascending: false })
      .then(({ data }) => setPitches((data ?? []) as Pitch[]));
  }, []);

  const loadStatus = useCallback(async (list: Pitch[]) => {
    setStatus(await loadPitchSlotStatus(supabase, list.map((p) => p.id), dates));
  }, [dates]);
  useEffect(() => {
    if (pitches && pitches.length) void loadStatus(pitches);
  }, [pitches, loadStatus]);

  const shown = (pitches ?? []).filter((p) => format === 'All' || (p.formats ?? []).includes(format));
  const allTaken = (id: string) => {
    const s = status[id];
    return !!s && s.length > 0 && s.every((x) => x !== 'available');
  };
  const toggle = (p: Pitch) => {
    if (allTaken(p.id)) return;
    setChosen((prev) => {
      if (prev.some((x) => x.id === p.id)) return prev.filter((x) => x.id !== p.id);
      if (prev.length >= MAX_PITCHES) return prev;
      return [
        ...prev,
        {
          id: p.id,
          name: p.name,
          address: p.address ?? '',
          price: p.price_per_hour,
          // The filter chip is the captain saying which game this is — take it
          // when the pitch offers it, as the web does.
          format: pitchFormatFor(p.formats, format === 'All' ? null : format),
          distance: '',
        },
      ];
    });
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.cardHead}>
            <Text style={styles.sheetTitle}>Pick pitches</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={theme.textSecondary} />
            </Pressable>
          </View>
          <Text style={styles.small}>
            {dates.length === 0
              ? 'Pick your dates first to see which pitches are free.'
              : `Showing availability for ${dates.length} date${dates.length === 1 ? '' : 's'}. Up to ${MAX_PITCHES} pitches.`}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flexGrow: 0 }}>
            {FORMATS.map((f) => (
              <Pressable key={f} onPress={() => setFormat(f)} style={[styles.chip, format === f && styles.chipOn]}>
                <Text style={[styles.chipText, format === f && { color: '#fff' }]}>{f}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {pitches === null ? (
            <ActivityIndicator color={theme.accent} />
          ) : (
            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 8 }}>
              {shown.length === 0 && <Text style={styles.muted}>No pitches for that format.</Text>}
              {shown.map((p) => {
                const on = chosen.some((x) => x.id === p.id);
                const s = status[p.id] ?? [];
                const free = s.filter((x) => x === 'available').length;
                const taken = allTaken(p.id);
                const full = !on && chosen.length >= MAX_PITCHES;
                return (
                  <Pressable
                    key={p.id}
                    disabled={taken || full}
                    onPress={() => toggle(p)}
                    style={[styles.option, on && styles.optionOn, (taken || full) && { opacity: 0.45 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.optionTitle}>{p.name}</Text>
                      {!!p.address && (
                        <Text style={styles.small} numberOfLines={1}>
                          {p.address}
                        </Text>
                      )}
                      <Text style={styles.small}>{(p.formats ?? []).join(' · ')}</Text>
                      {dates.length > 0 && s.length > 0 && (
                        <Text style={[styles.small, { color: taken ? theme.danger : free < s.length ? '#B07400' : theme.accentInk }]}>
                          {taken ? 'Not free at your times' : free < s.length ? `Free at ${free} of ${s.length} times` : 'Free at your times'}
                        </Text>
                      )}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text style={styles.price}>{perTeam(p.price_per_hour)}</Text>
                      <Text style={styles.small}>per team /hr</Text>
                      <View style={[styles.tick, on && styles.tickOn]}>{on && <Ionicons name="checkmark" size={13} color="#fff" />}</View>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
          <Pressable onPress={() => onDone(chosen)} style={styles.primary}>
            <Text style={styles.primaryText}>{chosen.length === 0 ? 'Done' : `Use ${chosen.length} pitch${chosen.length === 1 ? '' : 'es'}`}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.background },
    content: { padding: 20, paddingTop: 56, paddingBottom: 48, gap: 12 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24, backgroundColor: theme.background },
    back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
    backText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 15 },
    heading: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 22 },
    sub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
    muted: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, textAlign: 'center' },
    small: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16 },
    link: { color: theme.accentInk, fontFamily: fonts.semibold, fontSize: 14 },
    modePill: { borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface2, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
    modePillText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 11 },
    infoBox: { backgroundColor: theme.successBg, borderColor: theme.successBorder, borderWidth: 1, borderRadius: 12, padding: 12 },
    infoText: { color: theme.accentInk, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
    errorBox: { backgroundColor: '#FDECEC', borderColor: '#F5C2C2', borderWidth: 1, borderRadius: 12, padding: 12 },
    errorText: { color: theme.danger, fontFamily: fonts.regular, fontSize: 13 },
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      padding: 14,
      gap: 10,
      ...cardShadow,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    lockIn: { borderWidth: 1, borderColor: theme.accent, borderRadius: radius.btn, paddingVertical: 10, alignItems: 'center' },
    lockInText: { color: theme.accentInk, fontFamily: fonts.bold, fontSize: 13 },
    cardTitle: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14 },
    tag: { backgroundColor: theme.successBg, borderColor: theme.successBorder, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
    tagText: { color: theme.accentInk, fontFamily: fonts.medium, fontSize: 11 },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.background,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    optionOn: { backgroundColor: theme.successBg, borderColor: theme.accent },
    optionTitle: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14 },
    votes: { color: theme.accentInk, fontFamily: fonts.bold, fontSize: 12 },
    tick: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
    tickOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    slotTitle: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 13 },
    slotRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
    slotCol: { flex: 1, gap: 4 },
    fieldLabel: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
    fieldLabelStrong: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14 },
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
    warn: { backgroundColor: '#FFF6E3', borderColor: '#F5DCA6', borderWidth: 1, borderRadius: 12, padding: 10 },
    warnText: { color: '#B07400', fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
    addRowText: { color: theme.accentInk, fontFamily: fonts.semibold, fontSize: 14 },
    pitchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.background,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    rankDisc: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: theme.successBg,
      borderWidth: 1,
      borderColor: theme.successBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rankText: { color: theme.accentInk, fontFamily: fonts.bold, fontSize: 11 },
    addPitch: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: theme.border,
      borderRadius: 12,
      paddingVertical: 11,
    },
    addPitchText: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 14 },
    textarea: {
      minHeight: 80,
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
    sheet: { backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 34, gap: 10, maxHeight: '90%' },
    sheetTitle: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 18 },
    chip: { borderWidth: 1, borderColor: theme.border, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: theme.surface },
    chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    chipText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 12 },
    price: { color: theme.accentInk, fontFamily: fonts.bold, fontSize: 14 },
  });
