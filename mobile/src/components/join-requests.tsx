// Join requests — the mobile port of JoinRequests in app/my-team/page.tsx.
//
// Above the squad on My Team, not buried further down: an unanswered request
// has someone waiting on the other end. Approving writes the same approved
// team_members row the web button writes, so the database triggers that hang
// off it — the joining-fee snapshot and the welcome DM — fire unchanged.

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { supabase } from '@/lib/supabase';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';
import { initialsOf } from '~/components/chat';

type JoinRequest = {
  id: string;
  player_id: string;
  profiles: { full_name: string | null; position: string | null } | null;
};

export function JoinRequests({ teamId, onChanged }: { teamId: string; onChanged?: () => void }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Same embedded select the web uses — team_members → profiles is a
    // registered relationship, unlike teams.captain_id → profiles.
    const { data } = await supabase
      .from('team_members')
      .select('id, player_id, profiles(full_name, position)')
      .eq('team_id', teamId)
      .eq('status', 'pending');
    setRequests((data ?? []) as unknown as JoinRequest[]);
  }, [teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  const answer = async (id: string, status: 'approved' | 'rejected') => {
    setBusyId(id);
    await supabase.from('team_members').update({ status }).eq('id', id);
    setRequests((prev) => prev.filter((r) => r.id !== id));
    setBusyId(null);
    onChanged?.();
  };

  if (requests.length === 0) return null;

  return (
    <View style={{ marginTop: 22 }}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Join requests</Text>
        <View style={styles.count}>
          <Text style={styles.countText}>{requests.length}</Text>
        </View>
      </View>
      <View style={{ gap: 8 }}>
        {requests.map((r) => {
          const name = r.profiles?.full_name || 'Unknown player';
          const busy = busyId === r.id;
          return (
            <View key={r.id} style={styles.card}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initialsOf(name) || '?'}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name} numberOfLines={1}>{name}</Text>
                <Text style={styles.sub}>{r.profiles?.position ?? '—'}</Text>
              </View>
              {busy ? (
                <ActivityIndicator color={theme.accent} />
              ) : (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable onPress={() => answer(r.id, 'rejected')} style={styles.decline}>
                    <Text style={styles.declineText}>Decline</Text>
                  </Pressable>
                  <Pressable onPress={() => answer(r.id, 'approved')} style={styles.approve}>
                    <Text style={styles.approveText}>Approve</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
    title: {
      color: theme.textSecondary,
      fontFamily: fonts.semibold,
      fontSize: 12,
      textTransform: 'uppercase',
      letterSpacing: 0.7,
    },
    count: { backgroundColor: theme.accent, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1 },
    countText: { color: '#fff', fontFamily: fonts.bold, fontSize: 11 },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      paddingHorizontal: 14,
      paddingVertical: 12,
      ...cardShadow,
    },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: theme.successBg,
      borderWidth: 1,
      borderColor: theme.successBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: theme.accentInk, fontFamily: fonts.bold, fontSize: 12 },
    name: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14 },
    sub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
    decline: { borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7 },
    declineText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 12 },
    approve: { backgroundColor: theme.accent, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7 },
    approveText: { color: '#fff', fontFamily: fonts.bold, fontSize: 12 },
  });
