// Book a Pitch — the mobile port of app/book/page.tsx + components/BookPitchPanel.tsx.
// One hour of a real venue pitch, no opponent needed. Anyone signed in can book;
// a captain or co-captain can also pay from the team's account.
//
// The day grid is the shared lib/pitch-day.ts — the same rule the web draws
// and /api/book/pitch checks before it books. Paying and booking happen in
// book-pitch-sheet.tsx through that route.
//
// Opened from Home's quick-nav row, and from Post a Match's "Lock in a pitch
// first" with ?date=&time=&post=1 — then the booking becomes a secured match
// post and the screen goes back to the Calendar.
//
// Not ported: the web's map view (Leaflet). The list is the whole screen.

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { loadLedTeam } from '@/lib/team-leadership';
import { loadPitchDay, type DaySlot } from '@/lib/pitch-day';
import { fmtFee } from '@/lib/joining-fee';
import { withFee } from '@/lib/uniter-fee';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';
import { DatePicker, TimePicker } from '~/components/date-time-pickers';
import { BookPitchSheet, type BookingTeam } from '~/components/book-pitch-sheet';

type Pitch = {
  id: string;
  name: string;
  address: string | null;
  price_per_hour: number;
  formats: string[] | null;
  surfaces: string[] | null;
  rating: number | null;
  is_verified: boolean | null;
};

const FORMATS = ['All', '5-a-side', '7-a-side', '8-a-side', '11-a-side'];

const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtDay = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

