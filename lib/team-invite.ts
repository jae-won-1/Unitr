"use client";

// ── Team invite links ───────────────────────────────────────────────────
// A captain generates one link; anyone who opens it lands in the squad.
// Server side that is supabase_team_invites.sql — every decision (is this
// code real, may this account take it, does a row already exist) is made by
// join_team_by_invite() from auth.uid(). This module is only the plumbing
// around it: build the URL, carry the code across signup, read the verdict.
//
// The code survives a round trip through /register or /login two ways. The
// query string is the primary carrier — it survives a new tab, a password
// manager, a cold browser. localStorage is the backstop for the case the
// query string can't cover: an email-confirmation link that comes back to a
// bare "/" with nothing attached.

import { supabase } from "@/lib/supabase";

const PENDING_KEY = "unitr.pendingInvite";

/** The absolute link a captain shares. Origin comes from the browser, so it
 *  is the Vercel deployment in production and localhost in dev with no env
 *  var to keep in sync. */
export function inviteUrl(code: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/join/${code}`;
}

/** Where an unauthenticated visitor is sent to get an account, with the code
 *  attached so /join can finish the job on the way back. */
export function inviteAuthHref(path: "/login" | "/register", code: string): string {
  return `${path}?invite=${encodeURIComponent(code)}`;
}

export function rememberPendingInvite(code: string): void {
  try { window.localStorage.setItem(PENDING_KEY, code); } catch { /* private mode */ }
}

export function takePendingInvite(): string | null {
  try {
    const code = window.localStorage.getItem(PENDING_KEY);
    window.localStorage.removeItem(PENDING_KEY);
    return code;
  } catch {
    return null;
  }
}

export type InviteTeam = {
  id: string;
  name: string;
  location: string | null;
  level: string | null;
  format: string | null;
  photo_url: string | null;
  joining_fee_pence: number;
  member_count: number;
};

/** Null for a code that matches no team, and also — per the house convention
 *  that a missing migration degrades rather than crashes — for a project
 *  where supabase_team_invites.sql hasn't been run. The page treats both as
 *  "this link doesn't work", which is what a visitor can act on either way. */
export async function fetchInviteTeam(code: string): Promise<InviteTeam | null> {
  const { data, error } = await supabase.rpc("team_by_invite_code", { p_code: code });
  if (error || !data || data.length === 0) return null;
  return data[0] as InviteTeam;
}

export type JoinStatus =
  | "joined"
  | "already_member"
  | "is_captain"
  | "captain_elsewhere"
  | "in_other_team"
  | "venue_manager"
  | "not_found"
  | "error";

export type JoinResult = {
  status: JoinStatus;
  team_id?: string;
  team_name?: string;
  other_team?: string;
};

/** Redeem a code for the signed-in user. Safe to call twice — a second call
 *  comes back "already_member" rather than writing a second row. */
export async function joinByInvite(code: string): Promise<JoinResult> {
  const { data, error } = await supabase.rpc("join_team_by_invite", { p_code: code });
  if (error || !data) return { status: "error" };
  return data as JoinResult;
}

/** Where to send someone who has just signed up or signed in. Deliberately
 *  does NOT join them: it hands back /join/<code>, which redeems the code and
 *  shows the confirmation. One place decides what an invite means, and a new
 *  member and a returning one see the same screen. Null when no invite is in
 *  play, meaning the caller keeps its own destination. */
export function inviteDestination(searchParamCode?: string | null): string | null {
  const code = searchParamCode || takePendingInvite();
  return code ? `/join/${code}` : null;
}

/** The code on the current URL, for pages that pass it along to their own
 *  links (the "already have an account?" hop between /register and /login). */
export function inviteFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("invite");
}
