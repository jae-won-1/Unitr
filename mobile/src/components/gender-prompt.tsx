// Asks, once, a player who has never told us their gender — the phone's
// components/GenderPrompt.tsx. Players registered before the question existed
// have none on file, and it now decides which games and teams they see by
// default (lib/viewer-gender.ts). Mounted inside the root Gate.
//
// "Prefer not to say" is a full answer, not a skip: it is saved and the sheet
// never comes back. There is no "later" — it would return on every launch.
// Saving through saveOwnGender tells every open feed, so they move onto the
// answer without the reload the web does.

import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSegments } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/contexts/RoleContext';
import { GENDERS } from '@/lib/profile-options';
import { loadViewerGender, saveOwnGender } from '@/lib/viewer-gender';
import { fonts, radius } from '~/theme';
import { useTheme } from '~/use-theme';

// Sign-up screens ask the question themselves.
const SKIP = new Set(['sign-in', 'register', 'welcome', 'venue', 'spike']);

export function GenderPrompt() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { user } = useAuth();
  const { role, roleLoading, profileMissing } = useRole();
  const top = useSegments()[0] as string | undefined;
  const [ask, setAsk] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const eligible =
    !!user && !roleLoading && !profileMissing && role !== 'venue_manager' && role !== 'admin' && !SKIP.has(top ?? '');

  useEffect(() => {
    if (!eligible || !user) {
      setAsk(false);
      return;
    }
    let cancelled = false;
    void loadViewerGender(user.id).then((v) => !cancelled && setAsk(v.unanswered));
    return () => {
      cancelled = true;
    };
  }, [eligible, user]);

  if (!user) return null;

  const answer = async (value: string) => {
    setSaving(value);
    setError(null);
    const err = await saveOwnGender(user.id, value);
    setSaving(null);
    if (err) {
      setError("Couldn't save that. Please try again.");
      return;
    }
    setAsk(false);
  };

  return (
    <Modal visible={ask} transparent animationType="slide" onRequestClose={() => {}}>
      <View style={styles.scrim}>
        <View style={styles.sheet}>
          <Text style={styles.title}>One quick question</Text>
          <Text style={styles.body}>
            Uniter now has men&apos;s and women&apos;s games. Your answer decides which games, teams and players you see
            first — you can always switch to see everyone, and change your answer in Edit Profile.
          </Text>
          {GENDERS.map((g) => (
            <Pressable
              key={g.value}
              disabled={saving !== null}
              onPress={() => void answer(g.value)}
              style={({ pressed }) => [styles.option, (pressed || saving !== null) && { opacity: 0.7 }]}>
              {saving === g.value ? (
                <ActivityIndicator color={theme.accent} />
              ) : (
                <Text style={styles.optionText}>{g.label}</Text>
              )}
            </Pressable>
          ))}
          {!!error && <Text style={styles.error}>{error}</Text>}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    scrim: { flex: 1, backgroundColor: theme.scrim, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 20,
      paddingBottom: 40,
      gap: 10,
    },
    title: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 18 },
    body: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, marginBottom: 6 },
    option: {
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface2,
      borderRadius: radius.btn,
      paddingVertical: 13,
      alignItems: 'center',
    },
    optionText: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14 },
    error: { color: theme.danger, fontFamily: fonts.regular, fontSize: 12 },
  });
