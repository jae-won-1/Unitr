// Create an account — the mobile port of app/register/page.tsx.
//
// Asks everything the web form asks, and writes the same profile row through
// the shared insertNewProfile (lib/register-profile.ts). Email confirmation is
// off on this project, so signUp returns a session and the new player lands
// straight in the app; if it were ever switched on, the no-session branch says
// so instead of leaving someone signed out with no explanation.
//
// Not ported: arriving through a team invite link (the web's ?invite= flow).
// Invite links open the website, which handles them.

import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

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

export default function Register() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [details, setDetails] = useState<PlayerDetails>(EMPTY_PLAYER_DETAILS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same checks, in the same order, as the web form.
  const submit = async () => {
    setError(null);
    if (!accountType) return setError('Please choose an account type.');
    if (!fullName.trim() || !email.trim() || !password) return setError('Please fill in all required fields.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('Passwords do not match.');
    if (accountType === 'player' && playerDetailsIncomplete(details)) return setError('Please answer every player question.');

    setBusy(true);
    const { data, error: signUpError } = await supabase.auth.signUp({ email: email.trim(), password });
    if (signUpError) {
      setBusy(false);
      return setError(signUpError.message);
    }
    if (data.user) {
      const profileError = await insertNewProfile(data.user.id, accountType, fullName.trim(), details);
      if (profileError) {
        setBusy(false);
        return setError(profileError);
      }
    }
    setBusy(false);
    if (!data.session) {
      setError('Check your email to confirm your account, then sign in.');
      return;
    }
    // signUp's session reached RoleContext before the profile existed, so it
    // concluded the profile is missing. Refresh so it looks again — see
    // welcome.tsx — then the root gate routes by role from here.
    await supabase.auth.refreshSession();
    router.replace('/');
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
          <Text style={styles.backText}>Sign in</Text>
        </Pressable>
        <Text style={styles.heading}>Create an account</Text>

        <AccountTypeCards value={accountType} onChange={setAccountType} />

        {accountType && (
          <>
            <Field label={accountType === 'venue_manager' ? 'Your name' : 'Full name'} styles={styles}>
              <TextInput value={fullName} onChangeText={setFullName} style={styles.input} autoCapitalize="words" placeholder="e.g. Jamie Dawson" placeholderTextColor={theme.textSecondary} />
            </Field>
            <Field label="Email" styles={styles}>
              <TextInput value={email} onChangeText={setEmail} style={styles.input} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="you@example.com" placeholderTextColor={theme.textSecondary} />
            </Field>
            <Field label="Password" styles={styles}>
              <TextInput value={password} onChangeText={setPassword} style={styles.input} secureTextEntry autoComplete="new-password" placeholder="At least 8 characters" placeholderTextColor={theme.textSecondary} />
            </Field>
            <Field label="Confirm password" styles={styles}>
              <TextInput value={confirm} onChangeText={setConfirm} style={styles.input} secureTextEntry autoComplete="new-password" placeholderTextColor={theme.textSecondary} />
            </Field>

            {accountType === 'player' ? (
              <PlayerDetailsFields value={details} onChange={(patch) => setDetails((d) => ({ ...d, ...patch }))} />
            ) : (
              <VenueNextStepsNote />
            )}

            {!!error && <Text style={styles.error}>{error}</Text>}

            <Pressable onPress={submit} disabled={busy} style={[styles.primary, busy && { opacity: 0.6 }]}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Create account</Text>}
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, children, styles }: { label: string; children: React.ReactNode; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.background },
    content: { padding: 20, paddingTop: 56, paddingBottom: 60, gap: 16 },
    back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
    backText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 15 },
    heading: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 24 },
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
  });
