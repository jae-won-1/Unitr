// Home.
//
// Shows ONLY the next fixture, deliberately — everything else committed to is
// the Calendar's job, and the web app draws that line on purpose. The entry
// comes from the same shared loadCalendarEntries() the Calendar tab uses, so
// "next fixture" cannot disagree between the two screens: it is the first
// upcoming entry of the one merged, sorted list.
//
// Still to come: the discovery feed (GameFeed — browse matches, tournaments and
// fill-in games, with Challenge / Enter / Suggest-to-team depending on role)
// and the role status strips above it. Those are the largest remaining pieces
// of Phase 2 and are marked as absent rather than faked.

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/contexts/RoleContext';
import {
  compareEntries,
  KIND_LABEL,
  loadCalendarEntries,
  type CalendarEntry,
} from '@/lib/calendar-entries';
import { fmtKickoff } from '@/lib/match-dates';
import { useLeadership } from '@/lib/team-leadership';
import { fonts, radius, cardShadow } from '~/theme';
import { kindTints } from '~/kind-style';
import { GameFeed } from '~/components/game-feed';
import { useIsDark, useTheme } from '~/use-theme';

export default function Home() {
  const theme = useTheme();
  const dark = useIsDark();
  const styles = makeStyles(theme);

  const { user } = useAuth();
  const { role, roleLoading } = useRole();
  const { teamId, canManage } = useLeadership(user?.id);

  const [next, setNext] = useState<CalendarEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const { entries } = await loadCalendarEntries(user.id);
      const upcoming = entries.filter((e) => e.isUpcoming).sort(compareEntries);
      setNext(upcoming[0] ?? null);
    } catch {
      setNext(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const firstName = (user?.email ?? '').split('@')[0];

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          tintColor={theme.textSecondary}
        />
      }>
      <Text style={styles.greeting}>Hi {firstName}</Text>
      <Text style={styles.roleLine}>
        {roleLoading ? 'Loading…' : role === 'captain' ? 'Captain' : role === 'player' ? 'Player' : 'No team yet'}
      </Text>

      <Text style={styles.sectionTitle}>Next fixture</Text>

      {loading ? (
        <View style={styles.card}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : next ? (
        <NextFixture entry={next} theme={theme} dark={dark} styles={styles} />
      ) : (
        <View style={styles.card}>
          <Text style={styles.muted}>
            Nothing coming up. Games you take or enter will appear here.
          </Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>Find a game</Text>
      {user && (
        <GameFeed
          teamId={teamId}
          userId={user.id}
          // Captain or co-captain. useLeadership resolves this properly — a
          // co-captain captains no team, so a captain_id lookup would miss them.
          canAct={canManage}
        />
      )}
    </ScrollView>
  );
}

function NextFixture({
  entry,
  theme,
  dark,
  styles,
}: {
  entry: CalendarEntry;
  theme: ReturnType<typeof useTheme>;
  dark: boolean;
  styles: ReturnType<typeof makeStyles>;
}) {
  const tint = kindTints(dark)[entry.kind];
  return (
    <View style={[styles.card, styles.fixture, { borderLeftColor: tint.rule }]}>
      <View style={[styles.badge, { backgroundColor: tint.bg, borderColor: tint.border }]}>
        <Text style={[styles.badgeText, { color: tint.text }]}>{KIND_LABEL[entry.kind]}</Text>
      </View>

      <Text style={styles.fixtureTitle}>{entry.title}</Text>
      {entry.subtitle && <Text style={styles.fixtureSub}>{entry.subtitle}</Text>}

      <View style={styles.fixtureRow}>
        <Ionicons name="time-outline" size={15} color={theme.textSecondary} />
        <Text style={styles.fixtureMeta}>{fmtKickoff(entry.date, entry.time)}</Text>
      </View>
      {entry.pitch && (
        <View style={styles.fixtureRow}>
          <Ionicons name="location-outline" size={15} color={theme.textSecondary} />
          <Text style={styles.fixtureMeta}>{entry.pitch}</Text>
        </View>
      )}
      {entry.badge && (
        <View style={styles.fixtureRow}>
          <Ionicons name="checkmark-circle-outline" size={15} color={theme.accentInk} />
          <Text style={[styles.fixtureMeta, { color: theme.accentInk }]}>{entry.badge}</Text>
        </View>
      )}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.background },
    content: { padding: 20, paddingTop: 60, paddingBottom: 40 },
    greeting: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 26 },
    roleLine: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 13, marginTop: 3 },
    sectionTitle: {
      color: theme.textSecondary,
      fontFamily: fonts.semibold,
      fontSize: 12,
      textTransform: 'uppercase',
      letterSpacing: 0.7,
      marginTop: 26,
      marginBottom: 10,
    },
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      padding: 16,
      ...cardShadow,
    },
    muted: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
    fixture: { borderLeftWidth: 4, gap: 4 },
    badge: {
      alignSelf: 'flex-start',
      borderRadius: radius.pill,
      borderWidth: 1,
      paddingHorizontal: 9,
      paddingVertical: 3,
      marginBottom: 6,
    },
    badgeText: { fontFamily: fonts.semibold, fontSize: 11 },
    fixtureTitle: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 17 },
    fixtureSub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13 },
    fixtureRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
    fixtureMeta: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 13 },
  });
