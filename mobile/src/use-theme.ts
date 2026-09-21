// Resolves the color set from theme.ts against the device's OS appearance.
// The web app has no dark mode to key off, so this is additive rather than a
// port of anything — see the note in theme.ts.
import { useColorScheme } from 'react-native';
import { colors } from '~/theme';

export function useTheme() {
  const scheme = useColorScheme();
  return colors[scheme === 'dark' ? 'dark' : 'light'];
}

// For the few places that need the mode itself rather than a colour — the
// per-kind calendar tints, which come from their own table.
export function useIsDark() {
  return useColorScheme() === 'dark';
}
