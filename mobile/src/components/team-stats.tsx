// My Team → Stats — the mobile port of components/my-team/StatsTab.tsx. Three
// views over the same source: Team (the season record), My Stats and Players.
//
// Every number comes from results a captain actually submitted, through the
// shared lib/stats.ts, so the phone and the web can't count differently. A team
// with no submitted results sees "no results submitted yet" rather than a grid
// of zeros that reads as "you've scored nothing".

import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  EMPTY_TEAM_STATS,
  emptyPlayerStats,
  loadSquadStats,
  loadTeamStats,
  type PlayerStats,
  type TeamStats,
} from '@/lib/stats';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';
import { initialsOf } from '~/components/chat';

type Sub = 'team' | 'mine' | 'players';
export type StatsPerson = { id: string; name: string };
type Row = StatsPerson & { stats: PlayerStats };

export function TeamStatsPanel({
  teamId,
  userId,
  isCaptain,
  people,
}: {
  teamId: string;
  userId: string;
  isCaptain: boolean;
  /** Captain first, then the squad — My Team already has this list. */
  people: StatsPerson[];
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [sub, setSub] = useState<Sub>('team');
  const [team, setTeam] = useState<TeamStats>(EMPTY_TEAM_STATS);
  const [byPlayer, setByPlayer] = useState<Map<string, PlayerStats> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadTeamStats(teamId), loadSquadStats(teamId)]).then(([t, s]) => {
      if (cancelled) return;
      setTeam(t);
      setByPlayer(s);
    });
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  if (!byPlayer) return <ActivityIndicator color={theme.accent} style={{ marginVertical: 30 }} />;

  // Everyone in the squad belongs in the table, zeros included.
  const rows: Row[] = people
    .map((p) => ({ ...p, stats: byPlayer.get(p.id) ?? emptyPlayerStats(p.id) }))
    .sort((a, b) => b.stats.goals - a.stats.goals || a.name.localeCompare(b.name));
  const mine = byPlayer.get(userId) ?? emptyPlayerStats(userId);
  const max = Math.max(team.goalsFor, team.goalsAgainst, 1);

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.segment}>
        {(
          [
            ['team', 'Team'],
            ['mine', 'My Stats'],
            ['players', 'Players'],
          ] as const
        ).map(([k, label]) => (
          <Pressable key={k} onPress={() => setSub(k)} style={[styles.segBtn, sub === k && styles.segOn]}>
            <Text style={[styles.segText, sub === k && { color: '#fff' }]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {team.matchesWithResults === 0 ? (
        <Empty
          title="No results submitted yet"
          body={
            isCaptain
              ? 'Stats appear once you submit a final score for a game.'
              : 'Stats appear once your captain submits a final score.'
          }
          styles={styles}
        />
      ) : sub === 'team' ? (
        <>
          <View style={styles.tiles}>
            <Tile label="Played" value={team.played} styles={styles} />
            <Tile label="Won" value={team.won} styles={styles} />
            <Tile label="Drawn" value={team.drawn} styles={styles} />
            <Tile label="Lost" value={team.lost} styles={styles} />
          </View>
          <View style={styles.card}>
            <Bar label="Win rate" value={team.winRate} max={100} suffix="%" styles={styles} />
            <Bar label="Goals for" value={team.goalsFor} max={max} styles={styles} />
            <Bar label="Goals against" value={team.goalsAgainst} max={max} styles={styles} />
            <View style={styles.gdRow}>
              <Text style={styles.barLabel}>Goal difference</Text>
              <Text style={[styles.gd, { color: team.goalDifference >= 0 ? theme.accentInk : theme.danger }]}>
                {team.goalDifference > 0 ? '+' : ''}
                {team.goalDifference}
              </Text>
            </View>
          </View>
          <Text style={styles.foot}>
            From {team.matchesWithResults} submitted result{team.matchesWithResults === 1 ? '' : 's'}.
          </Text>
        </>
      ) : sub === 'mine' ? (
        mine.matchesWithResults === 0 ? (
          <Empty
            title="You're not in a result yet"
            body="Your stats start once you're named in a submitted result."
            styles={styles}
          />
        ) : (
          <>
            <View style={styles.tiles}>
              <Tile label="Games" value={mine.appearances} styles={styles} />
              <Tile label="Starts" value={mine.starts} styles={styles} />
              <Tile label="Goals" value={mine.goals} styles={styles} />
              <Tile label="Assists" value={mine.assists} styles={styles} />
            </View>
            <View style={styles.card}>
              <Bar
                label="Goals per game"
                value={mine.goalsPerGame}
                max={Math.max(1, mine.goalsPerGame)}
                styles={styles}
              />
              <Bar
                label="Start rate"
                value={mine.appearances > 0 ? Math.round((mine.starts / mine.appearances) * 100) : 0}
                max={100}
                suffix="%"
                styles={styles}
              />
            </View>
          </>
        )
      ) : (
        <View style={{ gap: 8 }}>
          {rows.map((r) => (
            <View key={r.id} style={styles.player}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initialsOf(r.name) || '?'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.playerName} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text style={styles.playerSub}>
                  {r.stats.appearances} game{r.stats.appearances === 1 ? '' : 's'}
                </Text>
              </View>
              <View style={styles.ga}>
                <Text style={styles.gaNum}>{r.stats.goals}</Text>
                <Text style={styles.gaLbl}>G</Text>
              </View>
              <View style={styles.ga}>
                <Text style={styles.gaNum}>{r.stats.assists}</Text>
                <Text style={styles.gaLbl}>A</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

type S = ReturnType<typeof makeStyles>;

function Tile({ label, value, styles }: { label: string; value: number; styles: S }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

function Bar({
  label,
  value,
  max,
  suffix = '',
  styles,
}: {
  label: string;
  value: number;
  max: number;
  suffix?: string;
  styles: S;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <View style={{ gap: 5 }}>
      <View style={styles.barHead}>
        <Text style={styles.barLabel}>{label}</Text>
        <Text style={styles.barValue}>
          {value}
          {suffix}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

function Empty({ title, body, styles }: { title: string; body: string; styles: S }) {
  return (
    <View style={[styles.card, { alignItems: 'center', paddingVertical: 24 }]}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    segment: {
      flexDirection: 'row',
      backgroundColor: theme.surface2,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: 10,
      padding: 2,
      gap: 2,
    },
    segBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
    segOn: { backgroundColor: theme.accent },
    segText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 12 },
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      padding: 16,
      gap: 12,
      ...cardShadow,
    },
    tiles: { flexDirection: 'row', gap: 8 },
    tile: {
      flex: 1,
      alignItems: 'center',
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.btn,
      paddingVertical: 12,
    },
    tileValue: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 18 },
    tileLabel: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 10, marginTop: 2 },
    barHead: { flexDirection: 'row', justifyContent: 'space-between' },
    barLabel: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
    barValue: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 12 },
    track: { height: 6, borderRadius: 3, backgroundColor: theme.surface2, overflow: 'hidden' },
    fill: { height: 6, borderRadius: 3, backgroundColor: theme.accent },
    gdRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      borderTopWidth: 1,
      borderTopColor: theme.border,
      paddingTop: 8,
    },
    gd: { fontFamily: fonts.bold, fontSize: 12 },
    foot: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 11, textAlign: 'center' },
    emptyTitle: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14 },
    emptyBody: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, textAlign: 'center' },
    player: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.btn,
      padding: 12,
    },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 11 },
    playerName: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14 },
    playerSub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 11 },
    ga: { alignItems: 'center', minWidth: 22 },
    gaNum: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
    gaLbl: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 9 },
  });
