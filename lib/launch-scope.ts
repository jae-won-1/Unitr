// What this build of Uniter does. docs/LAUNCH_PLAN.md is the decision: the
// first App Store / Play Store release (v1) is a team app for entering
// Uniter-hosted events, and everything that moves money anywhere else is
// switched off — kept in the code, refused by the server, left out of both apps.
//
// This is the only switch. Every API route for a switched-off feature asks
// here first and refuses with OFF_REASON; the web and the phone ask here to
// leave the entry points out. Bringing the full app back is changing
// LAUNCH_SCOPE to "full".
//
// Hidden, not greyed, while a feature is off — a deliberate exception to the
// house convention, because the stores reject apps that show unfinished or
// "coming soon" features. Pure (no React, no Supabase), so server routes and
// both apps share it.

export type LaunchScope = "v1" | "full";

// `as`, so the comparison below stays a real one when this reads "v1".
export const LAUNCH_SCOPE = "v1" as LaunchScope;

const full = LAUNCH_SCOPE === "full";

export type Feature =
  /** Booking a pitch outright — /book, /api/book/pitch, /api/book/post. */
  | "pitchBooking"
  /** Teams posting friendlies and accepting them (secured posts included) —
   *  /play/create, /play/edit, /api/challenges/accept. */
  | "friendlies"
  /** Paid fill-in spots in a friendly — /api/ringer/*. */
  | "ringers"
  /** Events a team or a venue hosts, as opposed to Uniter's own —
   *  /play/create-tournament, and entering one through /api/tournaments/join. */
  | "teamAndVenueEvents"
  /** The venue portal, pitch registration and Connect payouts — /venue/*,
   *  /pitches/register, /api/connect/create-venue-account, account-status. */
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

/** The plain sentence a route refuses with, or a screen shows when someone
 *  reaches a switched-off page by its URL. */
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
