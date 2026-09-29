// A tournament, read-only — the player's half of app/play/tournament/[id].
//
// The web page is also the organiser's workshop (drawing up the schedule,
// appointing referees, entering scores, rating players, taking the event down,
// removing a team). None of that is here: organisers run events from the web,
// and the migration plan keeps admin tools off v1 of the app. What a player or
// captain needs is: what and when, who's in, the day's games with scores and
// referees, and the table — plus Enter for a captain whose team isn't in yet.
//
// Same queries as the web page, including its fallbacks: open_matches without
// the admin-hosting columns (42703), and tournament_matches without
// duration_minutes (lib/optional-column). Standings from the shared
// computeStandings, from played games only.

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { withOptionalColumn } from '@/lib/optional-column';
import { computeStandings } from '@/lib/standings';
import { loadLeadership } from '@/lib/team-leadership';
import { fmtKickoff, isKickoffPast } from '@/lib/match-dates';
import { fmtFee } from '@/lib/joining-fee';
import type { Tournament as FeedTournament } from '@/lib/game-feed';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';
import { EnterTournamentSheet } from '~/components/enter-tournament-sheet';

type Event = {
  id: string;
  title: string;
  match_type: string;
  pitch_name: string;
  match_date: string;
  start_time: string;
  end_time: string;
  format: string | null;
  skill_level: string;
  max_teams: number;
  price_per_team_pence: number;
  status: string;
  organiser_team_id: string | null;
  organiser_team_name: string | null;
  organiser_admin_id: string | null;
  organiser_admin_name: string | null;
};
type JoinedTeam = { team_id: string; team_name: string };
type Fixture = {
  id: string;
  slot_index: number;
  scheduled_time: string | null;
  home_team_id: string | null;
  home_team_name: string | null;
  away_team_id: string | null;
  away_team_name: string | null;
  referee_name: string | null;
  referee_team_name: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string;
  duration_minutes?: number | null;
};

