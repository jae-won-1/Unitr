// Where a venue account lands.
//
// The web app hard-redirects venue managers out of every player route into
// /venue/*. That portal — calendar, bookings, customers, open matches, academy,
// store, reports, settings — is explicitly out of scope for the first store
// release, so rather than drop an operator into a player shell they have no
// business in, the app says where their tools actually are.

import { Pressable, StyleSheet, Text, View, Linking } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAuth } from '@/contexts/AuthContext';
import { fonts, radius } from '~/theme';
import { useTheme } from '~/use-theme';

const PORTAL = 'https://unitr-omega.vercel.app/venue';

export default function Venue() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { signOut } = useAuth();

  return (
    <View style={styles.wrap}>
      <Ionicons name="business-outline" size={40} color={theme.textSecondary} />
      <Text style={styles.title}>Venue account</Text>
      <Text style={styles.body}>
        Bookings, pitches, customers and payouts are on the web app for now. The venue portal
        is not part of this first mobile release.
      </Text>

      <Pressable
        style={({ pressed }) => [styles.button, pressed && { opacity: 0.8 }]}
        onPress={() => Linking.openURL(PORTAL)}>
        <Text style={styles.buttonText}>Open the venue portal</Text>
      </Pressable>

      <Pressable onPress={() => signOut('/')}>
        <Text style={styles.signOut}>Sign out</Text>
      </Pressable>
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
      gap: 13,
      backgroundColor: theme.background,
    },
    title: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 20 },
    body: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, textAlign: 'center' },
    button: {
      backgroundColor: theme.accent,
      borderRadius: radius.btn,
      paddingVertical: 14,
      paddingHorizontal: 26,
      marginTop: 8,
    },
    buttonText: { color: '#fff', fontFamily: fonts.semibold, fontSize: 15 },
    signOut: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 13, marginTop: 14 },
  });
