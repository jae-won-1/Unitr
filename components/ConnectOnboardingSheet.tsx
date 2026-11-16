"use client";

import { useState } from "react";
import { loadConnectAndInitialize } from "@stripe/connect-js";
import { ConnectAccountOnboarding, ConnectComponentsProvider } from "@stripe/react-connect-js";
import BottomSheet from "@/components/BottomSheet";

// Linking a bank account to a Stripe Connect account without leaving Uniter —
// a team's account in Team finance, a venue's payout account in Venue
// Settings.
//
// Stripe's embedded onboarding component asks exactly what its hosted page
// asks — who is being paid, and the bank account — but inside this sheet. The
// questions themselves can't be skipped: whoever receives the money has to be
// identified (UK anti-money-laundering rules), and Stripe asks only what it
// needs. Where the bank supports it, Stripe offers to verify the account by
// approving in the banking app instead of typing the numbers.
//
// The caller supplies `fetchClientSecret`, which asks its own route for a
// short-lived account-session secret (/api/finance/account action "session",
// /api/connect/create-venue-account with embedded: true). It unlocks
// onboarding for that one account only, and Stripe calls it again itself when
// the session lapses.
//
// Load it with next/dynamic and ssr:false: Stripe's script needs a browser.

export default function ConnectOnboardingSheet({
  title, subtitle, fetchClientSecret, onClose, onFinished, onUseHostedPage,
}: {
  title: string;
  subtitle?: string;
  /** Resolves to an account-session client secret, or throws with a message to show. */
  fetchClientSecret: () => Promise<string>;
  onClose: () => void;
  /** They left the form — finished or not. The caller asks Stripe where it stands. */
  onFinished: () => void | Promise<void>;
  /** Fallback: Stripe's own page, if the embedded form can't load. */
  onUseHostedPage: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  // Created once per opening of the sheet.
  const [connect] = useState(() => loadConnectAndInitialize({
    publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "",
    fetchClientSecret: async () => {
      try {
        return await fetchClientSecret();
      } catch (err) {
        setError(err instanceof Error && err.message ? err.message : "Couldn't start linking with Stripe.");
        throw err;
      }
    },
    appearance: {
      overlays: "dialog",
      variables: {
        colorPrimary: "#008000",
        borderRadius: "12px",
        fontFamily: "inherit",
      },
    },
  }));

  return (
    <BottomSheet
      title={title}
      subtitle={subtitle ?? "Secured by Stripe — Uniter never sees your bank details"}
      onClose={onClose}
    >
      {error ? (
        <div className="space-y-3">
          <p className="text-xs text-red-600">{error}</p>
          <button type="button" onClick={onUseHostedPage}
            className="w-full py-2.5 rounded-btn border border-border text-sm font-semibold">
            Use Stripe&apos;s page instead
          </button>
        </div>
      ) : (
        <div className="min-h-[320px]">
          <ConnectComponentsProvider connectInstance={connect}>
            <ConnectAccountOnboarding
              onExit={() => { void onFinished(); }}
              onLoadError={({ error: loadError }) => setError(loadError.message || "Stripe's form couldn't load.")}
            />
          </ConnectComponentsProvider>
        </div>
      )}
    </BottomSheet>
  );
}
