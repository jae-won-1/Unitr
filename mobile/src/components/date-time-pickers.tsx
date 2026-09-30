// Date and time fields — the port of the web's components/DateTimePickers.tsx.
// Same look (a field with an icon that opens a month grid or a clock dial),
// same values (ISO "2026-10-04" and "19:00"), same convention: WHOLE HOURS
// only. Pitch slots, poll dates and venue opening rules are all whole hours,
// and every caller relies on never being handed ":37". (The web's opt-in
// minuteStep isn't needed by anything ported yet.)
//
// Both open centred over a scrim, as on the web, rather than under the field —
// anchored to the field they run off the side of the screen.

import { useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { fonts, radius } from '~/theme';
import { useTheme } from '~/use-theme';

type Theme = ReturnType<typeof useTheme>;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DIAL_HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

// The phone's local calendar date. toISOString() is UTC, so around midnight
// it can name the wrong day.
function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function Field({ icon, text, filled, onPress, theme }: { icon: 'calendar-outline' | 'time-outline'; text: string; filled: boolean; onPress: () => void; theme: Theme }) {
  const styles = makeStyles(theme);
  return (
    <Pressable onPress={onPress} style={styles.field}>
      <Ionicons name={icon} size={16} color={theme.textSecondary} />
      <Text numberOfLines={1} style={[styles.fieldText, !filled && { color: theme.textSecondary }]}>
        {text}
      </Text>
    </Pressable>
  );
}

function Overlay({ open, onClose, children, theme }: { open: boolean; onClose: () => void; children: ReactNode; theme: Theme }) {
  const styles = makeStyles(theme);
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose}>
        {/* Swallows taps so one on the panel doesn't reach the scrim. */}
        <Pressable style={styles.panel} onPress={() => {}}>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function DatePicker({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [open, setOpen] = useState(false);

  const today = new Date();
  const init = value ? new Date(value + 'T12:00:00') : today;
  const [year, setYear] = useState(init.getFullYear());
  const [month, setMonth] = useState(init.getMonth());

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayIso = isoLocal(today);

  const prev = () => (month === 0 ? (setMonth(11), setYear((y) => y - 1)) : setMonth((m) => m - 1));
  const next = () => (month === 11 ? (setMonth(0), setYear((y) => y + 1)) : setMonth((m) => m + 1));

  const display = value
    ? new Date(value + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Select date';

  const cells: (number | null)[] = [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7) cells.push(null);

  return (
    <>
      <Field icon="calendar-outline" text={display} filled={!!value} onPress={() => setOpen(true)} theme={theme} />
      <Overlay open={open} onClose={() => setOpen(false)} theme={theme}>
        <View style={styles.monthHead}>
          <Pressable onPress={prev} style={styles.navBtn} hitSlop={6}>
            <Ionicons name="chevron-back" size={16} color={theme.textSecondary} />
          </Pressable>
          <Text style={styles.monthTitle}>
            {MONTHS[month]} {year}
          </Text>
          <Pressable onPress={next} style={styles.navBtn} hitSlop={6}>
            <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
          </Pressable>
        </View>
        <View style={styles.week}>
          {DOW.map((d) => (
            <Text key={d} style={styles.dow}>
              {d}
            </Text>
          ))}
        </View>
        {Array.from({ length: cells.length / 7 }, (_, r) => (
          <View key={r} style={styles.week}>
            {cells.slice(r * 7, r * 7 + 7).map((day, c) => {
              if (day === null) return <View key={c} style={styles.cell} />;
              const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const past = iso < todayIso;
              const selected = iso === value;
              const isToday = iso === todayIso;
              return (
                <Pressable
                  key={c}
                  disabled={past}
                  onPress={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                  style={[styles.cell, styles.day, selected ? styles.daySelected : isToday && styles.dayToday]}>
                  <Text
                    style={[
                      styles.dayText,
                      selected && { color: '#fff' },
                      !selected && isToday && { color: theme.accentInk },
                      past && { opacity: 0.3 },
                    ]}>
                    {day}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </Overlay>
    </>
  );
}

// A clock dial of whole hours plus AM/PM, like the web's. Stays open after a
// pick so AM/PM can still change; Done or a tap on the scrim closes it.
export function TimePicker({
  value,
  onChange,
  selectedDate,
  label = 'Kick-off hour',
}: {
  value: string;
  onChange: (t: string) => void;
  selectedDate?: string;
  label?: string;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [open, setOpen] = useState(false);

  const parse = (v: string) => {
    if (!v) return { hour: 9, ampm: 'AM' as const };
    const h = Number(v.split(':')[0]);
    return { hour: h === 0 ? 12 : h > 12 ? h - 12 : h, ampm: (h >= 12 ? 'PM' : 'AM') as 'AM' | 'PM' };
  };
  const initial = parse(value);
  const [hour, setHour] = useState(initial.hour);
  const [ampm, setAmpm] = useState<'AM' | 'PM'>(initial.ampm);

  const to24 = (h: number, a: 'AM' | 'PM') => (a === 'AM' ? (h === 12 ? 0 : h) : h === 12 ? 12 : h + 12);
  // Hours already gone today aren't offered — the whole current hour included,
  // because the only time it could return is :00.
  const isToday = !!selectedDate && selectedDate === isoLocal(new Date());
  const isPast = (h: number, a: 'AM' | 'PM') => isToday && to24(h, a) <= new Date().getHours();

  const emit = (h: number, a: 'AM' | 'PM') => {
    if (isPast(h, a)) return;
    onChange(`${String(to24(h, a)).padStart(2, '0')}:00`);
  };

  const selectHour = (h: number) => {
    if (isPast(h, ampm)) return;
    setHour(h);
    emit(h, ampm);
  };
  const selectAmpm = (a: 'AM' | 'PM') => {
    setAmpm(a);
    if (isPast(hour, a)) {
      onChange('');
      return;
    }
    emit(hour, a);
  };

  const display = value ? `${parse(value).hour}:00 ${parse(value).ampm}` : 'Select time';

  const SIZE = 216;
  const C = SIZE / 2;
  const R = 78;
  const BR = 18;
  const angle = (h: number) => ((DIAL_HOURS.indexOf(h) * 30 - 90) * Math.PI) / 180;
  const handHidden = isPast(hour, ampm);
  const handLen = R - BR - 2;
  const handAngle = angle(hour);

  return (
    <>
      <Field icon="time-outline" text={display} filled={!!value} onPress={() => setOpen(true)} theme={theme} />
      <Overlay open={open} onClose={() => setOpen(false)} theme={theme}>
        <Text style={styles.dialLabel}>{label}</Text>
        <View style={{ width: SIZE, height: SIZE, alignSelf: 'center' }}>
          <View
            style={{
              position: 'absolute',
              left: 2,
              top: 2,
              width: SIZE - 4,
              height: SIZE - 4,
              borderRadius: SIZE / 2,
              borderWidth: 1.5,
              borderColor: theme.border,
            }}
          />
          {!handHidden && (
            // A bar centred on the hand's midpoint, rotated to point at the
            // hour — RN has no line primitive without react-native-svg.
            <View
              style={{
                position: 'absolute',
                width: handLen,
                height: 1.5,
                backgroundColor: theme.accentInk,
                left: C + (handLen / 2) * Math.cos(handAngle) - handLen / 2,
                top: C + (handLen / 2) * Math.sin(handAngle) - 0.75,
                transform: [{ rotate: `${handAngle}rad` }],
              }}
            />
          )}
          <View style={{ position: 'absolute', left: C - 3.5, top: C - 3.5, width: 7, height: 7, borderRadius: 4, backgroundColor: theme.accentInk }} />
          {DIAL_HOURS.map((h) => {
            const a = angle(h);
            const past = isPast(h, ampm);
            const selected = hour === h && !past;
            return (
              <Pressable
                key={h}
                disabled={past}
                onPress={() => selectHour(h)}
                style={{
                  position: 'absolute',
                  left: C + R * Math.cos(a) - BR,
                  top: C + R * Math.sin(a) - BR,
                  width: BR * 2,
                  height: BR * 2,
                  borderRadius: BR,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: selected ? theme.accentInk : past ? theme.surface2 : 'transparent',
                }}>
                <Text style={[styles.dialNum, selected && { color: '#fff' }, past && { opacity: 0.5 }]}>{h}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.ampmRow}>
          {(['AM', 'PM'] as const).map((a) => (
            <Pressable key={a} onPress={() => selectAmpm(a)} style={[styles.ampm, ampm === a && { backgroundColor: theme.accent }]}>
              <Text style={[styles.ampmText, ampm === a && { color: '#fff' }]}>{a}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable onPress={() => setOpen(false)} style={styles.done}>
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      </Overlay>
    </>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: radius.btn,
      paddingHorizontal: 12,
      paddingVertical: 11,
      backgroundColor: theme.background,
    },
    fieldText: { flexShrink: 1, color: theme.textPrimary, fontFamily: fonts.regular, fontSize: 14 },
    scrim: { flex: 1, backgroundColor: theme.scrim, alignItems: 'center', justifyContent: 'center', padding: 16 },
    panel: {
      width: 300,
      maxWidth: '100%',
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      padding: 16,
    },
    monthHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    navBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: theme.surface2, alignItems: 'center', justifyContent: 'center' },
    monthTitle: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 15 },
    week: { flexDirection: 'row' },
    dow: { flex: 1, textAlign: 'center', color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 11, paddingVertical: 4 },
    cell: { flex: 1, aspectRatio: 1, margin: 1 },
    day: { alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
    daySelected: { backgroundColor: theme.accent },
    dayToday: { borderWidth: 1, borderColor: theme.accentInk },
    dayText: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14 },
    dialLabel: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 12, textAlign: 'center', marginBottom: 10 },
    dialNum: { color: theme.textSecondary, fontFamily: fonts.bold, fontSize: 14 },
    ampmRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
    ampm: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.btn, backgroundColor: theme.surface2 },
    ampmText: { color: theme.textSecondary, fontFamily: fonts.bold, fontSize: 14 },
    done: { marginTop: 10, alignItems: 'center', paddingVertical: 10, borderRadius: radius.btn, borderWidth: 1, borderColor: theme.border },
    doneText: { color: theme.accentInk, fontFamily: fonts.bold, fontSize: 14 },
  });
