import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';

// Both providers are the WEB APP'S OWN FILES, imported unchanged from the repo
// root — not ports. RoleContext needed no adjustment at all (it is pure logic
// over Supabase), and AuthContext needed exactly one line moved behind
// lib/hard-navigate. So role resolution on the phone cannot drift from the
// web's: captain / player / new_user / venue_manager / admin is decided by one
// implementation for both clients.
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { RoleProvider, useRole } from '@/contexts/RoleContext';
import { theme } from '~/theme';

SplashScreen.preventAutoHideAsync();

// Where an opening app lands.
//
// This lives in the layout rather than in an index route because (tabs) already
// owns "/" — a second index.tsx beside it would be two files claiming one path.
// Guarding here also means the redirect is re-evaluated on every navigation, so
// a session that expires mid-session pushes the player out rather than leaving
// them on a screen whose queries have quietly started failing.
function Gate({ children }: { children: React.ReactNode }) {
  const { session, loading: authLoading } = useAuth();
  const { role, roleLoading } = useRole();
  const segments = useSegments();
  const router = useRouter();

  // Role only matters once there is someone to have a role.
  const waiting = authLoading || (!!session && roleLoading);

  useEffect(() => {
    if (waiting) return;
    SplashScreen.hideAsync();

    const top = segments[0] as string | undefined;
    const onSignIn = top === 'sign-in';
    const onVenue = top === 'venue';
    // The spike is a development screen; leave it reachable without the gate
    // bouncing anyone off it.
    if (top === 'spike') return;

    if (!session) {
      if (!onSignIn) router.replace('/sign-in');
      return;
    }
    // Venue managers are checked before anything player-shaped, exactly as the
    // web app does — a venue account has no player surfaces at all.
    if (role === 'venue_manager') {
      if (!onVenue) router.replace('/venue');
      return;
    }
    if (onSignIn || onVenue) router.replace('/');
  }, [waiting, session, role, segments, router]);

  if (waiting) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.greenBright} />
      </View>
    );
  }
  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RoleProvider>
        <StatusBar style="light" />
        <Gate>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.bg },
              animation: 'fade',
            }}
          />
        </Gate>
      </RoleProvider>
    </AuthProvider>
  );
}
