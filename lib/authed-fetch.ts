import { supabase } from "@/lib/supabase";

// Call an API route with the caller's Supabase access token attached.
//
// Routes that move money or touch a squad identify the caller from this token
// rather than from the body, so a request without it is rejected with a 401.
// Every client call to /api/* should go through one of these.

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function authedPost(path: string, body: unknown): Promise<Response> {
  return fetch(path, { method: "POST", headers: await authHeaders(), body: JSON.stringify(body) });
}

// A form with a file in it. No Content-Type here: the browser has to write its
// own, with the multipart boundary in it.
export async function authedPostForm(path: string, form: FormData): Promise<Response> {
  const { "Content-Type": _json, ...headers } = await authHeaders();
  void _json;
  return fetch(path, { method: "POST", headers, body: form });
}

export async function authedDelete(path: string, body: unknown): Promise<Response> {
  return fetch(path, { method: "DELETE", headers: await authHeaders(), body: JSON.stringify(body) });
}

export async function authedGet(path: string): Promise<Response> {
  // no-store: these answers are per person and change the moment somebody
  // pays, so the browser must never hand back an earlier one.
  return fetch(path, { headers: await authHeaders(), cache: "no-store" });
}
