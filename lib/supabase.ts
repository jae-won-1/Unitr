import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Bypass the browser Web Locks API. Its default "steal" behaviour throws
    // noisy "Lock ... was released because another request stole it" /
    // AbortError crashes when concurrent calls (StrictMode double-mounts,
    // multiple contexts/pages) race for the auth-token lock on first paint.
    // The app is single-tab, so a pass-through lock is safe here.
    lock: async (_name, _acquireTimeout, fn) => fn(),
  },
});

export type Profile = {
  id: string;
  full_name: string;
  location: string;
  position: string;
  experience: string;
  created_at: string;
};
