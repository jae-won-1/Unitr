// What this build of Uniter does. docs/LAUNCH_PLAN.md is the decision: the
// first App Store / Play Store release (v1) is a team app for entering
// Uniter-hosted events, and everything that moves money anywhere else is
// switched off in the PHONE app — kept in the code, left out of the screens.
//
// The web app is the full app and stays that way (user, 26 Oct). The scope is
// therefore per platform: lib/app-scope.ts says "full" and Metro picks
// lib/app-scope.native.ts ("v1") for the phone. Server routes run on the web
// side, so they see "full" and refuse nothing — a phone that reaches a route
// by hand gets what the web would. Bringing the phone up to the full app is
// changing app-scope.native.ts.
//
// Hidden, not greyed, while a feature is off — a deliberate exception to the
// house convention, because the stores reject apps that show unfinished or
// "coming soon" features. Pure (no React, no Supabase), so both apps share it.

import { APP_SCOPE } from "@/lib/app-scope";

export type { LaunchScope } from "@/lib/app-scope";

const full = APP_SCOPE === "full";

export type Feature =
  /** Booking a pitch outright — the phone's /book. */
  | "pitchBooking"
  /** Teams posting friendlies and accepting them (secured posts included) —
   *  the phone's /post-match and Challenge. */
  | "friendlies"
  /** Paid fill-in spots in a friendly. */
  | "ringers"
  /** Entering an event a team or a venue hosts, as opposed to Uniter's own. */
  | "teamAndVenueEvents"
  /** Venue accounts — the account-type choice at sign-up. */
  | "venues";

export const FEATURES: Record<Feature, boolean> = {
  pitchBooking: full,
  friendlies: full,
  ringers: full,
  teamAndVenueEvents: full,
  venues: full,
};

export function isOn(feature: Feature): boolean {
  return FEATURES[feature];
}

/** What a screen shows when someone reaches a switched-off one by a link. */
export const OFF_REASON: Record<Feature, string> = {
  pitchBooking: "Booking a pitch isn't available in this version of Uniter.",
  friendlies: "Posting and accepting friendlies isn't available in this version of Uniter.",
  ringers: "Fill-in games aren't available in this version of Uniter.",
  teamAndVenueEvents: "Only Uniter's own events can be entered in this version of Uniter.",
  venues: "Venue accounts aren't available in this version of Uniter.",
};

/** Is this listing one Uniter itself hosts? The only kind v1 can enter. */
export function isUniterEvent(row: { organiser_admin_id?: string | null } | null | undefined): boolean {
  return Boolean(row?.organiser_admin_id);
}

/** May a team enter this listing in this build? */
export function canEnterEvent(row: { organiser_admin_id?: string | null } | null | undefined): boolean {
  return isOn("teamAndVenueEvents") || isUniterEvent(row);
}
