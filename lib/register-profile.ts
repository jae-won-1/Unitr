"use client";

// ── Writing the profile row a new account needs ─────────────────────────
// Two doors lead here: app/register (email and password, asked everything at
// once) and app/welcome (Google, asked the same questions after the fact).
// Both write the same row, so the shape of a profile doesn't depend on which
// button somebody pressed. The option lists behind these answers are in
// lib/profile-options.ts for the same reason.

import { supabase } from "@/lib/supabase";

export type AccountType = "player" | "venue_manager";

/** Pilot testing is London-only, so the location question is not worth asking
 *  yet — every answer would be the same. Profiles still carry a location (the
 *  Transfer Market, search and squad lists all render it), so we write this
 *  rather than leaving the column null and those cards blank. */
const PILOT_LOCATION = "London";

export type PlayerDetails = {
  position: string;
  experience: string;
  gamesPerMonth: string;
  footballType: string;
  ageGroup: string;
  gender: string;
};

export const EMPTY_PLAYER_DETAILS: PlayerDetails = {
  position: "",
  experience: "",
  gamesPerMonth: "",
  footballType: "",
  ageGroup: "",
  gender: "",
};

/** True while any of the six player questions is unanswered. Sign-up asks for
 *  all of them: a blank position or experience leaves a player invisible to the
 *  Transfer Market's filters, which is worse than one more tap now. */
export function playerDetailsIncomplete(details: PlayerDetails): boolean {
  return (
    !details.position || !details.experience || !details.gamesPerMonth ||
    !details.footballType || !details.ageGroup || !details.gender
  );
}

/**
 * Insert the profile for a freshly created account. Returns the error message
 * to show, or null.
 *
 * Sign-up stores one position in the scalar column; `profiles.positions` is
 * left to the Edit Profile sheet, which is where a player lists the rest. One
 * question is enough to get somebody through a registration form, and naming a
 * column a migration may not have added yet would fail the whole insert.
 */
export async function insertNewProfile(
  userId: string,
  accountType: AccountType,
  fullName: string,
  details: PlayerDetails,
): Promise<string | null> {
  const row =
    accountType === "venue_manager"
      ? { id: userId, full_name: fullName, account_type: "venue_manager" }
      : {
          id: userId,
          full_name: fullName,
          location: PILOT_LOCATION,
          position: details.position,
          experience: details.experience,
          games_per_month: details.gamesPerMonth,
          preferred_football_type: details.footballType,
          age_group: details.ageGroup,
          gender: details.gender,
          account_type: "player",
        };

  const { error } = await supabase.from("profiles").insert(row);
  return error?.message ?? null;
}

/** Where an account lands once its profile exists. A venue account can't join
 *  a squad, so the portal outranks an invite — /join says so rather than
 *  silently dropping them somewhere they don't belong. */
export function homeForAccount(accountType: AccountType, invited: string | null): string {
  return accountType === "venue_manager" ? "/venue/calendar" : invited ?? "/";
}
