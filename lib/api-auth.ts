import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

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
