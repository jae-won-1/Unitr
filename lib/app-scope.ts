// Which launch scope this platform runs (lib/launch-scope.ts). The web app is
// always the full app; the phone's copy is app-scope.native.ts, which Metro
// picks over this file for the React Native build.

export type LaunchScope = "v1" | "full";

// `as`, so comparisons against "v1" stay real ones.
export const APP_SCOPE = "full" as LaunchScope;
