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
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

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
import { useTheme } from '~/use-theme';
import { useIsDark } from '~/use-theme';

type Filter = 'all' | EntryKind;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'friendly', label: 'Friendlies' },
  { key: 'tournament', label: 'Tournaments' },
  { key: 'my_post', label: 'Your posts' },
  { key: 'ringer', label: 'Ringer' },
  { key: 'booking', label: 'Pitch bookings' },
];

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
      <Text style={styles.heading}>Calendar</Text>

      <View style={styles.chipRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipScroll}>
          {chips.map((f) => {
            const on = filter === f.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                style={[styles.chip, on && styles.chipOn]}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
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
    heading: {
      color: theme.textPrimary,
      fontFamily: fonts.extrabold,
      fontSize: 26,
      paddingHorizontal: 20,
      paddingTop: 60,
      paddingBottom: 12,
    },
    chipRow: { borderBottomWidth: 1, borderBottomColor: theme.border, paddingBottom: 12 },
    chipScroll: { paddingHorizontal: 20, gap: 8 },
    chip: {
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      paddingHorizontal: 14,
      paddingVertical: 7,
    },
    chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    chipText: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 13 },
    chipTextOn: { color: '#fff', fontFamily: fonts.semibold },
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
