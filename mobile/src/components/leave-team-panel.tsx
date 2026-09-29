// Leave team — the mobile port of components/my-team/LeaveTeamPanel.tsx.
//
// lib/leave-team.ts, lib/availability-gate.ts and lib/hard-navigate (native
// variant) are all shared, unchanged data/logic — only the confirm UI is
// rebuilt in RN. Same behaviour: a captain sees it greyed with the reason
// (they hold the team and can't give it up from a session), everyone else —
// including a co-captain, who has a membership row to give up — gets the red
// button and a second confirmation naming what leaving costs.

import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { fmtFee } from '@/lib/joining-fee';
import { useAvailabilityGate, owedSummary } from '@/lib/availability-gate';
import { leaveTeam } from '@/lib/leave-team';
import { hardNavigate } from '@/lib/hard-navigate';
import { fonts, radius } from '~/theme';
import { useTheme } from '~/use-theme';

export default function LeaveTeamPanel({
  teamId,
  teamName,
  userId,
  isCaptain,
  joiningFeePence,
}: {
  teamId: string;
  teamName: string;
  userId: string;
  isCaptain: boolean;
  joiningFeePence?: number | null;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gate = useAvailabilityGate(isCaptain ? null : teamId, isCaptain ? null : userId);
  const owes = !gate.loading && gate.blocked ? owedSummary(gate) : '';
  const fee = joiningFeePence ?? 0;

  const handleLeave = async () => {
    setBusy(true);
    setError(null);
    const res = await leaveTeam(teamId, userId);
    if ('error' in res) {
      setBusy(false);
      setError(res.error);
      return;
    }
    // Role, team and every cached query on this device belong to a membership
    // that no longer exists — replace the screen rather than push, same
    // reasoning as the web app's hardNavigate.
    hardNavigate('/my-team');
  };

  if (isCaptain) {
    return (
      <View style={styles.section}>
        <View style={[styles.button, styles.buttonDisabled]}>
          <Text style={styles.buttonDisabledText}>Leave team</Text>
        </View>
        <Text style={styles.hint}>You captain {teamName}, so you can&apos;t leave it.</Text>
      </View>
    );
  }

  if (!confirming) {
    return (
      <View style={styles.section}>
        <Pressable
          onPress={() => {
            setConfirming(true);
            setError(null);
          }}
          style={styles.button}>
          <Text style={styles.buttonText}>Leave team</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Leave {teamName}?</Text>
        <Text style={styles.cardBody}>
          You lose your place in the squad and the team chat, and any game you&apos;d said you
          could play is withdrawn. You can ask to join again later.
        </Text>
        {!!owes && <Text style={styles.cardNote}>Leaving doesn&apos;t clear {owes} — you still owe it.</Text>}
        {fee > 0 && (
          <Text style={styles.cardNote}>
            If you rejoin, you&apos;ll be asked for the {fmtFee(fee)} joining fee again.
          </Text>
        )}
        {!!error && <Text style={styles.cardError}>{error}</Text>}
        <View style={styles.row}>
          <Pressable
            onPress={() => {
              setConfirming(false);
              setError(null);
            }}
            disabled={busy}
            style={[styles.rowButton, styles.stayButton, busy && styles.disabled]}>
            <Text style={styles.stayButtonText}>Stay in the team</Text>
          </Pressable>
          <Pressable onPress={handleLeave} disabled={busy} style={[styles.rowButton, styles.leaveButton, busy && styles.disabled]}>
            {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.leaveButtonText}>Yes, leave</Text>}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    section: { marginTop: 32, paddingTop: 20, borderTopWidth: 1, borderTopColor: theme.border },
    button: {
      width: '100%',
      paddingVertical: 12,
      borderRadius: radius.btn,
      borderWidth: 1,
      borderColor: theme.danger,
      alignItems: 'center',
    },
    buttonText: { color: theme.danger, fontFamily: fonts.semibold, fontSize: 14 },
    buttonDisabled: { borderColor: theme.border, opacity: 0.6 },
    buttonDisabledText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 14 },
    hint: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 11, textAlign: 'center', marginTop: 8 },
    card: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.danger,
      borderRadius: radius.card,
      padding: 16,
    },
    cardTitle: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14 },
    cardBody: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 4 },
    cardNote: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 8 },
    cardError: { color: theme.danger, fontFamily: fonts.regular, fontSize: 11, marginTop: 8 },
    row: { flexDirection: 'row', gap: 8, marginTop: 12 },
    rowButton: { flex: 1, paddingVertical: 10, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    stayButton: { borderWidth: 1, borderColor: theme.border },
    stayButtonText: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 12 },
    leaveButton: { backgroundColor: theme.danger },
    leaveButtonText: { color: '#fff', fontFamily: fonts.bold, fontSize: 12 },
    disabled: { opacity: 0.4 },
  });
