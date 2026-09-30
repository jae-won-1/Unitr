// My Team — squad, team details, and (for leaders) the management entry points.
//
// useLeadership is the web app's own hook, imported unchanged. That matters
// more here than anywhere: "the team I run" is deliberately NOT resolved with
// .eq("captain_id", user.id) at the call site, because a co-captain captains no
// team and that lookup finds nothing for them. Reusing the hook means this
// screen inherits the co-captain rules for free rather than reimplementing a
// subtlety it would be easy to get wrong.
//
// loadSquadForAppointment is likewise shared — it is the squad list, and it
// already carries the missing-migration guard (returns null when
// supabase_co_captains.sql hasn't been run) so this screen degrades the same
// way the web one does instead of erroring.
//
// Laid out like the web's My Team: a team card (Invite Players, Team Settings,
// Post Announcement for leaders; Team Chat for everyone), then four tabs —
// Manage Match · Tactics · Stats · Members. Money and the availability poll
// live on Home, as on the web. Tactics opens its own screen rather than an
// inline tab, because the editor needs the whole screen on a phone.

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
import { router, useFocusEffect, type Href } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { compareEntries, KIND_LABEL, loadCalendarEntries, type CalendarEntry } from '@/lib/calendar-entries';
import { fmtKickoff } from '@/lib/match-dates';
import {
  useLeadership,
  loadSquadForAppointment,
  type CoCaptainRow,
} from '@/lib/team-leadership';
import { fonts, radius, cardShadow } from '~/theme';
import { useIsDark, useTheme } from '~/use-theme';
import { kindTints } from '~/kind-style';
import { TopActions } from '~/components/top-actions';
import LeaveTeamPanel from '~/components/leave-team-panel';
import { JoinRequests } from '~/components/join-requests';
import { BrowseTeams } from '~/components/browse-teams';
import { PlayerSheet } from '~/components/player-sheet';
import { FixtureDetailSheet } from '~/components/fixture-detail-sheet';
import { TeamStatsPanel } from '~/components/team-stats';

type Team = {
  id: string;
  name: string | null;
  location: string | null;
  level: string | null;
  format: string | null;
  description: string | null;
  joining_fee_pence: number | null;
  captain_id: string;
};

type Tab = 'match' | 'tactics' | 'stats' | 'members';
const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'match', label: 'Manage Match', icon: 'football-outline' },
  { key: 'tactics', label: 'Tactics', icon: 'tablet-landscape-outline' },
  { key: 'stats', label: 'Stats', icon: 'stats-chart' },
  { key: 'members', label: 'Members', icon: 'people-outline' },
];

