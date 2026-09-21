// The month grid behind the 📅 pill: pick a date to scope the Calendar to it.
//
// A coloured dot per entry kind sits under each date's numeral, capped at
// three — more than that and they stop reading as distinct in a cell this size.
// The legend is not decoration: the dots are the only thing telling one busy
// day from another, so the grid is unreadable without it.
//
// Dates are keyed with the same "YYYY-MM-DD" string loadCalendarEntries
// produces, and compared against todayKey() from lib/match-dates rather than a
// locally built date — that helper exists precisely because toISOString()
// returns the UTC date, which is a day off for most of the evening in UTC+
// zones and would light up the wrong cell as "today".

import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { KIND_LABEL, type CalendarEntry, type EntryKind } from '@/lib/calendar-entries';
import { todayKey } from '@/lib/match-dates';
import { fonts, radius } from '~/theme';
import { kindTints } from '~/kind-style';
import { useIsDark, useTheme } from '~/use-theme';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
// Monday = 0, matching the weekday header above.
const firstWeekday = (y: number, m: number) => (new Date(y, m, 1).getDay() + 6) % 7;

export function CalendarSheet({
  entries,
  selected,
  onSelect,
  onClose,
}: {
  entries: CalendarEntry[];
  /** Currently-scoped date key, or null for "everything". */
  selected: string | null;
  onSelect: (dateKey: string | null) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const dark = useIsDark();
  const tints = kindTints(dark);
  const styles = makeStyles(theme);

  const today = new Date();
  const start = selected ? new Date(`${selected}T12:00:00`) : today;
  const [year, setYear] = useState(start.getFullYear());
  const [month, setMonth] = useState(start.getMonth());

  // Kinds present on each date, deduped and capped at three.
  const kindsByDate = useMemo(() => {
    const map = new Map<string, EntryKind[]>();
    for (const e of entries) {
      const list = map.get(e.date) ?? [];
      if (!list.includes(e.kind) && list.length < 3) list.push(e.kind);
      map.set(e.date, list);
    }
    return map;
  }, [entries]);

  const prevMonth = () =>
    month === 0 ? (setMonth(11), setYear((y) => y - 1)) : setMonth((m) => m - 1);
  const nextMonth = () =>
    month === 11 ? (setMonth(0), setYear((y) => y + 1)) : setMonth((m) => m + 1);

  const total = daysInMonth(year, month);
  const offset = firstWeekday(year, month);
  const cells: (number | null)[] = [
    ...Array(offset).fill(null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const tKey = todayKey();

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <View style={styles.headRow}>
              <Text style={styles.heading}>Pick a date</Text>
              <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
                <Ionicons name="close" size={16} color={theme.textSecondary} />
              </Pressable>
            </View>

            <View style={styles.monthRow}>
              <Pressable onPress={prevMonth} style={styles.navBtn} hitSlop={6}>
                <Ionicons name="chevron-back" size={16} color={theme.textSecondary} />
              </Pressable>
              <Text style={styles.monthLabel}>
                {MONTHS[month]} {year}
              </Text>
              <Pressable onPress={nextMonth} style={styles.navBtn} hitSlop={6}>
                <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
              </Pressable>
            </View>

            <View style={styles.weekRow}>
              {WEEKDAYS.map((d, i) => (
                <Text key={i} style={styles.weekday}>
                  {d}
                </Text>
              ))}
            </View>

            <View style={styles.grid}>
              {cells.map((day, i) => {
                if (!day) return <View key={i} style={styles.cell} />;
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const isToday = dateStr === tKey;
                const isSelected = selected === dateStr;
                const kinds = kindsByDate.get(dateStr) ?? [];

                return (
                  <Pressable
                    key={i}
                    onPress={() => {
                      onSelect(isSelected ? null : dateStr);
                      onClose();
                    }}
                    style={[
                      styles.cell,
                      styles.cellTap,
                      isSelected
                        ? styles.cellSelected
                        : isToday
                          ? styles.cellToday
                          : kinds.length > 0
                            ? styles.cellBusy
                            : null,
                    ]}>
                    <Text style={[styles.dayNum, isSelected && styles.dayNumSelected]}>{day}</Text>
                    <View style={styles.dots}>
                      {kinds.map((k) => (
                        <View
                          key={k}
                          style={[
                            styles.dot,
                            {
                              // Dots invert on the solid accent so they stay visible.
                              backgroundColor: isSelected ? 'rgba(255,255,255,0.75)' : tints[k].rule,
                            },
                          ]}
                        />
                      ))}
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.legend}>
              {(Object.keys(KIND_LABEL) as EntryKind[]).map((k) => (
                <View key={k} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: tints[k].rule }]} />
                  <Text style={styles.legendText}>{KIND_LABEL[k]}</Text>
                </View>
              ))}
            </View>

            {selected && (
              <Pressable
                onPress={() => {
                  onSelect(null);
                  onClose();
                }}
                style={styles.showAll}>
                <Text style={styles.showAllText}>Show all dates</Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: theme.scrim, justifyContent: 'flex-end' },
    backdropTap: { flex: 1 },
    sheet: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '88%',
      paddingBottom: 30,
    },
    grabber: {
      alignSelf: 'center',
      width: 38,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.border,
      marginTop: 10,
      marginBottom: 4,
    },
    body: { paddingHorizontal: 18, paddingTop: 8 },
    headRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 18,
    },
    heading: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 16 },
    closeBtn: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: theme.surface2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    monthRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 14,
    },
    navBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: theme.surface2,
      borderColor: theme.border,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    monthLabel: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 15 },
    weekRow: { flexDirection: 'row', marginBottom: 6 },
    weekday: {
      flex: 1,
      textAlign: 'center',
      color: theme.textSecondary,
      fontFamily: fonts.semibold,
      fontSize: 11,
    },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    cell: { width: `${100 / 7}%`, height: 42 },
    cellTap: { alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 10 },
    cellSelected: { backgroundColor: theme.accent },
    cellToday: { borderWidth: 1, borderColor: theme.accent },
    cellBusy: { backgroundColor: '#E7F8EC' },
    dayNum: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 15 },
    dayNumSelected: { color: '#fff', fontFamily: fonts.extrabold },
    dots: { flexDirection: 'row', gap: 3, height: 5, alignItems: 'center' },
    dot: { width: 5, height: 5, borderRadius: 2.5 },
    legend: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
      marginTop: 14,
      paddingTop: 11,
      borderTopWidth: 1,
      borderTopColor: theme.border,
    },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    legendDot: { width: 6, height: 6, borderRadius: 3 },
    legendText: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 11 },
    showAll: {
      marginTop: 16,
      paddingVertical: 11,
      borderRadius: radius.btn,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
    },
    showAllText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 14 },
  });