export default function BookPitch() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { user } = useAuth();
  const params = useLocalSearchParams<{ date?: string; time?: string; post?: string }>();
  const autoPost = params.post === '1';

  const [pitches, setPitches] = useState<Pitch[] | null>(null);
  const [team, setTeam] = useState<BookingTeam | null>(null);
  const [date, setDate] = useState(params.date || isoLocal(new Date()));
  const [time, setTime] = useState(params.time || '');
  const [size, setSize] = useState('All');
  const [location, setLocation] = useState('');
  const [slots, setSlots] = useState<Record<string, DaySlot[]> | null>(null);
  const [pending, setPending] = useState<{ pitch: Pitch; time: string } | null>(null);

  // Real venue-registered pitches only — a pitch no venue owns has nobody to
  // honour the booking (and /api/book/pitch refuses it).
  useEffect(() => {
    void supabase
      .from('pitches')
      .select('id, name, address, price_per_hour, formats, surfaces, rating, is_verified')
      .not('venue_owner_id', 'is', null)
      .order('rating', { ascending: false })
      .then(({ data }) => setPitches((data ?? []) as Pitch[]));
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadLedTeam<BookingTeam>(user.id, 'id, name').then((t) => setTeam(t ?? null));
  }, [user]);

  useEffect(() => {
    if (!pitches || pitches.length === 0) return;
    setSlots(null);
    let live = true;
    void loadPitchDay(supabase, pitches.map((p) => p.id), date).then((map) => {
      if (live) setSlots(map);
    });
    return () => {
      live = false;
    };
  }, [date, pitches]);

  // Slots are hourly; the dial only returns whole hours anyway.
  const hour = time ? `${time.slice(0, 2)}:00` : '';
  const anyFilter = Boolean(time || size !== 'All' || location.trim());

  const shown = useMemo(() => {
    const q = location.trim().toLowerCase();
    return (pitches ?? []).filter((p) => {
      if (size !== 'All' && !(p.formats ?? []).includes(size)) return false;
      if (q && !`${p.name} ${p.address ?? ''}`.toLowerCase().includes(q)) return false;
      // A time set → only pitches free at that hour.
      if (hour && slots?.[p.id] && !slots[p.id].some((s) => s.time === hour && s.status === 'available')) return false;
      return true;
    });
  }, [pitches, size, location, hour, slots]);

  const clear = () => {
    setTime('');
    setSize('All');
    setLocation('');
    setDate(isoLocal(new Date()));
  };

  const markTaken = (pitchId: string, t: string) =>
    setSlots((prev) =>
      prev?.[pitchId] ? { ...prev, [pitchId]: prev[pitchId].map((s) => (s.time === t ? { ...s, status: 'booked' } : s)) } : prev,
    );

  const today = isoLocal(new Date());
  const nowHour = new Date().getHours();

  const soon =
    !!date && !!time && (() => {
      const diff = new Date(`${date}T${time}`).getTime() - Date.now();
      return diff > 0 && diff < 86400000;
    })();

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <View>
          <Text style={styles.heading}>{autoPost ? 'Lock in a pitch' : 'Book a Pitch'}</Text>
          <Text style={styles.sub}>
            {autoPost
              ? 'Book and pay for the pitch now — the match goes live as a post any team can take straight away.'
              : 'Book a pitch directly — no opponent needed'}
          </Text>
        </View>

        {/* Filters — apply live */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>Filter pitches</Text>
            {anyFilter && (
              <Pressable onPress={clear} hitSlop={8}>
                <Text style={styles.link}>Clear all</Text>
              </Pressable>
            )}
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.fieldLabel}>Date</Text>
              <DatePicker value={date} onChange={setDate} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.fieldLabel}>Time (optional)</Text>
              <TimePicker value={time} selectedDate={date} onChange={setTime} />
            </View>
          </View>
          <View style={{ gap: 4 }}>
            <Text style={styles.fieldLabel}>Location</Text>
            <View style={styles.search}>
              <Ionicons name="location-outline" size={15} color={theme.textSecondary} />
              <TextInput
                value={location}
                onChangeText={setLocation}
                placeholder="Area, postcode or venue name"
                placeholderTextColor={theme.textSecondary}
                style={styles.searchInput}
              />
            </View>
          </View>
          <View style={{ gap: 6 }}>
            <Text style={styles.fieldLabel}>Pitch size</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {FORMATS.map((f) => (
                <Pressable key={f} onPress={() => setSize(f)} style={[styles.chip, size === f && styles.chipOn]}>
                  <Text style={[styles.chipText, size === f && { color: '#fff' }]}>{f}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          {!!hour && <Text style={styles.hint}>Showing pitches free at {hour} on {fmtDay(date)}.</Text>}
          {soon && (
            <View style={styles.warn}>
              <Text style={styles.warnText}>
                That&apos;s less than 24 hours away.
                {autoPost ? ' If no team takes the match, the booking is still yours to pay for.' : ''}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.countRow}>
          <Text style={styles.small}>
            {anyFilter ? `${shown.length} match${shown.length === 1 ? '' : 'es'}` : 'Pitches near you'}
          </Text>
          <Text style={styles.hint}>
            {fmtDay(date)}
            {hour ? ` · ${hour}` : ''}
          </Text>
        </View>

        {pitches === null ? (
          <ActivityIndicator color={theme.accent} style={{ marginTop: 24 }} />
        ) : shown.length === 0 ? (
          <View style={[styles.card, { alignItems: 'center', paddingVertical: 28 }]}>
            <Text style={styles.small}>No pitches match your filters.</Text>
            <Pressable onPress={clear}>
              <Text style={styles.link}>Clear filters</Text>
            </Pressable>
          </View>
        ) : (
          shown.map((p) => {
            const day = slots?.[p.id];
            const free = (day ?? []).filter((s) => s.status === 'available').length;
            return (
              <View key={p.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={styles.pitchName}>{p.name}</Text>
                    {!!p.address && (
                      <Text style={styles.small} numberOfLines={2}>
                        {p.address}
                      </Text>
                    )}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.price}>{fmtFee(withFee(Math.round(p.price_per_hour * 100)))}</Text>
                    <Text style={styles.small}>per hour</Text>
                  </View>
                </View>
                <View style={styles.tags}>
                  {p.is_verified && (
                    <View style={[styles.tag, styles.tagOn]}>
                      <Text style={[styles.tagText, { color: theme.accentInk }]}>Verified</Text>
                    </View>
                  )}
                  {!!p.rating && (
                    <View style={styles.tag}>
                      <Text style={styles.tagText}>★ {Number(p.rating).toFixed(1)}</Text>
                    </View>
                  )}
                  {[...(p.surfaces ?? []), ...(p.formats ?? [])].map((t) => (
                    <View key={t} style={styles.tag}>
                      <Text style={styles.tagText}>{t}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.grid}>
                  <View style={styles.cardHead}>
                    <Text style={styles.label}>Availability · {fmtDay(date)}</Text>
                    {day && <Text style={styles.freeCount}>{free} slot{free === 1 ? '' : 's'} free</Text>}
                  </View>
                  {!day ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 }}>
                      <ActivityIndicator size="small" color={theme.accent} />
                      <Text style={styles.small}>Checking availability…</Text>
                    </View>
                  ) : (
                    <>
                      <View style={styles.slots}>
                        {day.map((s) => {
                          const past = date === today && Number(s.time.slice(0, 2)) <= nowHour;
                          const taken = s.status !== 'available';
                          const match = hour === s.time;
                          return (
                            <Pressable
                              key={s.time}
                              disabled={taken || past}
                              onPress={() => setPending({ pitch: p, time: s.time })}
                              style={[
                                styles.slot,
                                match && !taken && !past && styles.slotMatch,
                                (taken || past) && styles.slotOff,
                              ]}>
                              <Text
                                style={[
                                  styles.slotText,
                                  match && !taken && !past && { color: '#fff' },
                                  taken && !past && styles.slotTaken,
                                ]}>
                                {s.time}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      {free === 0 && <Text style={styles.errorText}>Fully booked on this date — try another day.</Text>}
                    </>
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {pending && user && (
        <BookPitchSheet
          pitch={pending.pitch}
          date={date}
          time={pending.time}
          team={team}
          userId={user.id}
          autoPost={autoPost}
          onClose={() => setPending(null)}
          onSlotTaken={() => {
            markTaken(pending.pitch.id, pending.time);
            setPending(null);
          }}
          onBooked={({ posted }) => {
            markTaken(pending.pitch.id, pending.time);
            setPending(null);
            if (posted || autoPost) router.replace('/calendar');
          }}
        />
      )}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.background },
    content: { padding: 20, paddingTop: 56, paddingBottom: 48, gap: 12 },
    back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
    backText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 15 },
    heading: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 22 },
    sub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
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
    cardTitle: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14 },
    fieldLabel: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
    link: { color: theme.accentInk, fontFamily: fonts.semibold, fontSize: 13 },
    search: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 12,
      paddingHorizontal: 12,
      backgroundColor: theme.background,
    },
    searchInput: { flex: 1, paddingVertical: 10, color: theme.textPrimary, fontFamily: fonts.regular, fontSize: 14 },
    chip: { borderWidth: 1, borderColor: theme.border, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: theme.background },
    chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    chipText: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 13 },
    hint: { color: theme.accentInk, fontFamily: fonts.medium, fontSize: 11 },
    warn: { backgroundColor: '#FFF6E3', borderColor: '#F5DCA6', borderWidth: 1, borderRadius: 12, padding: 10 },
    warnText: { color: '#B07400', fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
    countRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 2 },
    small: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
    pitchName: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 15 },
    price: { color: theme.accentInk, fontFamily: fonts.bold, fontSize: 18 },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    tag: { borderWidth: 1, borderColor: theme.border, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
    tagOn: { backgroundColor: theme.successBg, borderColor: theme.accent },
    tagText: { color: theme.textPrimary, fontFamily: fonts.regular, fontSize: 11 },
    grid: { backgroundColor: theme.background, borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
    label: { color: theme.textSecondary, fontFamily: fonts.bold, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 },
    freeCount: { color: theme.accentInk, fontFamily: fonts.semibold, fontSize: 10 },
    slots: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    slot: {
      width: '23%',
      flexGrow: 1,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 8,
      paddingVertical: 8,
      alignItems: 'center',
    },
    slotMatch: { backgroundColor: theme.accent, borderColor: theme.accent },
    slotOff: { borderColor: 'transparent', opacity: 0.3 },
    slotText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 12 },
    slotTaken: { textDecorationLine: 'line-through' },
    errorText: { color: theme.danger, fontFamily: fonts.regular, fontSize: 12 },
  });
