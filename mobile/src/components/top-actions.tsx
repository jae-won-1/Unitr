// The top-right corner of every tab: the mobile stand-in for the web TopBar's
// avatar menu (components/TopBar.tsx). Profile is a stack screen reached from
// here rather than a fourth tab, so the two clients keep the same three-tab
// shape. Absolutely positioned inside each screen's own header area, so it
// adds no height and moves nothing the screens already lay out.

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { fonts } from '~/theme';
import { useTheme } from '~/use-theme';

export function TopActions({ top = 56 }: { top?: number }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { user } = useAuth();
  const [initials, setInitials] = useState('');

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
