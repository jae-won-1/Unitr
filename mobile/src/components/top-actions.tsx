// The top-right corner of every tab: the mobile stand-in for the web TopBar's
// message icon and avatar menu (components/TopBar.tsx). The dot on Messages is
// any unread one-to-one message plus the team chat's own unread count, which
// is already 0 when the chat is muted or left (loadChatSummary) — so muting
// silences the dot here exactly as it does on the web. Profile is a stack screen reached from
// here rather than a fourth tab, so the two clients keep the same three-tab
// shape. Absolutely positioned inside each screen's own header area, so it
// adds no height and moves nothing the screens already lay out.

import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, type Href } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { countUnreadDirect } from '@/lib/direct-messages';
import { loadChatSummary } from '@/lib/team-chat';
import { loadLeadership } from '@/lib/team-leadership';
import { fonts } from '~/theme';
import { useTheme } from '~/use-theme';

export function TopActions({ top = 56 }: { top?: number }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { user } = useAuth();
  const [initials, setInitials] = useState('');
  const [unread, setUnread] = useState(0);

  // Re-counted whenever the tab comes back into focus — returning from a
  // thread is exactly when the number changes.
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let live = true;
      void (async () => {
        const [direct, led] = await Promise.all([countUnreadDirect(user.id), loadLeadership(user.id)]);
        const chat = await loadChatSummary(led?.teamId, user.id);
        if (live) setUnread(direct + (chat?.unreadCount ?? 0));
      })();
      return () => {
        live = false;
      };
    }, [user]),
  );

  useEffect(() => {
    if (!user) return;
    void supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        const name = ((data as { full_name?: string } | null)?.full_name ?? '').trim();
        setInitials(
          name
            .split(' ')
            .filter(Boolean)
            .map((w) => w[0])
            .join('')
            .slice(0, 2)
            .toUpperCase(),
        );
      });
  }, [user]);

  return (
    <View style={[styles.wrap, { top }]}>
      <Pressable
        // Cast: the generated route types (.expo/types/router.d.ts) list the
        // inbox as "/messages/index" — they're also listing non-route files as
        // "/../…" paths, so the generator is confused. At runtime
        // app/messages/index.tsx is "/messages", as expo-router documents.
        onPress={() => router.push('/messages' as Href)}
        accessibilityLabel={unread > 0 ? `Messages, ${unread} unread` : 'Messages'}
        hitSlop={8}
        style={styles.icon}>
        <Ionicons name="chatbubble-ellipses-outline" size={22} color={theme.textPrimary} />
        {unread > 0 && <View style={styles.dot} />}
      </Pressable>
      <Pressable
        onPress={() => router.push('/profile')}
        accessibilityLabel="Profile"
        hitSlop={8}
        style={styles.avatar}>
        <Text style={styles.avatarText}>{initials || '•'}</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    wrap: { position: 'absolute', right: 20, flexDirection: 'row', alignItems: 'center', gap: 12, zIndex: 5 },
    icon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    dot: {
      position: 'absolute',
      top: 5,
      right: 4,
      width: 9,
      height: 9,
      borderRadius: 5,
      backgroundColor: theme.danger,
      borderWidth: 1.5,
      borderColor: theme.background,
    },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: theme.successBg,
      borderWidth: 1.5,
      borderColor: theme.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: theme.accentInk, fontFamily: fonts.bold, fontSize: 13 },
  });
