import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCallerId, forbidden, unauthorized } from "@/lib/api-auth";
import { deletionBlockReason } from "@/lib/delete-account";
import { withdrawFutureAnswers, withdrawPollAnswers } from "@/lib/membership-cleanup";

// Delete the caller's own account (lib/delete-account.ts). Required by both
// app stores; the web offers it too.
//
// A deletion, not a wipe. The person's money records stay — the ledger,
// payments, bookings and results reference their id, Uniter has to keep what
// was paid, and the squad still needs to see what was owed. So the auth user
// is SOFT-deleted (the row survives, so nothing referencing it breaks) and
// everything that identifies the person goes:
//
//   • their squad membership, with the answers for games that haven't
//     happened (the same tidy-up as Leave team), pending join requests,
//     offers, friend requests, watchlist entries and their own notifications;
//   • their Stripe customer, which takes the saved card with it;
//   • every personal field on the profile, which is renamed "Deleted player"
//     and marked account_type 'deleted' — the Transfer Market and search list
//     only 'player' accounts, so it drops out of both;
//   • their sign-in: email replaced, Google identity removed, user deleted.
//
// What they owe the squad stays owed, exactly as when someone leaves.
//
// Refused for a captain (user, 26 Oct 2026): they hand the team to a
// co-captain first (/api/team/hand-over), which makes them an ordinary member.
// Refused for venue and admin accounts, which Uniter staff close by hand.

// Profile fields that are not about the person and stay as they are.
const KEEP = new Set(["id", "account_type", "created_at", "updated_at"]);

export async function POST(req: NextRequest) {
  try {
    const userId = await getCallerId(req);
    if (!userId) return unauthorized();

    const [{ data: profile }, { data: captained }] = await Promise.all([
      adminSupabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      adminSupabase.from("teams").select("id, name").eq("captain_id", userId).maybeSingle(),
    ]);
    const blocked = deletionBlockReason(profile?.account_type ?? null, captained?.name ?? null);
    if (blocked) return forbidden(blocked);

    // ── The squad ──
    const { data: memberships } = await adminSupabase
      .from("team_members").select("id, team_id, status").eq("player_id", userId);
    for (const m of memberships ?? []) {
      if (m.status === "approved") {
        await withdrawFutureAnswers(adminSupabase, m.team_id, userId);
        await withdrawPollAnswers(adminSupabase, m.team_id, userId);
      }
    }
    await adminSupabase.from("team_chat_members").delete().eq("user_id", userId);
    const { error: memberErr } = await adminSupabase.from("team_members").delete().eq("player_id", userId);
    if (memberErr) {
      // Nothing irreversible has happened yet — stop here so it can be retried.
      console.error("account delete: membership", memberErr);
      return NextResponse.json({ error: "Couldn't delete your account. Try again." }, { status: 500 });
    }

    // ── Everything else that points at them. Best effort: a table whose
    //    migration was never run simply has nothing to delete. ──
    await Promise.all([
      adminSupabase.from("player_offers").delete().eq("player_id", userId),
      adminSupabase.from("friend_requests").delete().or(`from_player_id.eq.${userId},to_player_id.eq.${userId}`),
      adminSupabase.from("player_watchlist").delete().eq("player_id", userId),
      adminSupabase.from("notifications").delete().eq("user_id", userId),
    ]);

    // ── Stripe: deleting the customer detaches every saved card. Charges
    //    already made stay in Stripe's records, as they must. ──
    const customerId = (profile?.stripe_customer_id as string | null) ?? null;
    if (customerId) {
      try {
        await stripe.customers.del(customerId);
      } catch (err) {
        // A test key can't see a live customer (lib/stripe-customer.ts), and
        // one already deleted on Stripe's side is fine either way.
        console.warn("account delete: stripe customer", err);
      }
    }

    // ── The profile ──
    if (profile) {
      const scrub: Record<string, unknown> = {};
      for (const key of Object.keys(profile)) if (!KEEP.has(key)) scrub[key] = null;
      scrub.full_name = "Deleted player";
      scrub.account_type = "deleted";
      const { error: scrubErr } = await adminSupabase.from("profiles").update(scrub).eq("id", userId);
      if (scrubErr) {
        // Some column refused null (a not-null default). Clear what will clear,
        // one column at a time, rather than leaving the whole profile intact.
        for (const [key, value] of Object.entries(scrub)) {
          await adminSupabase.from("profiles").update({ [key]: value }).eq("id", userId);
        }
      }
    }

    // ── Sign-in ──
    // The email is replaced first so the address is free to register again,
    // and the Google identity removed so that account can start afresh too.
    await adminSupabase.auth.admin.updateUserById(userId, {
      email: `deleted-${userId}@deleted.invalid`,
      email_confirm: true,
      user_metadata: {},
    });
    const { error: identityErr } = await adminSupabase.rpc("delete_auth_identities", { p_user_id: userId });
    if (identityErr) console.warn("account delete: identities (run supabase_account_deletion.sql)", identityErr.message);
    const { error: authErr } = await adminSupabase.auth.admin.deleteUser(userId, true);
    if (authErr) {
      console.error("account delete: auth user", authErr);
      return NextResponse.json({ error: "Your details were removed, but signing you out for good failed. Try again." }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("account delete error:", err);
    return NextResponse.json({ error: "Couldn't delete your account. Try again." }, { status: 500 });
  }
}
