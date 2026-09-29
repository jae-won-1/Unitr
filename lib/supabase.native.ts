// The React Native build of the Supabase client.
//
// Metro prefers a `.native.ts` file over the plain `.ts` beside it, while
// Next's bundler does not know the convention and keeps `supabase.ts`. So the
// 20 files in this folder that do `import { supabase } from "@/lib/supabase"`
// keep that line exactly as written, and each platform silently gets the
// client that works there. Nothing in the web app changes.
//
// Four things differ from supabase.ts, all forced by the platform:

import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
// 1. URL/URLSearchParams are incomplete in React Native's JS runtime and
//    supabase-js relies on them. Must be imported before the client is built.
import "react-native-url-polyfill/auto";

// 2. Expo only inlines variables prefixed EXPO_PUBLIC_ into the bundle, so the
//    NEXT_PUBLIC_ names supabase.ts reads are simply undefined here. Same
//    values, different prefix — see mobile/.env.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // 3. There is no localStorage on a phone. Without this the session is held
    //    in memory only and the player is signed out every time the app is
    //    closed — the single most noticeable difference between a web app and
    //    a real one, so it is not optional.
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,

    // 4. detectSessionInUrl is a browser concern: it reads the auth fragment
    //    off window.location after an email link. A native app has no address
    //    bar, and deep links are handled by the router instead, so leaving it
    //    on makes supabase-js reach for a `window` that is not there.
    detectSessionInUrl: false,

    // NOTE: supabase.ts overrides `lock` to bypass the browser Web Locks API,
    // whose "steal" behaviour throws on StrictMode double-mounts. That override
    // is deliberately NOT carried over — Web Locks is a browser API that does
    // not exist here, and supabase-js already selects a native-safe lock on
    // this platform. Copying it across would replace a working lock with a
    // no-op for no reason.
  },
});

// A phone app is suspended rather than closed. Left alone, supabase-js keeps a
// refresh timer running in the background — which the OS throttles anyway — and
// can return to the foreground holding a token that expired while asleep.
// Tying refresh to foreground state means the session is renewed on the way
// back in, which is when it is actually needed.
AppState.addEventListener("change", (state) => {
  if (state === "active") supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

// Mirrors the type in supabase.ts. Declared rather than re-exported from there
// so that typechecking this file never pulls the web module (and its
// NEXT_PUBLIC_/`process` typings) into the mobile compile. If one changes, so
// must the other.
export type Profile = {
  id: string;
  full_name: string;
  location: string;
  position: string;
  experience: string;
  created_at: string;
};
