// Sign in / create account.
//
// One screen with a toggle rather than two routes: the two forms differ by a
// single field, and a player who tapped the wrong one should not have to
// navigate to fix it.
//
// Account creation here is deliberately minimal — email and password only. The
// web app's /register also collects name, positions, experience, age group and
// so on, but that questionnaire belongs with the profile screens later in the
// port; a half-ported version asking three of eight questions would write
// worse data than asking none. A new account resolves to `new_user`, which is
// the correct role for someone with no team yet, and the existing profile
// screens fill the rest in.

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
import { theme } from '~/theme';

export default function SignIn() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const creating = mode === 'up';

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
      if (creating) {
        const { data, error } = await supabase.auth.signUp({ email: mail, password });
        if (error) throw error;
        // If the project requires email confirmation, signUp returns a user
        // with no session. Saying so beats a screen that silently does nothing.
        if (!data.session) {
          setNotice('Check your email to confirm your account, then sign in.');
          setMode('in');
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: mail, password });
        if (error) throw error;
      }
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
            placeholderTextColor={theme.textFaint}
            editable={!busy}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete={creating ? 'new-password' : 'current-password'}
            placeholder={creating ? 'At least 6 characters' : 'Your password'}
            placeholderTextColor={theme.textFaint}
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
              <Text style={styles.buttonText}>{creating ? 'Create account' : 'Sign in'}</Text>
            )}
          </Pressable>
        </View>

        <Pressable
          onPress={() => {
            setMode(creating ? 'in' : 'up');
            setError(null);
            setNotice(null);
          }}
          disabled={busy}>
          <Text style={styles.toggle}>
            {creating ? 'Already have an account? Sign in' : "New here? Create an account"}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.bg },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 6 },
  brand: { color: theme.greenBright, fontSize: 34, fontWeight: '800', textAlign: 'center' },
  tagline: {
    color: theme.textDim,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 26,
  },
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 18,
  },
  label: { color: theme.textDim, fontSize: 12, marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: theme.bg,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 13,
    paddingVertical: 12,
    color: theme.text,
    fontSize: 15,
  },
  error: { color: theme.danger, fontSize: 13, marginTop: 14, lineHeight: 18 },
  notice: { color: theme.greenBright, fontSize: 13, marginTop: 14, lineHeight: 18 },
  button: {
    backgroundColor: theme.green,
    borderRadius: 9,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 20,
  },
  buttonPressed: { opacity: 0.75 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  toggle: { color: theme.textDim, fontSize: 13, textAlign: 'center', marginTop: 22 },
});
