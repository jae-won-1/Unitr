// A screen that exists in the navigation but has not been ported yet.
//
// Deliberately states which phase builds it and what it will contain, so the
// shell can be walked end-to-end on a device without any screen pretending to
// be finished or looking broken.

import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { fonts, radius } from '~/theme';
import { useTheme } from '~/use-theme';

export function PhaseStub({
  icon,
  title,
  phase,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  phase: string;
  children: string;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);

  return (
    <View style={styles.wrap}>
      <Ionicons name={icon} size={38} color={theme.textSecondary} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{children}</Text>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{phase}</Text>
      </View>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    wrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 34,
      gap: 12,
      backgroundColor: theme.background,
    },
    title: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 19 },
    body: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, textAlign: 'center' },
    badge: {
      backgroundColor: theme.panel,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingHorizontal: 12,
      paddingVertical: 5,
      marginTop: 6,
    },
    badgeText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 11 },
  });