const initials = (name: string | null | undefined) =>
  (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

export default function MyTeam() {
  const theme = useTheme();
  const dark = useIsDark();
  const styles = makeStyles(theme);
  const { user } = useAuth();
  const { teamId, isCaptain, isCoCaptain, loading: leadLoading, reload: reloadLead } = useLeadership(user?.id);

  // useLeadership is keyed on the user id, which doesn't change when the
  // player's team does — registering a team, being approved into one, or
  // leaving. Re-read it whenever the tab comes into focus.
  useFocusEffect(
    useCallback(() => {
      void reloadLead();
    }, [reloadLead]),
  );

  const [tab, setTab] = useState<Tab>('match');
  const [team, setTeam] = useState<Team | null>(null);
  const [squad, setSquad] = useState<CoCaptainRow[] | null>(null);
  const [captainName, setCaptainName] = useState<string | null>(null);
  // Manage Match: the next two fixtures, as on the web — a doorway into the
  // game, not a second Calendar. Same shared list the Calendar tab reads.
  const [upcoming, setUpcoming] = useState<CalendarEntry[] | null>(null);
  const [openEntry, setOpenEntry] = useState<CalendarEntry | null>(null);
  const [viewing, setViewing] = useState<{ id: string; role: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!teamId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const { data } = await supabase
      .from('teams')
      .select('id, name, location, level, format, description, joining_fee_pence, captain_id')
      .eq('id', teamId)
      .maybeSingle();
    setTeam((data as Team) ?? null);
    // The squad list below leaves the captain out (it's the co-captain
    // appointment list), and the captain is who players most want to message.
    const capId = (data as Team | null)?.captain_id;
    if (capId) {
      const { data: cap } = await supabase.from('profiles').select('full_name').eq('id', capId).maybeSingle();
      setCaptainName((cap as { full_name?: string } | null)?.full_name ?? 'Captain');
    }
    setSquad(await loadSquadForAppointment(teamId));
    if (user) {
      try {
        const { entries } = await loadCalendarEntries(user.id);
        setUpcoming(entries.filter((e) => e.isUpcoming).sort(compareEntries).slice(0, 2));
      } catch {
        setUpcoming([]);
      }
    }
    setLoading(false);
    setRefreshing(false);
  }, [teamId, user]);

  useEffect(() => {
    if (!leadLoading) void load();
  }, [leadLoading, load]);

  if (leadLoading || loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  // new_user: signed in but teamless — register a team, or find one and ask
  // to join, as on the web's My Team.
  if (!teamId) {
    return (
      <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TopActions />
        <Text style={styles.heading}>My Team</Text>
        <Text style={styles.subheading}>You&apos;re not in a squad yet.</Text>
        <View style={[styles.actions, { flexDirection: 'row' }]}>
          <Pressable onPress={() => router.push('/create-team')} style={[styles.action, styles.actionPrimary]}>
            <Text style={styles.actionPrimaryText}>Register your team</Text>
          </Pressable>
        </View>
        <Pressable onPress={() => router.push('/transfer')} style={[styles.action, { marginTop: 8 }]}>
          <Text style={styles.actionText}>Transfer Market — offers and friends</Text>
        </Pressable>
        <Text style={styles.sectionTitle}>Find a team</Text>
        {user && <BrowseTeams userId={user.id} />}
      </ScrollView>
    );
  }

  const role = isCaptain ? (isCoCaptain ? 'Co-captain' : 'Captain') : 'Player';

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
      <TopActions />
      <Text style={styles.heading}>My Team</Text>
      <Text style={styles.subheading}>
        {isCaptain ? 'Run your squad and organise the next game' : 'Your squad and your next game'}
      </Text>

      <View style={[styles.card, styles.teamCard]}>
        <View style={styles.teamHead}>
          <View style={styles.teamBadge}>
            <Text style={styles.teamBadgeText}>{initials(team?.name)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.teamName}>{team?.name ?? 'My Team'}</Text>
            <Text style={styles.teamMeta}>
              {[team?.location, team?.level, team?.format].filter(Boolean).join(' · ')}
            </Text>
          </View>
          {role !== 'Captain' && (
            <View style={styles.rolePill}>
              <Text style={styles.rolePillText}>{role}</Text>
            </View>
          )}
        </View>
        {!!team?.description && <Text style={styles.description}>{team.description}</Text>}

        <View style={styles.actions}>
          {isCaptain && (
            <Pressable onPress={() => router.push('/team-settings')} style={[styles.action, styles.actionPrimary]}>
              <Text style={styles.actionPrimaryText}>Invite Players</Text>
            </Pressable>
          )}
          {isCaptain && (
            <View style={styles.actionRow}>
              <Pressable onPress={() => router.push('/team-settings')} style={styles.action}>
                <Text style={styles.actionText}>Team Settings</Text>
              </Pressable>
              <Pressable onPress={() => router.push('/announcement')} style={styles.action}>
                <Text style={styles.actionText}>Post Announcement</Text>
              </Pressable>
            </View>
          )}
          {/* Not captain-gated: the chat is the whole squad's. */}
          <Pressable onPress={() => router.push('/messages/team' as Href)} style={styles.action}>
            <Text style={styles.actionText}>Team Chat</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.tabs}>
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => (t.key === 'tactics' ? router.push('/tactics') : setTab(t.key))}
              style={styles.tab}>
              <View style={[styles.tabCircle, on && styles.tabCircleOn]}>
                <Ionicons name={t.icon} size={22} color={on ? '#fff' : theme.textSecondary} />
              </View>
              <Text style={[styles.tabLabel, on && styles.tabLabelOn]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {tab === 'match' && (
        <View>
          <Text style={styles.tabTitle}>Next up</Text>
          <Text style={styles.tabSub}>Open a fixture to set the lineup and see who&apos;s playing.</Text>
          {upcoming === null ? (
            <ActivityIndicator color={theme.accent} style={{ marginVertical: 20 }} />
          ) : upcoming.length === 0 ? (
            <View style={[styles.card, styles.emptyCard]}>
              <Text style={styles.emptyTitle}>No confirmed fixtures yet</Text>
              <Text style={styles.emptyBody}>
                {isCaptain
                  ? 'Post a match or enter a tournament from Home to get one in the diary.'
                  : 'Games your captain commits to will appear here.'}
              </Text>
              {isCaptain && (
                <Pressable onPress={() => router.push('/post-match')} style={styles.smallPrimary}>
                  <Text style={styles.actionPrimaryText}>Post a Match</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {upcoming.map((e) => {
                const tint = kindTints(dark)[e.kind];
                return (
                  <Pressable
                    key={e.id}
                    onPress={() => setOpenEntry(e)}
                    style={[styles.card, styles.fixture, { borderLeftColor: tint.rule }]}>
                    <View style={[styles.kind, { backgroundColor: tint.bg, borderColor: tint.border }]}>
                      <Text style={[styles.kindText, { color: tint.text }]}>{KIND_LABEL[e.kind]}</Text>
                    </View>
                    <Text style={styles.fixtureTitle}>{e.title}</Text>
                    <Text style={styles.fixtureMeta}>{fmtKickoff(e.date, e.time)}</Text>
                    {!!e.pitch && <Text style={styles.fixtureMeta}>{e.pitch}</Text>}
                  </Pressable>
                );
              })}
            </View>
          )}
          <Pressable onPress={() => router.push('/calendar')} style={[styles.action, { marginTop: 12 }]}>
            <Text style={styles.actionText}>See all fixtures in Calendar</Text>
          </Pressable>
        </View>
      )}

      {tab === 'stats' && user && (
        <TeamStatsPanel
          teamId={teamId}
          userId={user.id}
          isCaptain={isCaptain}
          people={[
            ...(team?.captain_id ? [{ id: team.captain_id, name: captainName ?? 'Captain' }] : []),
            ...(squad ?? []).map((m) => ({ id: m.playerId, name: m.name })),
          ]}
        />
      )}

      {tab === 'members' && (
        <View>
          {isCaptain && <JoinRequests teamId={teamId} onChanged={load} />}

          <Text style={styles.sectionTitle}>
            Squad{squad ? ` · ${squad.length + (team?.captain_id ? 1 : 0)}` : ''}
          </Text>

          {squad === null ? (
            // Shared helper returns null when the co-captain migration is
            // missing — say so plainly rather than showing an empty squad.
            <View style={styles.listCard}>
              <Text style={styles.muted}>
                Squad list unavailable — the co-captain migration has not been run on this
                database.
              </Text>
            </View>
          ) : (
            <View style={styles.listCard}>
              {/* Tap anyone to see their details and message them. */}
              {team?.captain_id && (
                <Pressable onPress={() => setViewing({ id: team.captain_id, role: 'Captain' })} style={styles.member}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{(captainName ?? 'C').trim().charAt(0).toUpperCase()}</Text>
                  </View>
                  <Text style={styles.memberName}>{captainName ?? 'Captain'}</Text>
                  <View style={styles.coBadge}>
                    <Text style={styles.coBadgeText}>Captain</Text>
                  </View>
                </Pressable>
              )}
              {squad.map((m) => (
                <Pressable
                  key={m.playerId}
                  onPress={() => setViewing({ id: m.playerId, role: m.isCoCaptain ? 'Co-captain' : null })}
                  style={[styles.member, { borderTopWidth: 1, borderTopColor: theme.border }]}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{m.name.trim().charAt(0).toUpperCase() || '?'}</Text>
                  </View>
                  <Text style={styles.memberName}>{m.name}</Text>
                  {m.isCoCaptain && (
                    <View style={styles.coBadge}>
                      <Text style={styles.coBadgeText}>Co-captain</Text>
                    </View>
                  )}
                </Pressable>
              ))}
              {squad.length === 0 && <Text style={styles.muted}>No other players yet.</Text>}
            </View>
          )}
        </View>
      )}

      {/* Bottom of the screen, under every tab: leaving is about the squad, not
          whichever section you're on. A co-captain is still a squad member with
          a membership row to give up, so only the actual captain gets the
          greyed version — same split as CoCaptainsPanel. */}
      {user && team && (
        <LeaveTeamPanel
          teamId={team.id}
          teamName={team.name ?? 'this team'}
          userId={user.id}
          isCaptain={isCaptain && !isCoCaptain}
          joiningFeePence={team.joining_fee_pence}
        />
      )}

      {openEntry && user && (
        <FixtureDetailSheet
          entry={openEntry}
          isCaptain={isCaptain}
          viewerId={user.id}
          viewerTeamId={teamId}
          onClose={() => setOpenEntry(null)}
        />
      )}

      <PlayerSheet
        playerId={viewing?.id ?? null}
        role={viewing?.role}
        viewerId={user?.id}
        onClose={() => setViewing(null)}
      />
    </ScrollView>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.background },
    content: { padding: 20, paddingTop: 60, paddingBottom: 40 },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingHorizontal: 34,
      backgroundColor: theme.background,
    },
    heading: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 26, paddingRight: 128 },
    subheading: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 14, marginTop: 4 },
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      padding: 16,
      ...cardShadow,
    },
    teamCard: { marginTop: 16 },
    teamHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    teamBadge: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: theme.successBg,
      borderWidth: 1,
      borderColor: theme.successBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    teamBadgeText: { color: theme.accentInk, fontFamily: fonts.extrabold, fontSize: 18 },
    teamName: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 18 },
    teamMeta: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, marginTop: 2 },
    rolePill: {
      backgroundColor: theme.accent,
      borderRadius: radius.pill,
      paddingHorizontal: 11,
      paddingVertical: 4,
    },
    rolePillText: { color: '#fff', fontFamily: fonts.semibold, fontSize: 11 },
    description: {
      color: theme.textSecondary,
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 20,
      marginTop: 12,
    },
    actions: { gap: 8, marginTop: 16 },
    actionRow: { flexDirection: 'row', gap: 8 },
    action: {
      flex: 1,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: radius.btn,
      paddingVertical: 12,
      alignItems: 'center',
      backgroundColor: theme.surface,
    },
    actionText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 13 },
    actionPrimary: { backgroundColor: theme.accent, borderColor: theme.accent },
    actionPrimaryText: { color: '#fff', fontFamily: fonts.bold, fontSize: 14 },
    tabs: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 22, marginBottom: 18 },
    tab: { flex: 1, alignItems: 'center', gap: 8 },
    tabCircle: {
      width: 56,
      height: 56,
      borderRadius: 28,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabCircleOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    tabLabel: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 11, textAlign: 'center' },
    tabLabelOn: { color: theme.textPrimary, fontFamily: fonts.bold },
    tabTitle: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 15 },
    tabSub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, marginTop: 2, marginBottom: 12 },
    emptyCard: { alignItems: 'center', paddingVertical: 24, gap: 6 },
    emptyTitle: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 15 },
    emptyBody: {
      color: theme.textSecondary,
      fontFamily: fonts.regular,
      fontSize: 13,
      textAlign: 'center',
      lineHeight: 19,
    },
    smallPrimary: {
      marginTop: 8,
      backgroundColor: theme.accent,
      borderRadius: radius.btn,
      paddingHorizontal: 20,
      paddingVertical: 10,
    },
    fixture: { borderLeftWidth: 4, paddingVertical: 14, gap: 3 },
    kind: {
      alignSelf: 'flex-start',
      borderRadius: radius.pill,
      borderWidth: 1,
      paddingHorizontal: 9,
      paddingVertical: 3,
      marginBottom: 4,
    },
    kindText: { fontFamily: fonts.semibold, fontSize: 11 },
    fixtureTitle: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 16 },
    fixtureMeta: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 13 },
    sectionTitle: {
      color: theme.textSecondary,
      fontFamily: fonts.semibold,
      fontSize: 12,
      textTransform: 'uppercase',
      letterSpacing: 0.7,
      marginTop: 18,
      marginBottom: 10,
    },
    listCard: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      paddingHorizontal: 15,
      ...cardShadow,
    },
    muted: {
      color: theme.textSecondary,
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 19,
      paddingVertical: 14,
    },
    member: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 12 },
    avatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: theme.accent2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: '#fff', fontFamily: fonts.bold, fontSize: 14 },
    memberName: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 15, flex: 1 },
    coBadge: {
      backgroundColor: theme.successBg,
      borderColor: theme.successBorder,
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingHorizontal: 9,
      paddingVertical: 3,
    },
    coBadgeText: { color: theme.accentInk, fontFamily: fonts.semibold, fontSize: 10 },
  });
