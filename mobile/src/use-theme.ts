// Resolves the app's colour set.
//
// LIGHT ALWAYS, deliberately. The web app is light-only — tailwind.config.ts
// and app/globals.css define one palette with no dark variant — so following
// the device's dark mode made this app look unlike the thing it is meant to
// mirror, and did so on precisely the phones most likely to be used. Parity
// with the web app beats respecting a system preference the web app itself
// ignores.
//
// colors.dark in theme.ts is kept rather than deleted: it is a worked-out
// palette in the same tokens, ready if the web app ever gains a dark theme.
// Until then nothing reads it, and `expo.userInterfaceStyle` in app.json is
// pinned to "light" so native chrome does not go dark around light screens.
import { colors } from '~/theme';

export function useTheme() {
  return colors.light;
}

// For the few places that need the mode itself rather than a colour — the
// per-kind calendar tints, which come from their own table.
export function useIsDark() {
  return false;
}
