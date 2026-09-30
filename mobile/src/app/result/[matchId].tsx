// Submit Result for a friendly — the mobile port of
// app/my-team/match/[matchId]/result/page.tsx. Opened from Manage Match by the
// captain (or a co-captain).
//
// Everything that decides anything is shared (lib/submit-result.ts): who the
// roster is, the rules (goals add up to the score exactly, assists don't
// exceed it) and the write, including the cross-team check — matching scores
// verify the match, a mismatch clears both sides and DMs both captains. The
// phone only draws the form.
//
// One difference from the web: a saved result goes back to Manage Match
// rather than on to Settle Payments, which isn't ported for friendlies.

import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAuth } from '@/contexts/AuthContext';
import {
  loadResultForm,
  submitMatchResult,
  totalOf,
  validateResult,
  SCORE_CONFLICT_MESSAGE,
  type PlayerStats,
  type ResultForm,
} from '@/lib/submit-result';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';

export default function SubmitResult() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const { user } = useAuth();

  const [form, setForm] = useState<ResultForm | null | undefined>(undefined);
  const [teamScore, setTeamScore] = useState('');
  const [opponentScore, setOpponentScore] = useState('');
  const [stats, setStats] = useState<Record<string, PlayerStats>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !matchId) return;
    void loadResultForm(matchId, user.id).then((f) => {
      setForm(f);
      if (!f) return;
      if (f.existing) {
        setTeamScore(String(f.existing.teamScore));
        setOpponentScore(String(f.existing.opponentScore));
      }
      setStats(f.stats);
    });
  }, [user, matchId]);

  if (form === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  if (form === null || !form.myTeamId) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{form === null ? 'Match not found.' : 'Only the captain or a co-captain of a team in this match can submit its result.'}</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const ts = parseInt(teamScore, 10);
  const totalGoals = totalOf(stats, 'goals');
  const totalAssists = totalOf(stats, 'assists');
  const goalsLeft = ts - totalGoals;
  const setStat = (playerId: string, field: keyof PlayerStats, value: number) =>
    setStats((prev) => ({ ...prev, [playerId]: { ...(prev[playerId] ?? { goals: 0, assists: 0 }), [field]: value } }));

  const submit = async () => {
    if (!user || !form.myTeamId) return;
    const invalid = validateResult(teamScore, opponentScore, stats);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError(null);
    const { conflict } = await submitMatchResult({
      match: form.match,
      myTeamId: form.myTeamId,
      userId: user.id,
      teamScore: ts,
      opponentScore: parseInt(opponentScore, 10),
      stats,
    });
    setSaving(false);
    if (conflict) {
      setError(SCORE_CONFLICT_MESSAGE);
      return;
    }
    router.back();
  };

  const nameOf = (p: { player_id: string; name: string }) => (p.player_id === user?.id ? 'You' : p.name);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
        <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      <Text style={styles.heading}>Submit Result</Text>
      <Text style={styles.sub}>
        {form.myTeamName} vs {form.opponentName}
      </Text>

      {!!form.existing && (
        <View style={styles.info}>
          <Text style={styles.infoText}>A result has already been submitted — saving again will update it.</Text>
        </View>
      )}
      {!!error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Final Score</Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={styles.label}>Your Team</Text>
            <TextInput value={teamScore} onChangeText={(v) => setTeamScore(v.replace(/\D/g, ''))} keyboardType="number-pad" style={styles.scoreInput} />
          </View>
          <Text style={[styles.label, { paddingBottom: 14 }]}>–</Text>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={styles.label}>Opponent</Text>
            <TextInput value={opponentScore} onChangeText={(v) => setOpponentScore(v.replace(/\D/g, ''))} keyboardType="number-pad" style={styles.scoreInput} />
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>Goalscorers</Text>
          {!isNaN(ts) && ts > 0 && (
            <View style={[styles.pill, goalsLeft === 0 ? styles.pillDone : styles.pillLeft]}>
              <Text style={[styles.pillText, { color: goalsLeft === 0 ? theme.accentInk : '#B07400' }]}>
                {goalsLeft === 0 ? '✓ All accounted for' : `${goalsLeft} goal${goalsLeft !== 1 ? 's' : ''} left`}
              </Text>
            </View>
          )}
        </View>
        <Text style={styles.muted}>Goals per player must add up to your team&apos;s score exactly.</Text>
        {form.roster.map((p) => {
          const s = stats[p.player_id] ?? { goals: 0, assists: 0 };
          return (
            <View key={p.player_id} style={styles.row}>
              <Text style={styles.name} numberOfLines={1}>
                {nameOf(p)}
              </Text>
              <Text style={styles.small}>⚽</Text>
              <Counter
                value={s.goals}
                onChange={(n) => setStat(p.player_id, 'goals', n)}
                max={isNaN(ts) ? undefined : ts - totalGoals + s.goals}
                styles={styles}
              />
            </View>
          );
        })}
      </View>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>Assists</Text>
          <Text style={styles.small}>{totalAssists} total</Text>
        </View>
        <Text style={styles.muted}>Assists don&apos;t need to match exactly — total must not exceed goals scored.</Text>
        {form.roster.map((p) => {
          const s = stats[p.player_id] ?? { goals: 0, assists: 0 };
          return (
            <View key={p.player_id} style={styles.row}>
              <Text style={styles.name} numberOfLines={1}>
                {nameOf(p)}
              </Text>
              <Text style={styles.small}>🅰️</Text>
              <Counter
                value={s.assists}
                onChange={(n) => setStat(p.player_id, 'assists', n)}
                max={isNaN(ts) ? undefined : ts - totalAssists + s.assists}
                styles={styles}
              />
            </View>
          );
        })}
      </View>

      <Pressable onPress={submit} disabled={saving} style={[styles.primary, saving && { opacity: 0.6 }]}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Submit Result</Text>}
      </Pressable>
    </ScrollView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function Counter({ value, onChange, max, styles }: { value: number; onChange: (n: number) => void; max?: number; styles: Styles }) {
  const atMax = max !== undefined && value >= max;
  return (
    <View style={styles.counter}>
      <Pressable disabled={value <= 0} onPress={() => onChange(Math.max(0, value - 1))} style={[styles.step, value <= 0 && { opacity: 0.3 }]} hitSlop={4}>
        <Text style={styles.stepText}>−</Text>
      </Pressable>
      <Text style={styles.count}>{value}</Text>
      <Pressable disabled={atMax} onPress={() => onChange(value + 1)} style={[styles.step, atMax && { opacity: 0.3 }]} hitSlop={4}>
        <Text style={styles.stepText}>+</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.background },
    content: { padding: 20, paddingTop: 56, paddingBottom: 48, gap: 12 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24, backgroundColor: theme.background },
    back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
    backText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 15 },
    heading: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 22 },
    sub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, marginTop: -8 },
    muted: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, textAlign: 'left' },
    small: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 11 },
    link: { color: theme.accentInk, fontFamily: fonts.semibold, fontSize: 14 },
    label: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 12 },
    info: { backgroundColor: theme.successBg, borderColor: theme.successBorder, borderWidth: 1, borderRadius: 12, padding: 12 },
    infoText: { color: theme.accentInk, fontFamily: fonts.regular, fontSize: 12 },
    errorBox: { backgroundColor: '#FDECEC', borderColor: '#F5C2C2', borderWidth: 1, borderRadius: 12, padding: 12 },
    errorText: { color: theme.danger, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      padding: 14,
      gap: 8,
      ...cardShadow,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    cardTitle: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14 },
    scoreInput: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 12,
      paddingVertical: 10,
      textAlign: 'center',
      color: theme.textPrimary,
      fontFamily: fonts.extrabold,
      fontSize: 26,
      backgroundColor: theme.background,
    },
    pill: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
    pillDone: { backgroundColor: theme.successBg },
    pillLeft: { backgroundColor: '#FFF6E3' },
    pillText: { fontFamily: fonts.semibold, fontSize: 11 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: theme.background,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    name: { flex: 1, color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 14 },
    counter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    step: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: theme.surface2,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepText: { color: theme.textSecondary, fontFamily: fonts.bold, fontSize: 15 },
    count: { width: 20, textAlign: 'center', color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
    primary: { backgroundColor: theme.accent, borderRadius: radius.btn, paddingVertical: 14, alignItems: 'center' },
    primaryText: { color: '#fff', fontFamily: fonts.bold, fontSize: 15 },
  });
