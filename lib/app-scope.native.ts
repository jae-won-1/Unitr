// The phone's launch scope — the store build is v1 (docs/LAUNCH_PLAN.md).
// The web reads app-scope.ts, which stays "full".

export type LaunchScope = "v1" | "full";

export const APP_SCOPE = "v1" as LaunchScope;
