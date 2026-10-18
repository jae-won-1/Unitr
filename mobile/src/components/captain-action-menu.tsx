// The + at the head of My Team's icon row — the phone's copy of the web's
// components/my-team/CaptainActionMenu.tsx. Tapping it fans the things a
// captain creates out in an arc (training, announcement, task, invite link)
// over a dimmed screen.
//
// Deliberately no new native modules: the app ships over-the-air updates to
// builds already installed, and an update that imports a module the build
// doesn't contain crashes on launch. So the clipboard is React Native's own
// (deprecated but still in core) and the backdrop dims rather than blurs on a
// phone — on web, where CSS can, it blurs too.
//
// Players see the slot greyed, per the house convention.

import { useRef, useState } from 'react';
import { Animated, Clipboard, Easing, Modal, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';

import { supabase } from '@/lib/supabase';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';

const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://unitr-omega.vercel.app';

type ActionKey = 'training' | 'announcement' | 'task' | 'invite';
type Action = { key: ActionKey; label: string; icon: keyof typeof Ionicons.glyphMap; live: boolean };

// Training and Task aren't built yet, so they render greyed with "soon".
const ACTIONS: Action[] = [
  { key: 'training', label: 'Training', icon: 'barbell-outline', live: false },
  { key: 'announcement', label: 'Announcement', icon: 'megaphone-outline', live: true },
  { key: 'task', label: 'Task', icon: 'checkbox-outline', live: false },
  { key: 'invite', label: 'Invite link', icon: 'link-outline', live: true },
];

// Right (0°) round to straight down (90°): the + sits at the row's left edge.
const RADIUS = 118;
const angleFor = (i: number) => (Math.PI / 2) * (i / (ACTIONS.length - 1));

export function CaptainActionMenu({
  teamId,
  teamName,
  isCaptain,
}: {
  teamId: string;
  teamName: string;
  isCaptain: boolean;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const anchor = useRef<View>(null);
  const progress = useRef(new Animated.Value(0)).current;
  const inviteCode = useRef<string | null>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const animate = (to: 0 | 1, done?: () => void) =>
    Animated.timing(progress, {
      toValue: to,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start(done);

  const open = () => {
    anchor.current?.measureInWindow((x, y, w, h) => {
      setOrigin({ x: x + w / 2, y: y + h / 2 });
      animate(1);
    });
    // Fetched on open so the tap on Invite has the link ready. Idempotent:
    // returns the team's existing code, so a shared link keeps working.
    if (!inviteCode.current) {
      void supabase.rpc('ensure_team_invite_code', { p_team_id: teamId }).then(({ data }) => {
        if (data) inviteCode.current = data as string;
      });
    }
  };

  const close = () =>
    animate(0, () => {
      setOrigin(null);
      setToast(null);
    });

  const copyInvite = async () => {
    const code = inviteCode.current;
    if (!code) {
      // Lookup still running, or the invite migration isn't there — Team
      // Settings shows the link or says why it can't.
      close();
      router.push('/team-settings');
      return;
    }
    const url = `${WEB_URL}/join/${code}`;
    try {
      Clipboard.setString(url);
      setToast('Invite link copied');
      animate(0);
      setTimeout(() => {
        setOrigin(null);
        setToast(null);
      }, 1400);
    } catch {
      // No clipboard on this platform — the share sheet has a Copy of its own.
      close();
      void Share.share({ message: `Join ${teamName || 'my team'} on Uniter: ${url}`, url }).catch(() => {});
    }
  };

  const select = (a: Action) => {
    if (a.key === 'invite') return void copyInvite();
    if (a.key === 'announcement') {
      close();
      router.push('/announcement');
    }
  };

  const rotate = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] });

  return (
    <>
      <Pressable onPress={open} disabled={!isCaptain} style={[styles.slot, !isCaptain && { opacity: 0.4 }]}>
        <View ref={anchor} collapsable={false} style={styles.plus}>
          <Ionicons name="add" size={28} color={theme.accentInk} />
        </View>
        <Text style={styles.slotLabel}>Create</Text>
      </Pressable>

      <Modal visible={!!origin} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress }]}>
          <Pressable onPress={close} style={[StyleSheet.absoluteFill, styles.backdrop]} accessibilityLabel="Close menu" />
        </Animated.View>

        {origin &&
          ACTIONS.map((a, i) => {
            const angle = angleFor(i);
            const tx = progress.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(angle) * RADIUS] });
            const ty = progress.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(angle) * RADIUS] });
            const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });
            return (
              <Animated.View
                key={a.key}
                style={[
                  styles.item,
                  { left: origin.x - 24, top: origin.y - 24, opacity: progress, transform: [{ translateX: tx }, { translateY: ty }, { scale }] },
                ]}>
                <Pressable onPress={() => select(a)} disabled={!a.live} style={{ alignItems: 'center' }}>
                  <View style={[styles.itemCircle, a.live ? styles.itemLive : styles.itemSoon]}>
                    <Ionicons name={a.icon} size={22} color={a.live ? '#fff' : theme.textSecondary} />
                  </View>
                  <View style={styles.labelWrap}>
                    <Text style={[styles.itemLabel, !a.live && { color: theme.textSecondary }]} numberOfLines={1}>
                      {a.label}
                      {a.live ? '' : ' · soon'}
                    </Text>
                  </View>
                </Pressable>
              </Animated.View>
            );
          })}

        {/* The + redrawn above the dim, turned into a close. */}
        {origin && !toast && (
          <Pressable
            onPress={close}
            accessibilityLabel="Close menu"
            style={[styles.plusOpen, { left: origin.x - 28, top: origin.y - 28 }]}>
            <Animated.View style={{ transform: [{ rotate }] }}>
              <Ionicons name="add" size={28} color="#fff" />
            </Animated.View>
          </Pressable>
        )}

        {toast && (
          <View style={styles.toastWrap} pointerEvents="none">
            <Text style={styles.toast}>{toast}</Text>
          </View>
        )}
      </Modal>
    </>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    slot: { width: 76, alignItems: 'center', gap: 8 },
    slotLabel: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 11, textAlign: 'center' },
    plus: {
      width: 56,
      height: 56,
      borderRadius: 28,
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: theme.accent,
      backgroundColor: theme.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    backdrop: {
      backgroundColor: 'rgba(0,0,0,0.22)',
      // CSS-only; ignored on iOS/Android, where the dim does the work.
      ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(4px)' } as object) : null),
    },
    plusOpen: {
      position: 'absolute',
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: theme.accent,
      alignItems: 'center',
      justifyContent: 'center',
      ...cardShadow,
    },
    item: { position: 'absolute', width: 48, alignItems: 'center', overflow: 'visible' },
    itemCircle: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', ...cardShadow },
    itemLive: { backgroundColor: theme.accent },
    itemSoon: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
    // Centred under a 48-wide circle: (48 - 160) / 2 = -56.
    labelWrap: { position: 'absolute', top: 52, left: -56, width: 160, alignItems: 'center' },
    itemLabel: {
      color: theme.textPrimary,
      backgroundColor: theme.surface,
      fontFamily: fonts.bold,
      fontSize: 11,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radius.pill,
      overflow: 'hidden',
    },
    toastWrap: { position: 'absolute', left: 0, right: 0, bottom: 110, alignItems: 'center' },
    toast: {
      backgroundColor: theme.textPrimary,
      color: theme.background,
      fontFamily: fonts.bold,
      fontSize: 13,
      paddingHorizontal: 16,
      paddingVertical: 9,
      borderRadius: radius.pill,
      overflow: 'hidden',
    },
  });
