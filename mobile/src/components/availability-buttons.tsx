// "Am I playing?" — the per-fixture answer.
//
// readMyStatus / writeMyStatus and the gate are all shared. That matters here
// more than almost anywhere, because two rules are easy to get subtly wrong and
// both are already solved:
//
//   1. A friendly keys its answer off match_id, a tournament entry off
//      open_match_id, and the two take different write paths — the match side
//      upserts on a unique index, while tournament rows are guarded by a
//      PARTIAL unique index PostgREST cannot name as a conflict target, so they
//      read-then-insert-or-update. writeMyStatus owns that distinction.
//
//   2. ONLY the "available" half is gated. A player who owes the team money
//      cannot put themselves forward for a game, but ruling yourself out claims
//      no place and costs the team nothing — and blocking it turned a real
//      "I can't play" into a silence the captain read as "hasn't replied" and
//      chased. So Available greys out with the reason under it while
//      Unavailable stays live.
//
// The gate is client-side only here, exactly as on the web: nothing in RLS or
// an API route enforces it.

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import {
  readMyStatus,
  writeMyStatus,
  type AvailabilityTarget,
  type ConfirmStatus,
} from '@/lib/event-availability';
import { useAvailabilityGate, owedSummary } from '@/lib/availability-gate';
import { fonts, radius } from '~/theme';
import { useTheme } from '~/use-theme';

export function AvailabilityButtons({
  target,
  playerId,
  teamId,
}: {
  target: AvailabilityTarget;
  playerId: string;
  teamId: string;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);

  const [status, setStatus] = useState<ConfirmStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const gate = useAvailabilityGate(teamId, playerId);

  useEffect(() => {
    let live = true;
    readMyStatus(target, playerId).then((s) => {
      if (live) setStatus(s);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.matchId, target.openMatchId, playerId]);

  const answer = useCallback(
    async (next: ConfirmStatus) => {
      if (saving) return;
      const previous = status;
      setStatus(next); // optimistic
      setSaving(true);
      const ok = await writeMyStatus(target, { playerId, teamId, status: next });
      if (!ok) setStatus(previous); // shared helper reports failure so we can revert
      setSaving(false);
    },
    [saving, status, target, playerId, teamId],
  );

  if (status === null) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={theme.textSecondary} />
      </View>
    );
  }

  const blocked = gate.blocked;
  const isIn = status === 'confirmed';
  const isOut = status === 'declined';

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Are you playing?</Text>

      <View style={styles.row}>
        <Pressable
          // Gated: owing the team money means you cannot claim a place.
          onPress={blocked || isIn ? undefined : () => answer('confirmed')}
          disabled={blocked || saving}
          style={[
            styles.btn,
            isIn && styles.btnInOn,
            blocked && !isIn && styles.btnDisabled,
          ]}>
          <Ionicons
            name={isIn ? 'checkmark-circle' : 'checkmark-circle-outline'}
            size={16}
            color={isIn ? '#fff' : blocked ? theme.textSecondary : theme.accentInk}
          />
          <Text
            style={[
              styles.btnText,
              isIn && styles.btnTextOn,
              blocked && !isIn && styles.btnTextDisabled,
            ]}>
            Available
          </Text>
        </Pressable>

        <Pressable
          // Never gated — see the note at the top of this file.
          onPress={isOut ? undefined : () => answer('declined')}
          disabled={saving}
          style={[styles.btn, isOut && styles.btnOutOn]}>
          <Ionicons
            name={isOut ? 'close-circle' : 'close-circle-outline'}
            size={16}
            color={isOut ? '#fff' : theme.textSecondary}
          />
          <Text style={[styles.btnText, isOut && styles.btnTextOn]}>Unavailable</Text>
        </Pressable>
      </View>

      {blocked && !gate.loading && (
        // owedSummary is shared so the fixture card and the poll can never
        // describe the same debt differently.
        <Text style={styles.blockedNote}>
          Pay {owedSummary(gate)} before putting yourself forward. You can still mark
          yourself unavailable.
        </Text>
      )}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    wrap: { gap: 8 },
    loading: { paddingVertical: 14, alignItems: 'flex-start' },
    label: {
      color: theme.textSecondary,
      fontFamily: fonts.semibold,
      fontSize: 12,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    row: { flexDirection: 'row', gap: 9 },
    btn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderRadius: radius.btn,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      paddingVertical: 12,
    },
    btnInOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    btnOutOn: { backgroundColor: theme.textSecondary, borderColor: theme.textSecondary },
    btnDisabled: { backgroundColor: theme.surface2, opacity: 0.6 },
    btnText: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14 },
    btnTextOn: { color: '#fff' },
    btnTextDisabled: { color: theme.textSecondary },
    blockedNote: {
      color: theme.textSecondary,
      fontFamily: fonts.regular,
      fontSize: 12,
      lineHeight: 18,
    },
  });
