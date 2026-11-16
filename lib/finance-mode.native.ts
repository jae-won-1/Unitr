// The phone's copy of lib/finance-mode.ts — see that file for what the switch
// means. Expo only inlines EXPO_PUBLIC_* variables, so the phone reads its own:
// EXPO_PUBLIC_FINANCE_MODE=linked (mobile/.env for a local run, the `env`
// block of mobile/eas.json for a build or an OTA update).
//
// The two switches must change together. Every /api/finance/* route answers
// 503 while the server's is off, so a phone on "linked" against a server on
// credit would show Team finance and nothing in it.
export const LINKED_FINANCE = process.env.EXPO_PUBLIC_FINANCE_MODE === "linked";
