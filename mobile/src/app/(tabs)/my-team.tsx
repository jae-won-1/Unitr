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
// Not yet ported: the captain's control panel sub-pages (tactics, settle
// payments, team settings, match management). Phase 4.

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  useLeadership,
  loadSquadForAppointment,
  type CoCaptainRow,
} from '@/lib/team-leadership';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';

type Team = {
  name: string | null;
  location: string | null;
  level: string | null;
  format: string | null;
  description: string | null;
};

export default function MyTeam() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { user } = useAuth();
  const { teamId, isCaptain, isCoCaptain, loading: leadLoading } = useLeadership(user?.id);

  const [team, setTeam] = useState<Team | null>(null);
  const [squad, setSquad] = useState<CoCaptainRow[] | null>(null);
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
      .select('name, location, level, format, description')
      .eq('id', teamId)
      .maybeSingle();
    setTeam((data as Team) ?? null);
    setSquad(await loadSquadForAppointment(teamId));
    setLoading(false);
    setRefreshing(false);
  }, [teamId]);

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

  // new_user: signed in but teamless. The web app's Home offers registering a
  // team or joining one; those flows are not ported yet, so this says what the
  // state is rather than offering a button that goes nowhere.
  if (!teamId) {
    return (
      <View style={styles.center}>
        <Ionicons name="people-outline" size={40} color={theme.textSecondary} />
        <Text style={styles.emptyTitle}>No team yet</Text>
        <Text style={styles.emptyBody}>
          Join a squad or register your own on the web app, and it will appear here.
        </Text>
      </View>
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
      <Text style={styles.heading}>{team?.name ?? 'My Team'}</Text>

      <View style={styles.metaRow}>
        <View style={styles.rolePill}>
          <Text style={styles.rolePillText}>{role}</Text>
        </View>
        {team?.level && <Text style={styles.meta}>{team.level}</Text>}
        {team?.format && <Text style={styles.meta}>{team.format}</Text>}
      </View>

      {team?.location && <Text style={styles.location}>{team.location}</Text>}
      {team?.description && <Text style={styles.description}>{team.description}</Text>}

      <Text style={styles.sectionTitle}>
        Squad{squad ? ` · ${squad.length}` : ''}
      </Text>

      {squad === null ? (
        // Shared helper returns null when the co-captain migration is missing —
        // say so plainly rather than showing an empty squad, per the house rule
        // that missing migrations degrade rather than crash.
        <View style={styles.card}>
          <Text style={styles.muted}>
            Squad list unavailable — the co-captain migration has not been run on this
            database.
          </Text>
        </View>
      ) : squad.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.muted}>No approved members yet.</Text>
        </View>
      ) : (
        <View style={styles.card}>
          {squad.map((m, i) => (
            <View
              key={m.playerId}
              style={[styles.member, i > 0 && { borderTopWidth: 1, borderTopColor: theme.border }]}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {m.name.trim().charAt(0).toUpperCase() || '?'}
                </Text>
              </View>
              <Text style={styles.memberName}>{m.name}</Text>
              {m.isCoCaptain && (
                <View style={styles.coBadge}>
                  <Text style={styles.coBadgeText}>Co-captain</Text>
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      <Text style={styles.footnote}>
        Tactics, settle payments, team settings and match management arrive in Phase 4. They
        remain on the web app until then.
      </Text>
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
    emptyTitle: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 19 },
    emptyBody: {
      color: theme.textSecondary,
      fontFamily: fonts.regular,
      fontSize: 14,
      lineHeight: 21,
      textAlign: 'center',
    },
    heading: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 26 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' },
    rolePill: {
      backgroundColor: theme.accent,
      borderRadius: radius.pill,
      paddingHorizontal: 11,
      paddingVertical: 4,
    },
    rolePillText: { color: '#fff', fontFamily: fonts.semibold, fontSize: 11 },
    meta: {
      color: theme.textSecondary,
      fontFamily: fonts.medium,
      fontSize: 12,
      backgroundColor: theme.surface2,
      borderRadius: radius.pill,
      paddingHorizontal: 10,
      paddingVertical: 4,
      overflow: 'hidden',
    },
    location: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, marginTop: 10 },
    description: {
      color: theme.textSecondary,
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 20,
      marginTop: 8,
    },
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
    footnote: {
      color: theme.textSecondary,
      fontFamily: fonts.regular,
      fontSize: 12,
      lineHeight: 18,
      marginTop: 24,
    },
  });
