import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { adminSupabase } from "@/lib/supabase-admin";
import { getCaller, isTeamLeader, forbidden, unauthorized } from "@/lib/api-auth";
import { financeOff, loadFinanceAccount, loadNames, STRIPE_LIVEMODE, UUID } from "@/lib/team-finance-server";
import type { AccountAction, FinanceAccount } from "@/lib/team-finance";

export const dynamic = "force-dynamic";

// The team's linked bank account — a Stripe Connect account, the same kind a
// venue has (/api/connect/create-venue-account). Money the squad pays into
// payment requests is transferred to it and Stripe pays it out to the bank.
//
//   session    start, or carry on with, onboarding inside Uniter (embedded)
//   link       the same on Stripe's hosted page — the fallback
//   refresh    ask Stripe whether the account can take payments yet
//   dashboard  a link to Stripe's own payouts page
//
// The account belongs to the PERSON who linked it: Stripe holds their identity
// and bank details. So only they can continue onboarding or open the payouts
// page — another leader is told whose it is. Ideally it is a club account, or
// a personal one kept only for the team.

const ACTIONS: AccountAction[] = ["link", "session", "refresh", "dashboard"];
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: NextRequest) {
  const off = financeOff();
  if (off) return off;

  try {
    const caller = await getCaller(req);
    if (!caller) return unauthorized();

    const { teamId, action } = await req.json().catch(() => ({}));
    if (!UUID.test(teamId ?? "")) return bad("Missing teamId");
    if (!ACTIONS.includes(action)) return bad("Unknown action.");
    if (!(await isTeamLeader(caller.id, teamId))) {
      return forbidden("Only the captain or a co-captain can manage the team's bank account.");
    }

    const existing = await loadFinanceAccount(teamId);
    const ownerName = async (id: string) => (await loadNames([id])).get(id) ?? "another leader";

    const describe = async (row: { linked_by: string; transfers_active: boolean } | null): Promise<FinanceAccount> => ({
      linked: Boolean(row),
      ready: Boolean(row?.transfers_active),
      linkedByMe: row?.linked_by === caller.id,
      linkedByName: row ? await ownerName(row.linked_by) : null,
    });

    if (action === "refresh") {
      if (!existing) return NextResponse.json({ account: await describe(null) });
      const account = await stripe.accounts.retrieve(existing.stripe_account_id);
      const flags = {
        details_submitted: account.details_submitted ?? false,
        // The transfers capability is what a destination charge needs.
        transfers_active: account.capabilities?.transfers === "active",
        payouts_enabled: account.payouts_enabled ?? false,
        updated_at: new Date().toISOString(),
      };
      await adminSupabase.from("team_finance_accounts").update(flags)
        .eq("team_id", teamId).eq("livemode", STRIPE_LIVEMODE);
      return NextResponse.json({ account: await describe({ ...existing, ...flags }) });
    }

    if (existing && existing.linked_by !== caller.id) {
      return bad(`${await ownerName(existing.linked_by)} linked the team's bank account, so only they can manage it.`, 409);
    }

    if (action === "dashboard") {
      if (!existing?.details_submitted) return bad("Finish linking the bank account first.", 409);
      const login = await stripe.accounts.createLoginLink(existing.stripe_account_id);
      return NextResponse.json({ url: login.url });
    }

    // ── link / session ─────────────────────────────────────────────────
    let accountId = existing?.stripe_account_id ?? null;
    if (!accountId) {
      const { data: team } = await adminSupabase.from("teams").select("name").eq("id", teamId).maybeSingle();
      // No business_type: Stripe's onboarding asks, so a club with its own
      // bank account can register as one and an individual as themselves.
      const account = await stripe.accounts.create({
        type: "express",
        country: "GB",
        email: caller.email ?? undefined,
        capabilities: { transfers: { requested: true } },
        business_profile: {
          name: (team?.name as string | undefined) ?? undefined,
          product_description: "Amateur football team collecting match fees and subs from its own players",
        },
        metadata: { teamId, linkedBy: caller.id, type: "uniter_team" },
      });
      accountId = account.id;
      const { error } = await adminSupabase.from("team_finance_accounts").insert({
        team_id: teamId, livemode: STRIPE_LIVEMODE, stripe_account_id: accountId, linked_by: caller.id,
      });
      if (error) {
        console.error("finance/account: could not record account", accountId, error.message);
        return bad("Couldn't save the linked account. Check supabase_team_finance.sql has been run.", 500);
      }
    }

    // Onboarding inside Uniter's own page: Stripe's embedded component, which
    // asks the same questions as the hosted page without leaving the app. The
    // client secret is short-lived and only unlocks onboarding for this one
    // account, so it is safe to hand to the leader's browser.
    if (action === "session") {
      const session = await stripe.accountSessions.create({
        account: accountId,
        components: {
          account_onboarding: {
            enabled: true,
            features: { external_account_collection: true },
          },
        },
      });
      return NextResponse.json({ clientSecret: session.client_secret });
    }

    // The hosted page — kept as the fallback if the embedded form can't load.
    const origin = req.headers.get("origin") ?? new URL(req.url).origin;
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/my-team/finance?connect=refresh`,
      return_url: `${origin}/my-team/finance?connect=done`,
      type: "account_onboarding",
    });
    return NextResponse.json({ url: link.url });
  } catch (err) {
    console.error("finance/account error:", err);
    // Stripe refuses every accounts.create until the platform has signed up
    // for Connect (per mode — test and live are switched on separately). That
    // is a setup step for Uniter's staff, not something the leader can retry.
    const message = err instanceof Error ? err.message : "";
    // Same for a platform that joined Connect after Stripe moved new
    // integrations to Accounts v2: v1 creation must be allowed in the
    // dashboard (Settings → Developers → API policies → Accounts v1 support).
    if (/signed up for Connect|Accounts v1/i.test(message)) {
      return bad("Uniter hasn't finished setting up bank linking with Stripe yet. Try again later.", 503);
    }
    return bad("Couldn't reach Stripe. Try again in a moment.", 500);
  }
}
