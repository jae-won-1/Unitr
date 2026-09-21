// A screen that exists in the navigation but has not been ported yet.
//
// Deliberately states which phase builds it and what it will contain, so the
// shell can be walked end-to-end on a device without any screen pretending to
// be finished or looking broken.

import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { theme } from '~/theme';

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
  return (
    <View style={styles.wrap}>
      <Ionicons name={icon} size={38} color={theme.textFaint} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{children}</Text>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{phase}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 34,
    gap: 12,
    backgroundColor: theme.bg,
  },
  title: { color: theme.text, fontSize: 19, fontWeight: '700' },
  body: { color: theme.textDim, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  badge: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginTop: 6,
  },
  badgeText: { color: theme.textFaint, fontSize: 11, fontWeight: '600' },
});
