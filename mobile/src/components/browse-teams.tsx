// Find a team to join — the mobile port of BrowseTeams in app/my-team/page.tsx,
// for a player with no squad. "Request to join" writes the same pending
// team_members row the web button does; the captain approves it from their
// My Team (web or phone).
//
// Two small differences from the web list, both fixes rather than new
// behaviour: the search box actually filters (by name or location — on the web
// it's drawn but not wired), and a request already sent shows as sent after
// reopening the screen, because the pending row is read back.

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { supabase } from '@/lib/supabase';
import { fmtFee } from '@/lib/joining-fee';
import { TEAM_LEVELS, teamFormatLabel } from '@/lib/team-options';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';
import { initialsOf } from '~/components/chat';

type Team = {
  id: string;
  name: string;
  location: string | null;
  level: string | null;
  description: string | null;
  format: string | null;
  formats?: string[] | null;
  joining_fee_pence?: number | null;
  captain_id: string;
};

export function BrowseTeams({ userId, onRequested }: { userId: string; onRequested?: () => void }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [level, setLevel] = useState('All');
  const [q, setQ] = useState('');

  useEffect(() => {
    void (async () => {
      const [{ data: t }, { data: mine }] = await Promise.all([
        supabase.from('teams').select('*'),
        supabase.from('team_members').select('team_id').eq('player_id', userId).eq('status', 'pending'),
      ]);
      setTeams((t ?? []) as Team[]);
      setRequested(new Set((mine ?? []).map((r) => r.team_id as string)));
      setLoading(false);
    })();
  }, [userId]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return teams
      .filter((t) => t.captain_id !== userId)
      .filter((t) => level === 'All' || t.level === level)
      .filter((t) => !needle || t.name.toLowerCase().includes(needle) || (t.location ?? '').toLowerCase().includes(needle));
  }, [teams, level, q, userId]);

  const request = async (teamId: string) => {
    setBusyId(teamId);
    const { error } = await supabase.from('team_members').insert({ team_id: teamId, player_id: userId });
    setBusyId(null);
    if (!error) {
      setRequested((prev) => new Set([...prev, teamId]));
      onRequested?.();
    }
  };

  if (loading) return <ActivityIndicator color={theme.accent} style={{ marginTop: 20 }} />;

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.search}>
        <Ionicons name="search" size={16} color={theme.textSecondary} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search teams or locations..."
          placeholderTextColor={theme.textSecondary}
          style={styles.searchInput}
          autoCorrect={false}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {['All', ...TEAM_LEVELS].map((l) => (
          <Pressable key={l} onPress={() => setLevel(l)} style={[styles.chip, level === l && styles.chipOn]}>
            <Text style={[styles.chipText, level === l && styles.chipTextOn]}>{l}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {shown.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No teams found</Text>
          <Text style={styles.emptyBody}>Try another search, or register your own.</Text>
        </View>
      )}

      {shown.map((t) => {
        const sent = requested.has(t.id);
        const fee = t.joining_fee_pence ?? 0;
        return (
          <View key={t.id} style={styles.card}>
            <View style={styles.head}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initialsOf(t.name)}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name} numberOfLines={1}>{t.name}</Text>
                {!!t.location && <Text style={styles.sub}>{t.location}</Text>}
              </View>
              {!!t.level && (
                <View style={styles.level}>
                  <Text style={styles.levelText}>{t.level}</Text>
                </View>
              )}
            </View>
            {!!t.description && <Text style={styles.desc} numberOfLines={3}>{t.description}</Text>}
            <View style={styles.tags}>
              {!!teamFormatLabel(t) && (
                <View style={styles.tag}>
                  <Text style={styles.tagText}>{teamFormatLabel(t)}</Text>
                </View>
              )}
              {/* Shown up front so nobody finds a charge only after approval. */}
              <View style={styles.tag}>
                <Text style={styles.tagText}>{fee > 0 ? `${fmtFee(fee)} joining fee` : 'No joining fee'}</Text>
              </View>
            </View>
            <Pressable
              onPress={() => void request(t.id)}
              disabled={sent || busyId === t.id}
              style={[styles.btn, sent && styles.btnSent]}>
              {busyId === t.id ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={[styles.btnText, sent && { color: theme.accentInk }]}>{sent ? 'Request sent' : 'Request to join'}</Text>
              )}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    search: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      borderRadius: radius.btn,
      paddingHorizontal: 12,
    },
    searchInput: { flex: 1, paddingVertical: 10, color: theme.textPrimary, fontFamily: fonts.regular, fontSize: 14 },
    chip: { borderWidth: 1, borderColor: theme.border, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: theme.surface2 },
    chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    chipText: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 13 },
    chipTextOn: { color: '#fff' },
    empty: { alignItems: 'center', paddingVertical: 24, gap: 4 },
    emptyTitle: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14 },
    emptyBody: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      padding: 14,
      gap: 10,
      ...cardShadow,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: 11 },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: theme.successBg,
      borderWidth: 1,
      borderColor: theme.successBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: theme.accentInk, fontFamily: fonts.bold, fontSize: 14 },
    name: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 15 },
    sub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
    level: { backgroundColor: theme.surface2, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
    levelText: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 11 },
    desc: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    tag: { borderWidth: 1, borderColor: theme.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
    tagText: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 11 },
    btn: { backgroundColor: theme.accent, borderRadius: radius.btn, paddingVertical: 11, alignItems: 'center' },
    btnSent: { backgroundColor: theme.successBg, borderWidth: 1, borderColor: theme.successBorder },
    btnText: { color: '#fff', fontFamily: fonts.bold, fontSize: 14 },
  });
