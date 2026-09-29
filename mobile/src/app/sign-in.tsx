// Sign in.
//
// Creating an account is its own screen (register.tsx), because it asks
// everything the web's /register asks — the old two-field sign-up here made
// accounts with no profile at all.

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

import { supabase } from '@/lib/supabase';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';

export default function SignIn() {
  const theme = useTheme();
  const styles = makeStyles(theme);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setNotice(null);

    const mail = email.trim();
    if (!mail || !password) {
      setError('Enter your email and password.');
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: mail, password });
      if (error) throw error;
      // The root gate re-reads the session and routes by role from here.
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.page}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>Uniter</Text>
        <Text style={styles.tagline}>Find a team. Fill a game. Book a pitch.</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="you@example.com"
            placeholderTextColor={theme.textSecondary}
            editable={!busy}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            placeholder="Your password"
            placeholderTextColor={theme.textSecondary}
            editable={!busy}
            onSubmitEditing={submit}
            returnKeyType="go"
          />

          {error && <Text style={styles.error}>{error}</Text>}
          {notice && <Text style={styles.notice}>{notice}</Text>}

          <Pressable
            style={({ pressed }) => [styles.button, (busy || pressed) && styles.buttonPressed]}
            onPress={submit}
            disabled={busy}>
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </Pressable>
        </View>

        <Pressable onPress={() => router.push('/register')} disabled={busy}>
          <Text style={styles.toggle}>New here? Create an account</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.background },
    content: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 6 },
    brand: {
      color: theme.accent,
      fontFamily: fonts.extrabold,
      fontSize: 34,
      textAlign: 'center',
    },
    tagline: {
      color: theme.textSecondary,
      fontFamily: fonts.regular,
      fontSize: 13,
      textAlign: 'center',
      marginBottom: 26,
    },
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      padding: 18,
      ...cardShadow,
    },
    label: {
      color: theme.textSecondary,
      fontFamily: fonts.medium,
      fontSize: 12,
      marginBottom: 6,
      marginTop: 10,
    },
    input: {
      backgroundColor: theme.panel,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.btn,
      paddingHorizontal: 13,
      paddingVertical: 12,
      color: theme.textPrimary,
      fontFamily: fonts.regular,
      fontSize: 15,
    },
    error: { color: theme.danger, fontFamily: fonts.regular, fontSize: 13, marginTop: 14, lineHeight: 18 },
    notice: { color: theme.accentInk, fontFamily: fonts.regular, fontSize: 13, marginTop: 14, lineHeight: 18 },
    button: {
      backgroundColor: theme.accent,
      borderRadius: radius.btn,
      paddingVertical: 15,
      alignItems: 'center',
      marginTop: 20,
    },
    buttonPressed: { opacity: 0.8 },
    buttonText: { color: '#fff', fontFamily: fonts.semibold, fontSize: 15 },
    toggle: {
      color: theme.textSecondary,
      fontFamily: fonts.medium,
      fontSize: 13,
      textAlign: 'center',
      marginTop: 22,
    },
  });
