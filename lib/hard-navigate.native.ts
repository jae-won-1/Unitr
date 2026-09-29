// The React Native half of lib/hard-navigate.ts — see that file for why this
// split exists. Metro prefers this variant on a phone; Next's bundler does not
// know the convention and keeps the plain .ts.
//
// There is no document to reload here, so the "hard" part cannot be literal.
// `replace` is the closest equivalent that matters: it swaps the current screen
// rather than pushing onto the stack, so the signed-out user cannot press Back
// into the screen they just left — which on a phone is the realistic way
// someone returns to a view they are no longer entitled to.
//
// React state is NOT dropped the way a document load drops it. That is fine
// for the one caller: AuthContext clears the session before navigating, and
// every consumer of user-scoped state derives it from that session, so the
// providers re-resolve to their signed-out values on the same tick.

import { router } from "expo-router";

export function hardNavigate(to: string): void {
  router.replace(to as Parameters<typeof router.replace>[0]);
}
