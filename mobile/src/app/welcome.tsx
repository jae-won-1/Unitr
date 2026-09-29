// Finish setting up — the mobile port of app/welcome/page.tsx.
//
// For a signed-in account with no profile row: RoleContext reports it as
// profileMissing and the root Gate sends it here from anywhere, the way the
// web's ProfileGate does. It happens to accounts made by the phone's old
// email-and-password-only sign-up, and would to a Google account. Half a
// profile is worse than none — a player with no position is invisible to
// every Transfer Market filter — so the app waits here until it's answered.

import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  EMPTY_PLAYER_DETAILS,
  insertNewProfile,
  playerDetailsIncomplete,
  type AccountType,
  type PlayerDetails,
} from '@/lib/register-profile';
import { fonts, radius } from '~/theme';
import { useTheme } from '~/use-theme';
import { AccountTypeCards, PlayerDetailsFields, VenueNextStepsNote } from '~/components/registration-fields';

export default function Welcome() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { user, signOut } = useAuth();
  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [fullName, setFullName] = useState('');
  const [details, setDetails] = useState<PlayerDetails>(EMPTY_PLAYER_DETAILS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!user) return;
    setError(null);
    if (!accountType) return setError('Please choose an account type.');
    if (!fullName.trim()) return setError('Please enter your name.');
    if (accountType === 'player' && playerDetailsIncomplete(details)) return setError('Please answer every player question.');
    setBusy(true);
    const err = await insertNewProfile(user.id, accountType, fullName.trim(), details);
    setBusy(false);
    if (err) return setError(err);
    // RoleContext only re-resolves when the signed-in user changes, so it
    // would go on thinking the profile is missing. A session refresh hands
    // AuthContext a new user object, which makes it look again.
    await supabase.auth.refreshSession();
    router.replace('/');
  };

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>Finish setting up</Text>
      <Text style={styles.sub}>
        You&apos;re signed in{user?.email ? ` as ${user.email}` : ''}. A few questions before you start.
      </Text>

      <AccountTypeCards value={accountType} onChange={setAccountType} />
      {accountType && (
        <>
          <View style={{ gap: 6 }}>
            <Text style={styles.label}>{accountType === 'venue_manager' ? 'Your name' : 'Full name'}</Text>
            <TextInput value={fullName} onChangeText={setFullName} style={styles.input} autoCapitalize="words" placeholder="e.g. Jamie Dawson" placeholderTextColor={theme.textSecondary} />
          </View>
          {accountType === 'player' ? (
            <PlayerDetailsFields value={details} onChange={(patch) => setDetails((d) => ({ ...d, ...patch }))} />
          ) : (
            <VenueNextStepsNote />
          )}
          {!!error && <Text style={styles.error}>{error}</Text>}
          <Pressable onPress={submit} disabled={busy} style={[styles.primary, busy && { opacity: 0.6 }]}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Finish</Text>}
          </Pressable>
        </>
      )}

      <Pressable onPress={() => void signOut('/sign-in')} style={styles.textBtn}>
        <Text style={styles.textBtnText}>Use a different account</Text>
      </Pressable>
    </ScrollView>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.background },
    content: { padding: 20, paddingTop: 64, paddingBottom: 60, gap: 16 },
    heading: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 24 },
    sub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 14, marginTop: -8 },
    label: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 13 },
    input: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: radius.btn,
      paddingHorizontal: 14,
      paddingVertical: 12,
      color: theme.textPrimary,
      fontFamily: fonts.regular,
      fontSize: 14,
      backgroundColor: theme.surface,
    },
    error: { color: theme.danger, fontFamily: fonts.regular, fontSize: 13 },
    primary: { backgroundColor: theme.accent, borderRadius: radius.btn, paddingVertical: 15, alignItems: 'center' },
    primaryText: { color: '#fff', fontFamily: fonts.bold, fontSize: 15 },
    textBtn: { alignItems: 'center', paddingVertical: 8 },
    textBtnText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 13 },
  });
