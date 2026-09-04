import { authedPost } from "@/lib/authed-fetch";

// Pull a match post off the feed.
//
// Three buttons do this — the captain's own card on Home (MyPostCard), the
// Calendar's fixture sheet, and the admin moderation list — and all three come
// through here, because who is allowed to take a post down, and what has to
// happen to the credit earmark and the secured booking when they do, is
// decided in /api/posts/take-down and nowhere else.
//
// `reason` is required of an admin removing someone else's post (it is what
// the captain is told) and ignored for a team taking down its own.
//
// Returns null on success, or a message to show the person who pressed it.
export async function takeDownPost(postId: string, reason?: string): Promise<string | null> {
  try {
    const res = await authedPost("/api/posts/take-down", { postId, reason });
    if (res.ok) return null;
    const body = await res.json().catch(() => ({}));
    return (body as { error?: string }).error ?? "Couldn't take that post down.";
  } catch {
    return "Couldn't take that post down — check your connection.";
  }
}
