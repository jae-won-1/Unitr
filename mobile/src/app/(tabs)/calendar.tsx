// Calendar — every commitment the viewer has, upcoming and past.
//
// The DATA is entirely shared: loadCalendarEntries() is the web app's own
// 415-line merge of five sources (confirmed friendlies, tournaments, the
// captain's open posts, ringer games, direct pitch bookings), imported
// unchanged. compareEntries and KIND_LABEL come from the same module. This
// screen only lays them out — if a sixth source is added on the web, it
// appears here with no work.
//
// Two web behaviours deliberately preserved, both load-bearing:
//   * Upcoming ALWAYS renders above Past, and both sections stay on screen when
//     empty, so the page keeps a fixed shape and nothing jumps around.
//   * The "Your posts" chip only exists for captains — a player has none.
//
// Not yet ported: the 📅 month-grid sheet and FixtureDetailSheet (tapping an
// entry). Those land next; entries are inert for now rather than half-wired.

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAuth } from '@/contexts/AuthContext';
import {
  compareEntries,
  KIND_LABEL,
  COMMITTED_BADGES,
  loadCalendarEntries,
  type CalendarEntry,
  type EntryKind,
} from '@/lib/calendar-entries';
import { fmtKickoff } from '@/lib/match-dates';
import { fonts, radius, cardShadow } from '~/theme';
import { kindTints } from '~/kind-style';
import { useIsDark, useTheme } from '~/use-theme';

type Filter = 'all' | EntryKind;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'friendly', label: 'Friendlies' },
  { key: 'tournament', label: 'Tournaments' },
  { key: 'my_post', label: 'Your posts' },
  { key: 'ringer', label: 'Ringer' },
  { key: 'booking', label: 'Pitch bookings' },
];

