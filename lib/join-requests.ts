import { supabase } from "@/lib/supabase";

// Join requests — pending team_members rows waiting for a leader's answer.
// The one place they are listed and answered, shared by the notification
// panel, My Team → Members → Requests, and the phone.
//
// Approving flips the row to `approved`, which is the membership itself: the
// joining-fee trigger, the welcome DM and the team chat all follow from that
// write, exactly as they do for a join by invite link.

export type JoinRequest = {
  id: string;
  playerId: string;
  name: string;
  position: string | null;
};

/** Where a leader manages them — My Team → Members → Requests. */
export const JOIN_REQUESTS_HREF = "/my-team?tab=members&sub=requests";

export async function loadJoinRequests(teamId: string): Promise<JoinRequest[]> {
  const { data, error } = await supabase
    .from("team_members")
    .select("id, player_id, profiles(full_name, position)")
    .eq("team_id", teamId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) return [];
  return ((data ?? []) as unknown as {
    id: string; player_id: string;
    profiles: { full_name: string | null; position: string | null } | null;
  }[]).map((r) => ({
    id: r.id,
    playerId: r.player_id,
    name: r.profiles?.full_name ?? "Unknown player",
    position: r.profiles?.position ?? null,
  }));
}

/** Approve or decline one request. Returns a sentence when it didn't happen. */
export async function answerJoinRequest(
  requestId: string,
  answer: "approved" | "rejected",
): Promise<{ error: string | null }> {
  const { data, error } = await supabase
    .from("team_members")
    .update({ status: answer })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id");
  if (error) return { error: "Couldn't save that. Please try again." };
  // No row back: someone else answered it first, or the player withdrew.
  if (!data || data.length === 0) return { error: "That request is no longer waiting." };
  return { error: null };
}
