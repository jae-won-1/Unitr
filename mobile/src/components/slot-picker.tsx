// Pick a day and a kick-off hour — the phone's stand-in for the web's
// components/DateTimePickers.tsx dial, keeping its convention: WHOLE HOURS
// only. Pitch slots, poll dates and venue opening rules are all whole hours,
// and every caller relies on never being handed ":37". (The web's opt-in
// minuteStep isn't needed by anything ported yet.)
//
// Days are a scrolling strip of the next six weeks; hours are a grid from
// 07:00 to 22:00. Values are the same strings the web pickers produce: an ISO
// date "2026-10-04" and "19:00".

import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { fonts, radius } from '~/theme';
import { useTheme } from '~/use-theme';

const DAYS_AHEAD = 42;
const HOURS = Array.from({ length: 16 }, (_, i) => i + 7); // 07–22

// The phone's local calendar date. toISOString() is UTC, so around midnight
// it can name the wrong day.
function isoLocal(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function SlotPicker({
  date,
  time,
  onChange,
}: {
  date: string;
  time: string;
  onChange: (next: { date: string; time: string }) => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);

  const days = useMemo(() => {
    const out: { iso: string; dow: string; num: string; mon: string }[] = [];
    const start = new Date();
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      out.push({
        iso: isoLocal(d),
        dow: i === 0 ? 'Today' : d.toLocaleDateString('en-GB', { weekday: 'short' }),
        num: String(d.getDate()),
        mon: d.toLocaleDateString('en-GB', { month: 'short' }),
      });
    }
    return out;
  }, []);

  // Hours already gone today aren't offered — a poll or booking for 10:00
  // when it's 15:00 is never what anyone meant.
  const nowHour = new Date().getHours();
  const isToday = date === days[0]?.iso;

  return (
    <View style={{ gap: 10 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {days.map((d) => {
          const on = d.iso === date;
          return (
            <Pressable
              key={d.iso}
              onPress={() => onChange({ date: d.iso, time: d.iso === days[0].iso && time && Number(time.slice(0, 2)) <= nowHour ? '' : time })}
              style={[styles.day, on && styles.on]}>
              <Text style={[styles.dow, on && styles.onText]}>{d.dow}</Text>
              <Text style={[styles.num, on && styles.onText]}>{d.num}</Text>
              <Text style={[styles.mon, on && styles.onText]}>{d.mon}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.hours}>
        {HOURS.map((h) => {
          const value = `${String(h).padStart(2, '0')}:00`;
          const past = isToday && h <= nowHour;
          const on = value === time;
          return (
            <Pressable
              key={h}
              disabled={past || !date}
              onPress={() => onChange({ date, time: value })}
              style={[styles.hour, on && styles.on, (past || !date) && { opacity: 0.35 }]}>
              <Text style={[styles.hourText, on && styles.onText]}>{value}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    day: {
      width: 58,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 12,
      paddingVertical: 7,
      backgroundColor: theme.surface,
    },
    on: { backgroundColor: theme.accent, borderColor: theme.accent },
    onText: { color: '#fff' },
    dow: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 10 },
    num: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 18 },
    mon: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 10, textTransform: 'uppercase' },
    hours: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    hour: {
      width: '23%',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: radius.btn,
      paddingVertical: 8,
      backgroundColor: theme.surface,
    },
    hourText: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 13 },
  });
