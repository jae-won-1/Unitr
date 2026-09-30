// Home's quick-action row — the mobile port of components/QuickNav.tsx. Four
// fixed slots, the same for every role and in the same order, so the row is
// muscle memory. A slot the viewer can't use yet is greyed, never removed
// (the house convention): a missing icon shifts everything beside it.
//
// Two slots are greyed for a reason the web doesn't have — the screen isn't on
// the phone yet (posting a match, booking a pitch). Tapping a greyed slot says
// why rather than doing nothing.

import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { fonts } from '~/theme';
import { useTheme } from '~/use-theme';

type Item = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  href?: Href;
  /** Set when greyed: said aloud when the slot is tapped. */
  reason?: string;
};

export function QuickNav({ role }: { role: string }) {
  const theme = useTheme();
  const styles = makeStyles(theme);

  const items: Item[] = [
    {
      label: 'Post a Match',
      icon: 'football-outline',
      reason:
        role === 'new_user'
          ? 'Join or register a team first.'
          : role !== 'captain'
            ? 'Only your captain can post a match.'
            : 'Posting a match is on the web app for now.',
    },
    { label: 'Book a Pitch', icon: 'tablet-landscape-outline', reason: 'Booking a pitch is on the web app for now.' },
    { label: 'Transfer Market', icon: 'swap-horizontal', href: '/transfer' },
    { label: 'Stats', icon: 'stats-chart', href: '/profile' },
  ];

  return (
    <View style={styles.row}>
      {items.map((item) => {
        const disabled = !item.href;
        return (
          <Pressable
            key={item.label}
            onPress={() => (item.href ? router.push(item.href) : Alert.alert(item.label, item.reason))}
            style={[styles.item, disabled && styles.disabled]}>
            <View style={[styles.circle, disabled && styles.circleOff]}>
              <Ionicons name={item.icon} size={24} color={disabled ? theme.textSecondary : '#fff'} />
            </View>
            <Text style={[styles.label, disabled && { color: theme.textSecondary }]} numberOfLines={2}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 18 },
    item: { flex: 1, alignItems: 'center', gap: 8 },
    disabled: { opacity: 0.5 },
    circle: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: theme.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    circleOff: { backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border },
    label: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 11, textAlign: 'center', lineHeight: 14 },
  });
