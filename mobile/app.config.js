// The Expo app config. JavaScript rather than app.json so the notes below can
// be real comments — "//" keys in JSON fail Expo's schema check, which EAS and
// expo-doctor both run.

/** @type {import('expo/config').ExpoConfig} */
module.exports = {
  name: 'Uniter',
  slug: 'uniter',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'uniter',
  // The EAS project lives under the uniter_uk organisation on expo.dev.
  owner: 'uniter_uk',
  extra: { eas: { projectId: '74a6aa43-efeb-4d45-8ea5-490662730133' } },
  // LIGHT, not automatic. The web app is light-only — it has no dark theme to
  // mirror — so following the device's dark mode made the mobile app diverge
  // from it on exactly the phones most likely to be used. Locking this also
  // stops native chrome (status bar, sheets, keyboard) going dark around light
  // screens. Revisit only if the web app gains a dark theme, at which point
  // src/theme.ts already has the palette.
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'com.uniter.app',
    supportsTablet: false,
    infoPlist: {
      // Only HTTPS and the OS's own crypto — exempt from export compliance, so
      // App Store Connect stops asking on every build.
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'com.uniter.app',
    adaptiveIcon: {
      backgroundColor: '#033240',
      foregroundImage: './assets/images/android-icon-foreground.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        // The icon's own navy, so the splash and the icon read as one image.
        // Every icon here is exported by: node mobile/scripts/generate-icons.mjs
        backgroundColor: '#033240',
        image: './assets/images/splash-icon.png',
        imageWidth: 200,
      },
    ],
    'expo-font',
    [
      '@stripe/stripe-react-native',
      {
        // No merchantIdentifier — Apple Pay isn't offered yet. An object is
        // still required: the plugin destructures props unconditionally and a
        // bare string entry crashes config resolution.
        enableGooglePay: false,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
    // OFF deliberately. Expo otherwise feeds tsconfig paths to Metro as well,
    // which makes the two inseparable — and this app needs one mapping that
    // must apply to TypeScript ONLY: react -> node_modules/@types/react, which
    // redirects the shared repo-root contexts away from the web app's React 18
    // typings. Metro following that mapping resolves react to a types-only
    // package with no runtime and the bundle dies. Module aliases therefore
    // live in metro.config.js and are mirrored by hand in tsconfig.json.
    tsconfigPaths: false,
  },
};
