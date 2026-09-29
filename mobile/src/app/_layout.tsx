import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { StripeProvider } from '@stripe/stripe-react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Linking from 'expo-linking';
import {
  useFonts,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  Poppins_800ExtraBold,
} from '@expo-google-fonts/poppins';

// Both providers are the WEB APP'S OWN FILES, imported unchanged from the repo
// root — not ports. RoleContext needed no adjustment at all (it is pure logic
// over Supabase), and AuthContext needed exactly one line moved behind
// lib/hard-navigate. So role resolution on the phone cannot drift from the
// web's: captain / player / new_user / venue_manager / admin is decided by one
// implementation for both clients.
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { RoleProvider, useRole } from '@/contexts/RoleContext';
import { colors } from '~/theme';

SplashScreen.preventAutoHideAsync();

// Where a 3D Secure challenge or bank redirect sends the payer back to. In a
// development or store build that is app.json's "uniter" scheme, but Expo Go
// can't register a custom scheme — its links are exp://… — so a hardcoded
// "uniter" would strand a payer outside the app after authenticating.
// Stripe's own Expo guidance: in Expo Go, pass the /--/ route of Expo Go's URL.
const stripeUrlScheme =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient
    ? Linking.createURL('/--/')
    : Linking.createURL('');

// Where an opening app lands.
//
// This lives in the layout rather than in an index route because (tabs) already
// owns "/" — a second index.tsx beside it would be two files claiming one path.
// Guarding here also means the redirect is re-evaluated on every navigation, so
// a session that expires mid-session pushes the player out rather than leaving
// them on a screen whose queries have quietly started failing.
function Gate({ children }: { children: React.ReactNode }) {
  const { session, loading: authLoading } = useAuth();
  const { role, roleLoading, profileMissing } = useRole();
  const segments = useSegments();
  const router = useRouter();
  const theme = colors.light;

  // Role only matters once there is someone to have a role.
  const waiting = authLoading || (!!session && roleLoading);

  useEffect(() => {
    if (waiting) return;
    SplashScreen.hideAsync();

    const top = segments[0] as string | undefined;
    const onSignIn = top === 'sign-in';
    // The screens a session may be on before it has a profile — the web's
    // ProfileGate SETUP_ROUTES. Register is mid-way through writing one.
    const onSetup = top === 'sign-in' || top === 'register' || top === 'welcome';
    const onVenue = top === 'venue';
    // The spike is a development screen; leave it reachable without the gate
    // bouncing anyone off it.
    if (top === 'spike') return;

    if (!session) {
      if (!onSignIn && top !== 'register') router.replace('/sign-in');
      return;
    }
    // Signed in with no profile row (the web's ProfileGate): finish setting up
    // before anything else. Half a profile is worse than none.
    if (profileMissing) {
      if (!onSetup) router.replace('/welcome');
      return;
    }
    if (top === 'welcome') {
      router.replace('/');
      return;
    }
    // Venue managers are checked before anything player-shaped, exactly as the
    // web app does — a venue account has no player surfaces at all.
    if (role === 'venue_manager') {
      if (!onVenue) router.replace('/venue');
      return;
    }
    if (onSignIn || onVenue) router.replace('/');
  }, [waiting, session, role, profileMissing, segments, router]);

  if (waiting) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  return <>{children}</>;
}

export default function RootLayout() {
  // Light always — see the note in src/use-theme.ts. The web app has no dark
  // theme, so following the device's would be a divergence, not a courtesy.
  const theme = colors.light;

  // Matches app/layout.tsx's next/font/google Poppins config: weights
  // 400–800. Web fonts and RN fonts load through entirely different
  // mechanisms, so this is the one screen-shell piece that has no shared
  // source to import — everything it loads still names the same typeface and
  // weights, not a substitute.
  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Poppins_800ExtraBold,
  });

  if (!fontsLoaded) return null; // splash screen is still showing

  return (
    // Test-mode publishableKey only — see mobile/.env. urlScheme: see
    // stripeUrlScheme above. No merchantIdentifier: Apple Pay isn't offered
    // yet, and that prop is for nothing else.
    <StripeProvider
      publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''}
      urlScheme={stripeUrlScheme}>
      <AuthProvider>
        <RoleProvider>
          <StatusBar style="dark" />
          <Gate>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: theme.background },
                animation: 'fade',
              }}
            />
          </Gate>
        </RoleProvider>
      </AuthProvider>
    </StripeProvider>
  );
}
