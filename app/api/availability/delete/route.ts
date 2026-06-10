import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function DELETE(req: NextRequest) {
  try {
    const { requestId, captainId } = await req.json();

    if (!requestId || !captainId) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // Verify the requesting user is actually the captain of this poll
    const { data: poll } = await adminSupabase
      .from("availability_requests")
      .select("captain_id")
      .eq("id", requestId)
      .single();

    if (!poll || poll.captain_id !== captainId) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 403 });
    }

    await adminSupabase.from("availability_responses").delete().eq("request_id", requestId);
    await adminSupabase.from("availability_requests").delete().eq("id", requestId);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete availability error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