// "18:00" + 25 → "18:25". Only when the fixture's length is known.
function finishOf(start: string | null, minutes: number | null | undefined): string | null {
  if (!start || !minutes) return null;
  const [h, m] = start.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const BASE_COLS =
  'id, title, match_type, pitch_name, match_date, start_time, end_time, format, skill_level, max_teams, price_per_team_pence, status, organiser_team_id, organiser_team_name';
const FIXTURE_COLS =
  'id, slot_index, scheduled_time, home_team_id, home_team_name, away_team_id, away_team_name, referee_name, referee_team_name, home_score, away_score, status';

export default function TournamentPage() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();

  const [event, setEvent] = useState<Event | null | undefined>(undefined);
  const [downReason, setDownReason] = useState<string | null>(null);
  const [teams, setTeams] = useState<JoinedTeam[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [myTeamName, setMyTeamName] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [entering, setEntering] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    let { data: om, error } = await supabase
      .from('open_matches')
      .select(`${BASE_COLS}, organiser_admin_id, organiser_admin_name`)
      .eq('id', id)
      .maybeSingle();
    if (error?.code === '42703') {
      const { data: legacy } = await supabase.from('open_matches').select(BASE_COLS).eq('id', id).maybeSingle();
      om = legacy ? { ...legacy, organiser_admin_id: null, organiser_admin_name: null } : null;
    }
    if (!om) {
      setEvent(null);
      setRefreshing(false);
      return;
    }
    setEvent(om as Event);
    if ((om as Event).status === 'cancelled') {
      const { data: down } = await supabase.from('open_matches').select('taken_down_reason').eq('id', id).maybeSingle();
      setDownReason((down?.taken_down_reason as string | null) ?? null);
    }

    const { data: jt } = await supabase.from('open_match_teams').select('team_id, team_name').eq('open_match_id', id);
    setTeams((jt ?? []) as JoinedTeam[]);

    const { data: fx } = await withOptionalColumn<Fixture[]>('duration_minutes', async (include) => {
      const r = await supabase
        .from('tournament_matches')
        .select(include ? `${FIXTURE_COLS}, duration_minutes` : FIXTURE_COLS)
        .eq('open_match_id', id)
        .order('slot_index', { ascending: true });
      return { data: (r.data ?? []) as unknown as Fixture[], error: r.error };
    });
    setFixtures(fx ?? []);

    if (user) {
      const led = await loadLeadership(user.id);
      setMyTeamId(led?.teamId ?? null);
      setCanManage(Boolean(led?.canManage));
      if (led?.teamId) {
        const [{ data: t }, { data: inv }] = await Promise.all([
          supabase.from('teams').select('name').eq('id', led.teamId).maybeSingle(),
          supabase
            .from('tournament_invitations')
            .select('discount_pence')
            .eq('open_match_id', id)
            .eq('team_id', led.teamId)
            .eq('status', 'pending')
            .maybeSingle(),
        ]);
        setMyTeamName((t?.name as string | undefined) ?? null);
        setDiscount((inv?.discount_pence as number | undefined) ?? 0);
      }
    }
    setRefreshing(false);
  }, [id, user]);

  useEffect(() => {
    void load();
  }, [load]);

  if (event === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  if (event === null) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Event not found.</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const organiser = event.organiser_admin_name ?? event.organiser_team_name ?? event.pitch_name;
  const kindLabel = event.match_type === 'league' ? 'League' : event.match_type === 'match' ? 'Event' : 'Tournament';
  const entered = !!myTeamId && teams.some((t) => t.team_id === myTeamId);
  const full = teams.length >= event.max_teams;
  const started = isKickoffPast(event.match_date, event.start_time);
  const canEnter = canManage && !!myTeamId && !entered && !full && event.status !== 'cancelled' && !started;
  const standings = fixtures.some((f) => f.status === 'played') ? computeStandings(teams, fixtures) : [];

  // The shape the enter sheet (and the feed it came from) expects.
  const asFeedTournament: FeedTournament = {
    id: event.id,
    title: event.title,
    matchType: event.match_type,
    pitchName: event.pitch_name,
    matchDate: event.match_date,
    startTime: event.start_time,
    format: event.format,
    skillLevel: event.skill_level,
    pricePerTeamPence: event.price_per_team_pence,
    maxTeams: event.max_teams,
    joinedCount: teams.length,
    organiserTeamName: event.organiser_team_name,
    organiserAdminName: event.organiser_admin_name,
    joinedTeamIds: teams.map((t) => t.team_id),
    inviteDiscountPence: discount,
  };

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
      <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
        <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      <View style={styles.kindPill}>
        <Text style={styles.kindText}>{kindLabel}</Text>
      </View>
      <Text style={styles.heading}>{event.title}</Text>
      <Text style={styles.sub}>by {organiser}</Text>

      {event.status === 'cancelled' && (
        <View style={styles.cancelled}>
          <Text style={styles.cancelledTitle}>This event has been cancelled</Text>
          <Text style={styles.cancelledBody}>
            {downReason ? `${downReason} ` : ''}Any buy-in was refunded to the teams that entered.
          </Text>
        </View>
      )}

      <View style={styles.card}>
        <Fact icon="time-outline" text={`${fmtKickoff(event.match_date, event.start_time)}${event.end_time ? ` – ${event.end_time}` : ''}`} styles={styles} theme={theme} />
        <Fact icon="location-outline" text={event.pitch_name} styles={styles} theme={theme} />
        {!!event.format && <Fact icon="football-outline" text={`${event.format}${event.skill_level ? ` · ${event.skill_level}` : ''}`} styles={styles} theme={theme} />}
        <Fact
          icon="people-outline"
          text={`${teams.length}/${event.max_teams} teams${full ? ' · full' : ''}`}
          styles={styles}
          theme={theme}
        />
        <Fact
          icon="card-outline"
          text={event.price_per_team_pence > 0 ? `${fmtFee(event.price_per_team_pence)} buy-in per team` : 'Free to enter'}
          styles={styles}
          theme={theme}
        />
      </View>

      {entered && (
        <View style={styles.entered}>
          <Ionicons name="checkmark-circle" size={16} color={theme.accentInk} />
          <Text style={styles.enteredText}>{myTeamName ?? 'Your team'} is entered</Text>
        </View>
      )}
      {canEnter && (
        <Pressable onPress={() => setEntering(true)} style={styles.primary}>
          <Text style={styles.primaryText}>Enter {myTeamName ?? 'your team'}</Text>
        </Pressable>
      )}

      <Text style={styles.section}>Teams</Text>
      {teams.length === 0 ? (
        <Text style={styles.muted}>No teams have entered yet.</Text>
      ) : (
        <View style={styles.chips}>
          {teams.map((t) => (
            <View key={t.team_id} style={[styles.chip, t.team_id === myTeamId && styles.chipMine]}>
              <Text style={[styles.chipText, t.team_id === myTeamId && { color: theme.accentInk }]}>{t.team_name || 'Team'}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.section}>Schedule</Text>
      {fixtures.length === 0 ? (
        <Text style={styles.muted}>The organiser hasn&apos;t drawn up the schedule yet.</Text>
      ) : (
        <View style={styles.card}>
          {fixtures.map((f, i) => {
            const mine = !!myTeamId && (f.home_team_id === myTeamId || f.away_team_id === myTeamId);
            const played = f.status === 'played' && f.home_score != null && f.away_score != null;
            const finish = finishOf(f.scheduled_time, f.duration_minutes);
            return (
              <Pressable
                key={f.id}
                disabled={!mine}
                onPress={() => router.push({ pathname: '/tournament-fixture/[fixtureId]', params: { fixtureId: f.id } })}
                style={[styles.fx, i > 0 && styles.divider, mine && styles.fxMine]}>
                <View style={{ width: 52 }}>
                  <Text style={styles.fxTime}>{f.scheduled_time ?? `#${i + 1}`}</Text>
                  {!!finish && <Text style={styles.fxFinish}>–{finish}</Text>}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.fxTeams} numberOfLines={2}>
                    {f.home_team_name ?? 'TBC'} {played ? `${f.home_score} – ${f.away_score}` : 'vs'} {f.away_team_name ?? 'TBC'}
                  </Text>
                  <Text style={styles.fxRef}>
                    Ref: {f.referee_name ?? 'unassigned'}
                    {f.referee_team_name ? ` (${f.referee_team_name})` : ''}
                  </Text>
                </View>
                {mine && <Ionicons name="chevron-forward" size={16} color={theme.accentInk} />}
              </Pressable>
            );
          })}
        </View>
      )}

      {standings.length > 0 && (
        <>
          <Text style={styles.section}>Table</Text>
          <View style={styles.card}>
            <View style={[styles.tr, styles.th]}>
              <Text style={[styles.tdName, styles.thText]}>Team</Text>
              {['P', 'W', 'D', 'L', 'GD', 'Pts'].map((h) => (
                <Text key={h} style={[styles.td, styles.thText]}>{h}</Text>
              ))}
            </View>
            {standings.map((r, i) => (
              <View key={`${r.name}-${i}`} style={[styles.tr, styles.divider]}>
                <Text style={styles.tdName} numberOfLines={1}>
                  {i + 1}. {r.name}
                </Text>
                {[r.played, r.w, r.d, r.l, r.gd, r.pts].map((v, k) => (
                  <Text key={k} style={[styles.td, k === 5 && { fontFamily: fonts.bold }]}>{v}</Text>
                ))}
              </View>
            ))}
          </View>
        </>
      )}

      {entering && myTeamId && user && (
        <EnterTournamentSheet
          tournament={asFeedTournament}
          teamId={myTeamId}
          teamName={myTeamName}
          userId={user.id}
          onClose={() => setEntering(false)}
          onEntered={() => void load()}
        />
      )}
    </ScrollView>
  );
}

function Fact({
  icon,
  text,
  styles,
  theme,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  styles: ReturnType<typeof makeStyles>;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={15} color={theme.textSecondary} />
      <Text style={styles.factText}>{text}</Text>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.background },
    content: { padding: 20, paddingTop: 56, paddingBottom: 48, gap: 12 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: theme.background },
    back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
    backText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 15 },
    kindPill: {
      alignSelf: 'flex-start',
      backgroundColor: '#FFF6E3',
      borderColor: '#F5DCA6',
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingHorizontal: 10,
      paddingVertical: 3,
    },
    kindText: { color: '#B07400', fontFamily: fonts.semibold, fontSize: 11 },
    heading: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 23 },
    sub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, marginTop: -8 },
    muted: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
    link: { color: theme.accentInk, fontFamily: fonts.semibold, fontSize: 14 },
    cancelled: { backgroundColor: '#FDECEC', borderColor: '#F5C2C2', borderWidth: 1, borderRadius: radius.card, padding: 14, gap: 4 },
    cancelledTitle: { color: theme.danger, fontFamily: fonts.bold, fontSize: 14 },
    cancelledBody: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      paddingHorizontal: 14,
      paddingVertical: 6,
      ...cardShadow,
    },
    fact: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
    factText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 13, flexShrink: 1 },
    entered: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      backgroundColor: theme.successBg,
      borderColor: theme.successBorder,
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingHorizontal: 12,
      paddingVertical: 5,
    },
    enteredText: { color: theme.accentInk, fontFamily: fonts.semibold, fontSize: 12 },
    primary: { backgroundColor: theme.accent, borderRadius: radius.btn, paddingVertical: 14, alignItems: 'center' },
    primaryText: { color: '#fff', fontFamily: fonts.bold, fontSize: 15 },
    section: {
      color: theme.textSecondary,
      fontFamily: fonts.semibold,
      fontSize: 12,
      textTransform: 'uppercase',
      letterSpacing: 0.7,
      marginTop: 10,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
    chipMine: { backgroundColor: theme.successBg, borderColor: theme.successBorder },
    chipText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 12 },
    divider: { borderTopWidth: 1, borderTopColor: theme.border },
    fx: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
    fxMine: { backgroundColor: '#F6FBF7', marginHorizontal: -14, paddingHorizontal: 14 },
    fxTime: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 12 },
    fxFinish: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 10 },
    fxTeams: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 13 },
    fxRef: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 11, marginTop: 1 },
    tr: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
    th: {},
    thText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 11 },
    tdName: { flex: 1, color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 13 },
    td: { width: 30, textAlign: 'center', color: theme.textPrimary, fontFamily: fonts.regular, fontSize: 12 },
  });
