// The React Native build of stripe-mode.ts. Expo only inlines variables
// prefixed EXPO_PUBLIC_, so the NEXT_PUBLIC_ name is undefined here — same
// value, different prefix (see mobile/.env).
export const STRIPE_TEST_MODE = (process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "").startsWith("pk_test_");
