import { supabase } from "@/lib/supabase";
import { authedPost } from "@/lib/authed-fetch";

// Deleting your own account — required by both app stores, and offered on the
// web too, which is where Google Play's "request deletion" link points.
//
// The work runs in /api/account/delete. This file is the two things a screen
// needs: whether the button is live (a captain must hand the team over
// first — user, 26 Oct 2026), and the call itself.

/** Why this person can't delete their account yet, or null if they can.
 *  The server asks the same question; this only lets the screen say it before
 *  the button is pressed. */
export async function accountDeletionBlock(userId: string): Promise<string | null> {
  const [{ data: team }, { data: profile }] = await Promise.all([
    supabase.from("teams").select("id, name").eq("captain_id", userId).maybeSingle(),
    supabase.from("profiles").select("account_type").eq("id", userId).maybeSingle(),
  ]);
  return deletionBlockReason(profile?.account_type ?? null, team?.name ?? null);
}

/** Shared with the route so the sentence can't drift between the two. */
export function deletionBlockReason(accountType: string | null, captainOf: string | null): string | null {
  if (accountType === "venue_manager" || accountType === "admin") {
    return "This account runs a venue or Uniter events, so it's closed by the Uniter team — contact us to close it.";
  }
  if (captainOf) {
    return `You captain ${captainOf}. Hand the team to a co-captain in Team Settings first — make one there if you haven't yet.`;
  }
  return null;
}

/** Delete the signed-in account. On ok the session is gone; the caller should
 *  send the person to a signed-out screen with a full navigation. */
export async function deleteOwnAccount(): Promise<{ ok: true } | { error: string }> {
  try {
    const res = await authedPost("/api/account/delete", {});
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: (body as { error?: string }).error ?? "Couldn't delete your account. Try again." };
    // The auth user is already gone on the server; this clears the local
    // session so nothing keeps using its token.
    await supabase.auth.signOut().catch(() => {});
    return { ok: true };
  } catch {
    return { error: "Couldn't delete your account — check your connection." };
  }
}
