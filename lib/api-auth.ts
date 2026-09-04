import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";

// Identify the signed-in caller of an API route from their Supabase access
// token.
//
// A route that moves money must never take the acting user's id from the
// request body — that is just the caller asserting who they are, and anyone
// can assert anything. The token is signed by Supabase and verified here.
//
// Returns the user's id, or null when there is no valid session.
export async function getCallerId(req: NextRequest): Promise<string | null> {
  const header = req.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;

  // Anon key + the caller's token: getUser() validates the JWT against the
  // project's secret. The service-role client must NOT be used here — it
  // would happily mint a session for anyone.
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

// Same check, but keeping the email too — the Stripe routes need it to create
// a customer, and an email from the request body is no more trustworthy than a
// user id from one.
export async function getCaller(req: NextRequest): Promise<{ id: string; email: string | null } | null> {
  const header = req.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;

  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

// ── Entitlement checks ──────────────────────────────────────────────────
//
// Knowing WHO is calling is only half the job — a route that moves money also
// has to ask whether that person is allowed to move THIS money. These are the
// four questions the API routes ask, kept here so they're answered the same
// way everywhere.
//
// All of them read through adminSupabase: RLS on these tables is `using
// (true)` in this prototype, so the check has to be made in code rather than
// leaned on from the database.


// 401 / 403 shorthand, so every route refuses in the same shape.
export function unauthorized(message = "Not signed in") {
  return NextResponse.json({ error: message }, { status: 401 });
}
export function forbidden(message = "Not allowed") {
  return NextResponse.json({ error: message }, { status: 403 });
}

export async function isTeamCaptain(userId: string, teamId: string): Promise<boolean> {
  const { data } = await adminSupabase
    .from("teams").select("captain_id").eq("id", teamId).maybeSingle();
  return data?.captain_id === userId;
}

// Captain or approved squad member. A pending join request is not membership.
export async function isTeamMember(userId: string, teamId: string): Promise<boolean> {
  if (await isTeamCaptain(userId, teamId)) return true;
  const { data } = await adminSupabase
    .from("team_members")
    .select("id")
    .eq("team_id", teamId)
    .eq("player_id", userId)
    .eq("status", "approved")
    .maybeSingle();
  return Boolean(data);
}

export async function isAdmin(userId: string): Promise<boolean> {
  const { data } = await adminSupabase
    .from("profiles").select("account_type").eq("id", userId).maybeSingle();
  return data?.account_type === "admin";
}

// Venue-side ownership: the manager whose `venue_owner_id` is on the pitch,
// or an admin. Legacy pitches with no owner are nobody's but the admin's.
export async function ownsPitch(userId: string, pitchId: string): Promise<boolean> {
  const { data } = await adminSupabase
    .from("pitches").select("venue_owner_id").eq("id", pitchId).maybeSingle();
  if (data?.venue_owner_id && data.venue_owner_id === userId) return true;
  return isAdmin(userId);
}

// The caller's saved Stripe customer, from their profile — never from the
// request. Used by the routes that read card details back out of Stripe.
export async function callerCustomerId(userId: string): Promise<string | null> {
  const { data } = await adminSupabase
    .from("profiles").select("stripe_customer_id").eq("id", userId).maybeSingle();
  return (data?.stripe_customer_id as string | null) ?? null;
}
