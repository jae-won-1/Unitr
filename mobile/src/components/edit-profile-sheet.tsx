// Edit Profile — the mobile port of components/EditProfileSheet.tsx.
//
// Edits every answer registration collects, and saves through the web app's own
// saveProfileFields (lib/profile-options.ts), which also holds the option lists
// — so the two apps can't offer different choices, and the "missing migration"
// fallback (name, primary position and experience still save) behaves the same.

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import {
  AGE_GROUPS,
  EXPERIENCE_LEVELS,
  FOOTBALL_TYPES,
  GENDERS,
  PLAY_FREQUENCIES,
  POSITIONS,
  saveProfileFields,
  type Option,
  type ProfileFields,
} from '@/lib/profile-options';
import { fonts, radius } from '~/theme';
import { useTheme } from '~/use-theme';

export function EditProfileSheet({
  visible,
  userId,
  initial,
  onClose,
  onSaved,
}: {
  visible: boolean;
  userId: string;
  initial: ProfileFields;
  onClose: () => void;
  onSaved: (fields: ProfileFields) => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [fields, setFields] = useState<ProfileFields>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Re-seed from the latest profile each time the sheet opens. Keyed on
  // `visible` only: `initial` is rebuilt on every parent render, and following
  // it would wipe what the player is typing.
  useEffect(() => {
    if (!visible) return;
    setFields(initial);
    setError(null);
    setNote(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const set = <K extends keyof ProfileFields>(key: K, value: ProfileFields[K]) =>
    setFields((f) => ({ ...f, [key]: value }));

  // Positions are a multi-select whose FIRST entry is the primary one — the
  // scalar `position` every card still reads. Order of tapping is kept.
  const togglePosition = (p: string) =>
    set(
      'positions',
      fields.positions.includes(p) ? fields.positions.filter((x) => x !== p) : [...fields.positions, p],
    );

  const save = async () => {
    if (!fields.full_name.trim()) {
      setError('Your name can’t be empty.');
      return;
    }
    if (fields.positions.length === 0) {
      setError('Pick at least one position.');
      return;
    }
    setSaving(true);
    setError(null);
    const clean = { ...fields, full_name: fields.full_name.trim() };
    const res = await saveProfileFields(userId, clean);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onSaved(clean);
    if (!res.extrasSaved) {
      setNote(
        'Saved your name, position and experience. The other answers need a database update that hasn’t been run yet.',
      );
      return;
    }
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={saving ? undefined : onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Edit Profile</Text>
            <Pressable onPress={onClose} disabled={saving} hitSlop={10}>
              <Ionicons name="close" size={22} color={theme.textSecondary} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ gap: 18, paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
            <View>
              <Text style={styles.label}>Name</Text>
              <TextInput
                value={fields.full_name}
                onChangeText={(v) => set('full_name', v)}
                placeholder="Your full name"
                placeholderTextColor={theme.textSecondary}
                style={styles.input}
                autoCapitalize="words"
              />
            </View>

            <View>
              <Text style={styles.label}>Positions</Text>
              <Text style={styles.hint}>Your first pick is shown as your main position.</Text>
              <View style={styles.chips}>
                {POSITIONS.map((p) => {
                  const idx = fields.positions.indexOf(p);
                  const on = idx >= 0;
                  return (
                    <Pressable key={p} onPress={() => togglePosition(p)} style={[styles.chip, on && styles.chipOn]}>
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>
                        {p}
                        {idx === 0 ? ' · main' : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <SingleSelect
              label="Experience"
              options={EXPERIENCE_LEVELS.map((e) => ({ value: e, label: e }))}
              value={fields.experience}
              onChange={(v) => set('experience', v)}
              styles={styles}
            />
            <SingleSelect label="Age group" options={AGE_GROUPS} value={fields.age_group} onChange={(v) => set('age_group', v)} styles={styles} />
            <SingleSelect label="Gender" options={GENDERS} value={fields.gender} onChange={(v) => set('gender', v)} styles={styles} />
            <SingleSelect
              label="How often you play"
              options={PLAY_FREQUENCIES}
              value={fields.games_per_month}
              onChange={(v) => set('games_per_month', v)}
              styles={styles}
            />
            <SingleSelect
              label="Looking for"
              options={FOOTBALL_TYPES}
              value={fields.preferred_football_type}
              onChange={(v) => set('preferred_football_type', v)}
              styles={styles}
            />

            {!!error && <Text style={styles.error}>{error}</Text>}
            {!!note && <Text style={styles.note}>{note}</Text>}

            <Pressable onPress={save} disabled={saving} style={[styles.save, saving && { opacity: 0.6 }]}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save</Text>}
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SingleSelect({
  label,
  options,
  value,
  onChange,
  styles,
}: {
  label: string;
  options: Option[];
  value: string;
  onChange: (v: string) => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            // Tapping the selected answer again clears it — every one of these
            // is optional, and there was otherwise no way back to "unanswered".
            <Pressable key={o.value} onPress={() => onChange(on ? '' : o.value)} style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    scrim: { flex: 1, backgroundColor: theme.scrim, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: 20,
      paddingTop: 10,
      paddingBottom: 30,
      maxHeight: '90%',
    },
    handle: { alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: theme.border, marginBottom: 14 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    title: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 18 },
    label: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 13, marginBottom: 8 },
    hint: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 11, marginTop: -4, marginBottom: 8 },
    input: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: radius.btn,
      paddingHorizontal: 14,
      paddingVertical: 11,
      color: theme.textPrimary,
      fontFamily: fonts.regular,
      fontSize: 14,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: radius.pill,
      paddingHorizontal: 12,
      paddingVertical: 7,
      backgroundColor: theme.surface,
    },
    chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    chipText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 12 },
    chipTextOn: { color: '#fff' },
    error: { color: theme.danger, fontFamily: fonts.regular, fontSize: 12 },
    note: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
    save: { backgroundColor: theme.accent, borderRadius: radius.btn, paddingVertical: 14, alignItems: 'center' },
    saveText: { color: '#fff', fontFamily: fonts.bold, fontSize: 15 },
  });
