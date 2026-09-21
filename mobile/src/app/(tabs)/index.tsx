// Home.
//
// Phase 2 replaces this with the real role-specific dashboard (quick-nav row,
// status strips, GameFeed). For now it reports what the shared providers
// actually resolved, which is the end-to-end proof that matters at this stage:
// a real session, read from the real Supabase project, with the role decided by
// the web app's own RoleContext rather than a mobile reimplementation of it.

import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/contexts/RoleContext';
import { theme } from '~/theme';

const ROLE_BLURB: Record<string, string> = {
  new_user: 'No team yet — Home will show teams to join and the Fill In feed.',
  player: 'Home will show what your captain needs from you, your next fixture, and the feed.',
  captain: 'Home will add join requests, squad suggestions, team credit and poll status.',
  admin: 'Uniter staff. Admin surfaces stay on the web app for this release.',
  venue_manager: 'Venue accounts are redirected before reaching the tabs.',
};

export default function Home() {
  const { user, signOut } = useAuth();
  const { role, roleLoading, isCoCaptain } = useRole();

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.hello}>Signed in</Text>
      <Text style={styles.email}>{user?.email ?? '—'}</Text>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Resolved role</Text>
        <Text style={styles.role}>
          {roleLoading ? 'resolving…' : role}
          {isCoCaptain && <Text style={styles.co}>  (co-captain)</Text>}
        </Text>
        <Text style={styles.blurb}>{ROLE_BLURB[role] ?? ''}</Text>
      </View>

      <Text style={styles.note}>
        This role came from the web app&apos;s own RoleContext, imported unchanged. The mobile
        app has no second copy of that logic to drift from.
      </Text>

      <Pressable
        style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.7 }]}
        onPress={() => signOut('/')}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 22, paddingTop: 64, gap: 6 },
  hello: { color: theme.textDim, fontSize: 13 },
  email: { color: theme.text, fontSize: 21, fontWeight: '700', marginBottom: 20 },
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 13,
    padding: 17,
    gap: 7,
  },
  cardLabel: { color: theme.textFaint, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 },
  role: { color: theme.greenBright, fontSize: 22, fontWeight: '800' },
  co: { color: theme.textDim, fontSize: 13, fontWeight: '600' },
  blurb: { color: theme.textDim, fontSize: 13, lineHeight: 20 },
  note: { color: theme.textFaint, fontSize: 12, lineHeight: 18, marginTop: 18 },
  signOut: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 9,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 26,
  },
  signOutText: { color: theme.danger, fontSize: 14, fontWeight: '600' },
});
