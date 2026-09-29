// The React Native half of lib/authed-fetch.ts — see that file for the auth
// header, which is identical here.
//
// The one real difference: "/api/ringer/create-intent" is a path the browser
// resolves against its own origin for free, but a phone has no origin to
// resolve it against, so a bare fetch() to it throws. EXPO_PUBLIC_API_BASE_URL
// (mobile/.env) is the deployed Vercel origin every API route already lives
// on; every call here is prefixed with it before it reaches fetch.
//
// Nothing about *how* a route authenticates changes — it is still the same
// Supabase access token in the same Authorization header, read by the same
// lib/api-auth.ts on the server. Only the URL a phone needs to reach it
// differs from a browser tab already sitting on that origin.

import { supabase } from "@/lib/supabase";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";

function resolve(path: string): string {
  return `${API_BASE_URL}${path}`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function authedPost(path: string, body: unknown): Promise<Response> {
  return fetch(resolve(path), { method: "POST", headers: await authHeaders(), body: JSON.stringify(body) });
}

export async function authedDelete(path: string, body: unknown): Promise<Response> {
  return fetch(resolve(path), { method: "DELETE", headers: await authHeaders(), body: JSON.stringify(body) });
}

export async function authedGet(path: string): Promise<Response> {
  return fetch(resolve(path), { headers: await authHeaders() });
}
