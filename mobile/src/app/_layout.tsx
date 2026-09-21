import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

SplashScreen.preventAutoHideAsync();
SplashScreen.hideAsync();

// Phase 0 shell. The real navigator — three tabs (Home / Calendar / My Team)
// plus the TopBar surfaces and the venue-manager redirect — arrives in Phase 1
// with role resolution. Keeping this a bare Stack for now so the bridge spike
// is not reading through the template's demo tab chrome.
export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
