"use client";

// ── Sign in with Google ─────────────────────────────────────────────────
// Supabase runs the whole exchange: the browser leaves for Google, comes back
// through the project's own /auth/v1/callback, and lands on `redirectTo` with
// the session in the URL fragment. The client is on the default implicit flow
// (lib/supabase.ts sets no flowType), so `detectSessionInUrl` picks that
// fragment up in the browser and there is no server route to write.
//
// What Google gives us is an identity, not a profile. It has no idea what
// position somebody plays, so app/auth/callback hands a first-time account to
// /welcome and only a finished profile reaches the app.

import { supabase } from "@/lib/supabase";
import { rememberPendingInvite } from "@/lib/team-invite";

/** Where Google sends the browser back to. Origin comes from the browser so
 *  this is the Vercel deployment in production and localhost in dev — the same
 *  reasoning as inviteUrl(). Both must be listed as redirect URLs in the
 *  Supabase project's auth settings, or the round trip ends on an error page. */
export function googleRedirectUrl(): string {
  return `${window.location.origin}/auth/callback`;
}

/**
 * Leaves for Google. Resolves only when the handover failed (the provider is
 * switched off in the project, say) — on success the page is already gone.
 *
 * An invite code can't ride the query string through Google's redirect, so it
 * goes into the localStorage backstop lib/team-invite already keeps for the
 * email-confirmation round trip. /auth/callback and /welcome read it back.
 */
export async function signInWithGoogle(invite?: string | null): Promise<string | null> {
  if (invite) rememberPendingInvite(invite);

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: googleRedirectUrl() },
  });

  if (!error) return null;
  return error.message;
}

// ── Connecting Google to an account that already exists ─────────────────
// Everything above is for a new account. This is for the accounts that were
// already here when Google sign-in arrived, and it matters most for the ones
// registered with an address that isn't a Google account at all — a made-up
// email can never be matched, so nothing but an explicit link will ever join
// the two.
//
// linkIdentity attaches the Google identity to whoever is *signed in*, so the
// address on the account is irrelevant: sign in with the password once, tap
// Connect, and the Google button lands on this account from then on. It needs
// "Manual linking" enabled in the Supabase project (docs/GOOGLE_SIGN_IN.md).

/** True when this account can already be reached with Continue with Google. */
export async function hasGoogleIdentity(): Promise<boolean> {
  const { data } = await supabase.auth.getUserIdentities();
  return (data?.identities ?? []).some((i) => i.provider === "google");
}

/**
 * Leaves for Google to attach it to the signed-in account, and comes back to
 * `returnTo`. Resolves only on failure — the two worth naming are the project
 * having manual linking switched off, and the Google account already belonging
 * to a different Uniter account, which is a real answer rather than a fault.
 */
export async function connectGoogle(returnTo = "/profile"): Promise<string | null> {
  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(returnTo)}`;
  const { error } = await supabase.auth.linkIdentity({
    provider: "google",
    options: { redirectTo },
  });

  if (!error) return null;
  if (/manual linking/i.test(error.message)) {
    return "Connecting Google isn't switched on yet. Sign in with your email and password for now.";
  }
  if (/already/i.test(error.message)) {
    return "That Google account is already connected to another Uniter account.";
  }
  return error.message;
}

/**
 * Detach Google again. Supabase refuses to remove the last identity, which is
 * the behaviour we want — an account with nothing but Google left would be
 * locked out — so the caller only offers this when there is something else to
 * sign in with.
 */
export async function disconnectGoogle(): Promise<string | null> {
  const { data, error: listError } = await supabase.auth.getUserIdentities();
  if (listError) return listError.message;

  const identities = data?.identities ?? [];
  const google = identities.find((i) => i.provider === "google");
  if (!google) return null;
  if (identities.length < 2) {
    return "Google is the only way into this account. Set a password first.";
  }

  const { error } = await supabase.auth.unlinkIdentity(google);
  return error?.message ?? null;
}
