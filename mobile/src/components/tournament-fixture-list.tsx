// "Your games" inside a tournament — the mobile port of
// components/TournamentFixtureList.tsx. A tournament is one commitment but
// several games; each row opens that game's own page (lineup, attendance,
// score). Data from the shared loadTeamFixturesInTournament.

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { loadTeamFixturesInTournament, type TeamTournamentFixture } from '@/lib/tournament-match';
import { fonts } from '~/theme';
import { useTheme } from '~/use-theme';

export function TournamentFixtureList({
  openMatchId,
  teamId,
  isCaptain,
  onOpen,
}: {
  openMatchId: string;
  teamId: string | null;
  isCaptain: boolean;
  /** Called before navigating — e.g. to close the sheet this sits in. */
  onOpen?: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [fixtures, setFixtures] = useState<TeamTournamentFixture[] | null>(null);

  useEffect(() => {
    if (!teamId) {
      setFixtures([]);
      return;
    }
    void loadTeamFixturesInTournament(openMatchId, teamId).then(setFixtures);
  }, [openMatchId, teamId]);

  if (!teamId || fixtures === null) return null;

  if (fixtures.length === 0) {
    return (
      <Text style={styles.muted}>
        The organiser hasn&apos;t drawn up the fixtures yet. Your games appear here once they do.
      </Text>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.title}>Your games</Text>
      {fixtures.map((fx, i) => {
        const isHome = fx.homeTeamId === teamId;
        const opponent = isHome ? fx.awayTeamName : fx.homeTeamName;
        const played = fx.status === 'played' && fx.homeScore != null && fx.awayScore != null;
        const my = isHome ? fx.homeScore : fx.awayScore;
        const their = isHome ? fx.awayScore : fx.homeScore;
        return (
          <Pressable
            key={fx.id}
            onPress={() => {
              onOpen?.();
              router.push({ pathname: '/tournament-fixture/[fixtureId]', params: { fixtureId: fx.id } });
            }}
            style={styles.row}>
            <Text style={styles.time}>{fx.scheduledTime ?? `#${i + 1}`}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.opp} numberOfLines={1}>vs {opponent}</Text>
              <Text style={styles.sub}>
                {isHome ? 'Home' : 'Away'}
                {played ? ` · ${my}–${their}` : ''}
                {fx.refereeName ? ` · Ref: ${fx.refereeName}` : ''}
              </Text>
            </View>
            <Text style={styles.cta}>{isCaptain ? 'Set lineup' : 'View'}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    title: {
      color: theme.textSecondary,
      fontFamily: fonts.bold,
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    muted: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    time: { width: 46, color: theme.textSecondary, fontFamily: fonts.bold, fontSize: 11 },
    opp: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14 },
    sub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 11 },
    cta: { color: theme.accentInk, fontFamily: fonts.semibold, fontSize: 12 },
  });
