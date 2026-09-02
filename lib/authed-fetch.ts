import { supabase } from "@/lib/supabase";

// POST to an API route with the caller's Supabase access token attached.
//
// Routes that charge cards identify the caller from this token rather than
// from the body, so a request without it is rejected with a 401.
export async function authedPost(path: string, body: unknown): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}
