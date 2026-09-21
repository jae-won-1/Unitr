// Resolves the color set from theme.ts against the device's OS appearance.
// The web app has no dark mode to key off, so this is additive rather than a
// port of anything — see the note in theme.ts.
import { useColorScheme } from 'react-native';
import { colors } from '~/theme';

export function useTheme() {
  const scheme = useColorScheme();
  return colors[scheme === 'dark' ? 'dark' : 'light'];
}
