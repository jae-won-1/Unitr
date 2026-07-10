import { createClient } from "@supabase/supabase-js";

// Server-side Supabase client for API routes. Prefers the service-role key
// (writes past RLS); falls back to the anon key for local dev where the
// service key isn't in .env.local — the payment tables' RLS policies are
// deliberately open in this prototype, so anon still works.
export const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
