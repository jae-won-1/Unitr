import { createClient } from "@supabase/supabase-js";

// Server-side Supabase client for API routes. Prefers the service-role key
// (writes past RLS); falls back to the anon key for local dev where the
// service key isn't in .env.local — the payment tables' RLS policies are
// deliberately open in this prototype, so anon still works.
//
// A blank `SUPABASE_SERVICE_ROLE_KEY=` line is the common shape of "not set"
// and parses to an empty string, which `??` would pass straight through to
// createClient — failing the whole build with "supabaseKey is required"
// rather than falling back. Treat empty/whitespace as absent.
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

export const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  serviceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