// Mirrors the web app's FilterMenu: a dropdown, not a chip row. The trigger is
// white while the filter is "All" and fills with accent green once a filter is
// actually applied, so an active filter is visible without reading the label.
function FilterMenu({
  options,
  value,
  onChange,
  theme,
  styles,
}: {
  options: { key: Filter; label: string }[];
  value: Filter;
  onChange: (f: Filter) => void;
  theme: ReturnType<typeof useTheme>;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [open, setOpen] = useState(false);
  const active = options.find((o) => o.key === value) ?? options[0];
  const filtered = value !== 'all';

  return (
    <View style={styles.menuWrap}>
      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.menuTrigger, filtered && styles.menuTriggerOn]}>
        <Text style={[styles.menuTriggerText, filtered && styles.menuTriggerTextOn]}>
          {active.label}
        </Text>
        <Ionicons
          name="chevron-down"
          size={14}
          color={filtered ? '#fff' : theme.textPrimary}
        />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        {/* Tapping anywhere outside closes, standing in for the web's
            click-outside listener. */}
        <Pressable style={styles.scrim} onPress={() => setOpen(false)}>
          <View style={styles.menu}>
            {options.map((o, i) => {
              const selected = o.key === value;
              return (
                <Pressable
                  key={o.key}
                  onPress={() => {
                    onChange(o.key);
                    setOpen(false);
                  }}
                  style={[
                    styles.menuItem,
                    i > 0 && { borderTopWidth: 1, borderTopColor: theme.border },
                  ]}>
                  <Text style={[styles.menuItemText, selected && styles.menuItemTextOn]}>
                    {o.label}
                  </Text>
                  {selected && (
                    <Ionicons name="checkmark" size={16} color={theme.accentInk} />
                  )}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

export default function Calendar() {
  const theme = useTheme();
  const dark = useIsDark();
  const tints = kindTints(dark);
  const styles = makeStyles(theme);

  const { user } = useAuth();
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [isCaptain, setIsCaptain] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await loadCalendarEntries(user.id);
      setEntries(data.entries);
      setIsCaptain(data.isCaptain);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your calendar.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  // A player has no posts of their own, so the chip would filter to nothing.
  const chips = FILTERS.filter((f) => f.key !== 'my_post' || isCaptain);

  const shown = entries.filter((e) => filter === 'all' || e.kind === filter);
  const upcoming = shown.filter((e) => e.isUpcoming).sort(compareEntries);
  const past = shown.filter((e) => !e.isUpcoming).sort(compareEntries);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.heading}>Calendar</Text>
        <Text style={styles.subheading}>Your fixtures, tournaments and bookings</Text>
      </View>

      {/* Filter dropdown + the date-picker pill, laid out as on the web. */}
      <View style={styles.controls}>
        <FilterMenu
          options={chips}
          value={filter}
          onChange={setFilter}
          theme={theme}
          styles={styles}
        />
        {/* The month-grid sheet is not ported yet. Greyed rather than hidden,
            per the house convention — a missing element shifts everything
            around it and breaks muscle memory. */}
        <View style={[styles.datePill, styles.datePillOff]}>
          <Ionicons name="calendar-outline" size={15} color={theme.textSecondary} />
          <Text style={styles.datePillText}>Calendar</Text>
        </View>
      </View>

      <FlatList
        data={[{ title: 'Upcoming', rows: upcoming }, { title: 'Past', rows: past }]}
        keyExtractor={(s) => s.title}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={theme.textSecondary}
          />
        }
        ListHeaderComponent={
          error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null
        }
        renderItem={({ item: section }) => (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {/* Both sections stay on screen when empty so the page keeps a
                fixed shape — the same reason the web app does it. */}
            {section.rows.length === 0 ? (
              <Text style={styles.empty}>
                {section.title === 'Upcoming'
                  ? 'Nothing coming up.'
                  : 'Nothing played yet.'}
              </Text>
            ) : (
              section.rows.map((e) => {
                const tint = tints[e.kind];
                const committed = e.badge != null && COMMITTED_BADGES.has(e.badge);
                return (
                  <View key={e.key} style={[styles.card, { borderLeftColor: tint.rule }]}>
                    <View style={styles.cardTop}>
                      <View style={[styles.badge, { backgroundColor: tint.bg, borderColor: tint.border }]}>
                        <Text style={[styles.badgeText, { color: tint.text }]}>
                          {KIND_LABEL[e.kind]}
                        </Text>
                      </View>
                      {e.badge && (
                        <Text
                          style={[
                            styles.status,
                            committed && { color: theme.accentInk, fontFamily: fonts.semibold },
                          ]}>
                          {e.badge}
                        </Text>
                      )}
                    </View>

                    <Text style={styles.title}>{e.title}</Text>
                    {e.subtitle && <Text style={styles.subtitle}>{e.subtitle}</Text>}

                    <Text style={styles.when}>{fmtKickoff(e.date, e.time)}</Text>
                    {e.pitch && <Text style={styles.pitch}>{e.pitch}</Text>}

                    {e.result && (
                      <Text style={styles.result}>
                        {e.result.teamScore} – {e.result.opponentScore}
                        {/* The result carries its own `verified`: both captains
                            filed the same score. Until then the web app reads
                            "Pending" rather than presenting it as settled. */}
                        <Text style={styles.resultNote}>
                          {e.result.verified ? '  ✓' : '  Pending'}
                        </Text>
                      </Text>
                    )}
                  </View>
                );
              })
            )}
          </View>
        )}
      />
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background },
    header: { paddingHorizontal: 20, paddingTop: 60, marginBottom: 18 },
    heading: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 24, marginBottom: 3 },
    subheading: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 13 },

    controls: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 8,
      paddingHorizontal: 20,
      marginBottom: 4,
    },
    menuWrap: { position: 'relative' },
    menuTrigger: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderRadius: radius.btn,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    menuTriggerOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    menuTriggerText: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
    menuTriggerTextOn: { color: '#fff' },
    scrim: { flex: 1, backgroundColor: theme.scrim, paddingTop: 175, paddingHorizontal: 20 },
    menu: {
      alignSelf: 'flex-start',
      minWidth: 200,
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      overflow: 'hidden',
    },
    menuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      paddingHorizontal: 16,
      paddingVertical: 13,
    },
    menuItemText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 14 },
    menuItemTextOn: { color: theme.accentInk, fontFamily: fonts.bold },
    datePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: radius.btn,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    datePillOff: { opacity: 0.45 },
    datePillText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 13 },
    list: { padding: 20, paddingBottom: 40, gap: 26 },
    section: { gap: 10 },
    sectionTitle: {
      color: theme.textSecondary,
      fontFamily: fonts.semibold,
      fontSize: 12,
      textTransform: 'uppercase',
      letterSpacing: 0.7,
    },
    empty: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 14, paddingVertical: 8 },
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderLeftWidth: 4,
      borderRadius: radius.card,
      padding: 15,
      gap: 3,
      ...cardShadow,
    },
    cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
    badge: { borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 3 },
    badgeText: { fontFamily: fonts.semibold, fontSize: 11 },
    status: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 12 },
    title: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 16 },
    subtitle: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13 },
    when: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 13, marginTop: 5 },
    pitch: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
    result: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 15, marginTop: 6 },
    resultNote: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
    errorBox: {
      backgroundColor: theme.surface,
      borderColor: theme.danger,
      borderWidth: 1,
      borderRadius: radius.card,
      padding: 14,
      marginBottom: 18,
    },
    errorText: { color: theme.danger, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  });
