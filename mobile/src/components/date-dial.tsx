// Horizontal day strip that scopes the game feed — the phone's copy of
// components/DateDial.tsx. Leads with "All" rather than defaulting to today:
// supply is thin enough that a today-only default would be an empty list most
// of the time. The strip runs to the same date one month out.
//
// Selection is dark navy rather than the accent green, as on the web: the dial
// sits directly under the game-type control, and a second green would make
// "which day" and "which category" read as one control.

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { toDateKey } from '@/lib/match-dates';
import { fonts, radius } from '~/theme';
import { useTheme } from '~/use-theme';

function monthAheadDays() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(today.getFullYear(), today.getMonth() + 1, today.getDate());
  return Math.round((end.getTime() - today.getTime()) / 86_400_000) + 1;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function buildDays(count: number) {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    // A fixed table rather than toLocaleDateString: Hermes' Intl support
    // varies by build, and this label must never come out as "10/1/2026".
    return { key, label: i === 0 ? 'Today' : WEEKDAY[d.getDay()], day: d.getDate() };
  });
}

/** Tally of how many items fall on each day, so days with something on get a dot. */
export function countByDate<T>(items: T[], getDate: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = toDateKey(getDate(item));
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

export function DateDial({
  value,
  onChange,
  counts,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  counts: Map<string, number>;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      <Pressable
        onPress={() => onChange(null)}
        style={[styles.all, value === null && styles.on]}>
        <Text style={[styles.allText, value === null && styles.onText]}>All</Text>
      </Pressable>
      {buildDays(monthAheadDays()).map((d) => {
        const active = value === d.key;
        const has = (counts.get(d.key) ?? 0) > 0;
        return (
          <Pressable
            key={d.key}
            onPress={() => onChange(active ? null : d.key)}
            style={[styles.day, active && styles.on]}>
            <Text style={[styles.label, active && styles.onLabel]}>{d.label}</Text>
            <Text style={[styles.num, active && styles.onText]}>{d.day}</Text>
            <View
              style={[
                styles.dot,
                { backgroundColor: has ? (active ? 'rgba(255,255,255,0.6)' : theme.accentInk) : 'transparent' },
              ]}
            />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    row: { gap: 8, paddingBottom: 2 },
    all: {
      height: 64,
      paddingHorizontal: 16,
      borderRadius: radius.btn,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      justifyContent: 'center',
    },
    allText: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 12 },
    day: {
      width: 56,
      height: 64,
      borderRadius: radius.btn,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    on: { backgroundColor: theme.textPrimary, borderColor: theme.textPrimary },
    onText: { color: '#fff' },
    onLabel: { color: 'rgba(255,255,255,0.75)' },
    label: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 10 },
    num: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 16 },
    dot: { width: 4, height: 4, borderRadius: 2 },
  });
