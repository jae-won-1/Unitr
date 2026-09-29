// Register your team — the mobile port of app/my-team/create/page.tsx.
//
// The same single insert into teams, with the caller as captain; the database
// triggers that hang off it (the captain's own joining-fee copy and its bell
// notification) fire unchanged. Like the web, a missing joining-fee column
// degrades to creating the team without one.
//
// The web page reloads the whole document afterwards so the captain role is
// picked up. On a phone that's a session refresh: RoleContext only
// re-resolves when the user object changes, and a refresh hands it a new one.

import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { TEAM_FORMATS, TEAM_LEVELS } from '@/lib/team-options';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';

export default function CreateTeam() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [level, setLevel] = useState('');
  const [format, setFormat] = useState('');
  const [description, setDescription] = useState('');
  const [fee, setFee] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!name.trim() || !location.trim() || !level || !format) return setError('Please fill in all required fields.');
    if (!user) return setError('You must be signed in to create a team.');
    const feePence = fee ? Math.round(parseFloat(fee) * 100) : 0;
    if (!Number.isFinite(feePence) || feePence < 0) return setError('Joining fee must be a positive amount, or empty for none.');

    setBusy(true);
    const base = {
      name: name.trim(),
      location: location.trim(),
      level,
      format,
      description: description.trim(),
      captain_id: user.id,
    };
    let { error: insertError } = await supabase.from('teams').insert({ ...base, joining_fee_pence: feePence });
    if (insertError && /joining_fee_pence/.test(insertError.message)) {
      ({ error: insertError } = await supabase.from('teams').insert(base));
    }
    if (insertError) {
      setBusy(false);
      return setError(insertError.message);
    }
    await supabase.auth.refreshSession();
    setBusy(false);
    router.replace('/my-team');
  };

  const chip = (value: string, on: boolean, onPress: () => void) => (
    <Pressable key={value} onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{value}</Text>
    </Pressable>
  );

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
        <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      <Text style={styles.heading}>Register your team</Text>
      <Text style={styles.sub}>You&apos;ll be its captain. You can change all of this later in Team Settings.</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Team name *</Text>
        <TextInput value={name} onChangeText={setName} style={styles.input} placeholder="e.g. Hackney United" placeholderTextColor={theme.textSecondary} />
        <Text style={styles.label}>Location *</Text>
        <TextInput value={location} onChangeText={setLocation} style={styles.input} placeholder="e.g. Hackney, London" placeholderTextColor={theme.textSecondary} />
        <Text style={styles.label}>Level *</Text>
        <View style={styles.chips}>{TEAM_LEVELS.map((l) => chip(l, level === l, () => setLevel(l)))}</View>
        <Text style={styles.label}>Players per side *</Text>
        <View style={styles.chips}>{TEAM_FORMATS.map((f) => chip(f, format === f, () => setFormat(f)))}</View>
        <Text style={styles.label}>Description</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
          multiline
          placeholder="Optional — who you are, when you play"
          placeholderTextColor={theme.textSecondary}
        />
        <Text style={styles.label}>Joining fee</Text>
        <View style={styles.feeRow}>
          <Text style={styles.pound}>£</Text>
          <TextInput
            value={fee}
            onChangeText={(v) => setFee(v.replace(/[^0-9.]/g, ''))}
            keyboardType="decimal-pad"
            placeholder="0 — no joining fee"
            placeholderTextColor={theme.textSecondary}
            style={styles.feeInput}
          />
        </View>
        <Text style={styles.hint}>
          Paid once by every player, you included, towards your pitch bookings and tournament entries.
        </Text>
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Pressable onPress={submit} disabled={busy} style={[styles.primary, busy && { opacity: 0.6 }]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Create team</Text>}
        </Pressable>
      </View>
    </ScrollView>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.background },
    content: { padding: 20, paddingTop: 56, paddingBottom: 48, gap: 12 },
    back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
    backText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 15 },
    heading: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 24 },
    sub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, marginTop: -6 },
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      padding: 15,
      gap: 8,
      ...cardShadow,
    },
    label: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 13, marginTop: 6 },
    hint: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16 },
    input: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: radius.btn,
      paddingHorizontal: 14,
      paddingVertical: 11,
      color: theme.textPrimary,
      fontFamily: fonts.regular,
      fontSize: 14,
      backgroundColor: theme.background,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1, borderColor: theme.border, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7 },
    chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    chipText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 12 },
    chipTextOn: { color: '#fff' },
    feeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: radius.btn,
      paddingHorizontal: 14,
      backgroundColor: theme.background,
    },
    pound: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 14, marginRight: 6 },
    feeInput: { flex: 1, paddingVertical: 11, color: theme.textPrimary, fontFamily: fonts.regular, fontSize: 14 },
    error: { color: theme.danger, fontFamily: fonts.regular, fontSize: 12 },
    primary: { backgroundColor: theme.accent, borderRadius: radius.btn, paddingVertical: 14, alignItems: 'center', marginTop: 6 },
    primaryText: { color: '#fff', fontFamily: fonts.bold, fontSize: 15 },
  });
