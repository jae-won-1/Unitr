// A squad member at a glance, with Message — the phone's stand-in for the
// web's squad → player profile (app/my-team/players). Its main job is the one
// the web inbox doesn't have a button for either: starting a conversation.
// Opening a thread with someone you've never messaged just shows an empty
// thread; the first message sent creates it.
//
// Profile fields through the shared loadProfileFields / option labels, so a
// player reads the same here as on their own Profile.

import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import {
  AGE_GROUPS,
  FOOTBALL_TYPES,
  PLAY_FREQUENCIES,
  loadProfileFields,
  optionLabel,
  playerPositions,
} from '@/lib/profile-options';
import { fonts, radius } from '~/theme';
import { useTheme } from '~/use-theme';
import { initialsOf } from '~/components/chat';

type Profile = {
  full_name: string;
  position: string | null;
  positions?: string[] | null;
  location: string | null;
  experience: string | null;
  games_per_month: string | null;
  preferred_football_type: string | null;
  age_group: string | null;
};

export function PlayerSheet({
  playerId,
  role,
  viewerId,
  onClose,
}: {
  playerId: string | null;
  /** "Captain" / "Co-captain" badge, when they are one. */
  role?: string | null;
  viewerId: string | undefined;
  onClose: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);

  useEffect(() => {
    if (!playerId) return;
    setProfile(undefined);
    void loadProfileFields<Profile>(playerId).then((p) => setProfile(p ?? null));
  }, [playerId]);

  const name = profile?.full_name || 'Player';
  const positions = playerPositions(profile ?? null);
  const facts = [
    ['Experience', profile?.experience ?? null],
    ['Age group', optionLabel(AGE_GROUPS, profile?.age_group)],
    ['Plays', optionLabel(PLAY_FREQUENCIES, profile?.games_per_month)],
    ['Looking for', optionLabel(FOOTBALL_TYPES, profile?.preferred_football_type)],
  ].filter(([, v]) => !!v) as [string, string][];
  const isSelf = playerId === viewerId;

  return (
    <Modal visible={!!playerId} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          {profile === undefined ? (
            <ActivityIndicator color={theme.accent} style={{ marginVertical: 30 }} />
          ) : (
            <>
              <View style={styles.hero}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initialsOf(name) || '?'}</Text>
                </View>
                <Text style={styles.name}>{name}</Text>
                {!!role && (
                  <View style={styles.rolePill}>
                    <Text style={styles.roleText}>{role}</Text>
                  </View>
                )}
                {positions.length > 0 && (
                  <View style={styles.chips}>
                    {positions.map((p) => (
                      <View key={p} style={styles.chip}>
                        <Text style={styles.chipText}>{p}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
              {facts.length > 0 && (
                <View style={styles.facts}>
                  {facts.map(([label, value], i) => (
                    <View key={label} style={[styles.fact, i > 0 && styles.divider]}>
                      <Text style={styles.factLabel}>{label}</Text>
                      <Text style={styles.factValue}>{value}</Text>
                    </View>
                  ))}
                </View>
              )}
              {!isSelf && playerId && (
                <Pressable
                  onPress={() => {
                    onClose();
                    router.push({ pathname: '/messages/[otherId]', params: { otherId: playerId } });
                  }}
                  style={styles.primary}>
                  <Ionicons name="chatbubble-ellipses-outline" size={18} color="#fff" />
                  <Text style={styles.primaryText}>Message {name.split(' ')[0]}</Text>
                </Pressable>
              )}
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    scrim: { flex: 1, backgroundColor: theme.scrim, justifyContent: 'flex-end' },
    sheet: { backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 34, gap: 14 },
    handle: { alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: theme.border },
    hero: { alignItems: 'center', gap: 6 },
    avatar: {
      width: 68,
      height: 68,
      borderRadius: 34,
      borderWidth: 2,
      borderColor: theme.accent,
      backgroundColor: theme.successBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: theme.accentInk, fontFamily: fonts.extrabold, fontSize: 22 },
    name: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 19 },
    rolePill: { backgroundColor: theme.accent, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
    roleText: { color: '#fff', fontFamily: fonts.semibold, fontSize: 11 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
    chip: { backgroundColor: theme.successBg, borderColor: theme.successBorder, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
    chipText: { color: theme.accentInk, fontFamily: fonts.medium, fontSize: 12 },
    facts: { borderWidth: 1, borderColor: theme.border, borderRadius: radius.btn, paddingHorizontal: 12 },
    fact: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 10 },
    divider: { borderTopWidth: 1, borderTopColor: theme.border },
    factLabel: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
    factValue: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 13, flexShrink: 1, textAlign: 'right' },
    primary: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: theme.accent,
      borderRadius: radius.btn,
      paddingVertical: 14,
    },
    primaryText: { color: '#fff', fontFamily: fonts.bold, fontSize: 15 },
  });
