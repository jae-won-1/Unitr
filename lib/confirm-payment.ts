"use client";

import type {
  Stripe,
  StripeElements,
  PaymentIntent,
  SetupIntent,
  StripeError,
} from "@stripe/stripe-js";
import {
  clearPendingPayment,
  paymentReturnUrl,
  rememberPendingPayment,
  type PendingKind,
} from "@/lib/pending-payment";

// The one way this app confirms a card payment, and the one way it saves a
// card. Both go through the same machinery, because a SetupIntent authenticates
// through exactly the same 3D Secure flow a PaymentIntent does — the bank does
// not care whether money is actually moving — so it breaks in exactly the same
// ways, and is fixed by exactly the same race.
//
// stripe.confirmPayment() resolves from a polling loop that lives inside
// Stripe's 3D Secure iframe. On mobile that loop is not reliable, because
// "approve in your banking app" backgrounds the tab by definition, and a
// backgrounded tab has its timers throttled and its network suspended. The loop
// freezes at the exact moment the bank approves, and coming back to the tab
// does not dependably restart it.
//
// The tab is still alive, so nothing reloads and ResumePaymentBanner's on-mount
// recovery never runs either. The result is the worst failure this code has:
// the payer approved in Monzo, switched back, and watched a spinner forever on
// a payment that either already succeeded or is one API call from succeeding.
//
// So the promise is raced against the server. Whenever the tab returns to the
// foreground we ask Stripe what the intent's status actually is, rather than
// waiting for the client to notice:
//
//   succeeded / processing   the payment is done — resolve, whatever the
//                            frozen iframe thinks
//   requires_action          the challenge is still outstanding and the loop
//                            that was driving it froze. Re-drive it once with
//                            handleNextAction, which finds the bank's approval
//                            already waiting and finishes in one round trip.
//
// Failures are deliberately NOT watched for here — they come back through
// confirmPayment() normally. A fresh intent sits at requires_payment_method
// before the card is attached, and treating that as terminal would fail every
// payment the instant it started.

export type ConfirmResult = { paymentIntent?: PaymentIntent; error?: StripeError };
export type SetupResult = { setupIntent?: SetupIntent; error?: StripeError };

// What either kind of intent comes back as. Stripe fills in whichever field
// matches the client secret it was given.
type IntentResult = ConfirmResult & SetupResult;

const SETTLED = new Set(["succeeded", "processing"]);

// How often to ask the server while the payer is looking at the page. The
// visibility listener is what matters; this is the backstop for an iframe that
// stalls without the tab ever being hidden.
const POLL_MS = 4000;

// A SetupIntent's client secret is "seti_…", a PaymentIntent's "pi_…", so the
// secret itself says which retrieve call to make and no caller has to pass it.
export function isSetupSecret(clientSecret: string) {
  return clientSecret.startsWith("seti_");
}

function watchFromServer(
  stripe: Stripe,
  clientSecret: string,
  signal: { done: boolean },
): Promise<IntentResult> {
  return new Promise((resolve) => {
    let busy = false;
    let wasHidden = false;
    let reDriven = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };

    const finish = (r: IntentResult) => {
      if (signal.done) return;
      cleanup();
      resolve(r);
    };

    const check = async () => {
      if (signal.done || busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const current: IntentResult = isSetupSecret(clientSecret)
          ? await stripe.retrieveSetupIntent(clientSecret)
          : await stripe.retrievePaymentIntent(clientSecret);
        const status = (current.paymentIntent ?? current.setupIntent)?.status;
        if (signal.done) return;

        if (status && SETTLED.has(status)) {
          finish(current);
          return;
        }

        // Only after the tab has actually been away — that is the signal that
        // the iframe's loop was frozen rather than simply still working. Once
        // only: handleNextAction mounts its own challenge, and firing it
        // repeatedly would stack them.
        if (status === "requires_action" && wasHidden && !reDriven) {
          reDriven = true;
          const after: IntentResult = await stripe.handleNextAction({ clientSecret });
          if (signal.done) return;
          if (after.error) { finish({ error: after.error }); return; }
          const settled = (after.paymentIntent ?? after.setupIntent)?.status;
          if (settled && SETTLED.has(settled)) finish(after);
        }
      } catch {
        // Offline, or Stripe briefly unhappy. The next tick tries again.
      } finally {
        busy = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") { wasHidden = true; return; }
      void check();
    };

    timer = setInterval(() => void check(), POLL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    // pageshow covers a bfcache restore, focus covers desktop alt-tab, where
    // visibilitychange does not always fire.
    window.addEventListener("pageshow", onVisibility);
    window.addEventListener("focus", onVisibility);
  });
}

export async function confirmCardPayment({
  stripe, elements, clientSecret, kind, amountPence, label,
}: {
  stripe: Stripe;
  elements: StripeElements;
  clientSecret: string;
  kind: PendingKind;
  amountPence: number;
  label: string;
}): Promise<ConfirmResult> {
  // Remembered before confirming, not after: if the OS evicts the tab during
  // the banking-app switch, this is all that is left to recover from
  // (ResumePaymentBanner reads it on the next load).
  rememberPendingPayment({ clientSecret, kind, amountPence, label });

  const signal = { done: false };
  try {
    const result = await Promise.race([
      stripe.confirmPayment({
        elements,
        redirect: "if_required",
        confirmParams: { return_url: paymentReturnUrl() },
      }),
      watchFromServer(stripe, clientSecret, signal),
    ]);
    signal.done = true;

    const status = result.paymentIntent?.status;
    // Cleared on any conclusion. A payment left mid-challenge keeps its entry
    // so the banner can offer to finish it after a reload.
    if (result.error || (status && SETTLED.has(status))) clearPendingPayment();
    return result;
  } finally {
    signal.done = true;
  }
}

// Saving a card, through the same race.
//
// This is the profile's "Add a card". It has no amount and moves no money, but
// the bank runs the identical 3D Secure challenge, so the mobile failure is
// identical: approve in Monzo, come back, and the promise inside the frozen
// iframe never resolves. It was worse here than on a payment, because there was
// no return_url either — a bank that insists on a top-level redirect made
// confirmSetup *throw* an integration error out of the click handler rather
// than return one, which is the crash the payer saw on coming back.
//
// The pending entry is written for the same reason a payment's is: if the OS
// evicts the tab during the app switch, ResumePaymentBanner is the only thing
// left that knows a card was half-saved. Its kind is "card" and its amount is
// 0 — nothing was charged, and the banner says so in those words.
export async function confirmCardSetup({
  stripe, elements, clientSecret,
}: {
  stripe: Stripe;
  elements: StripeElements;
  clientSecret: string;
}): Promise<SetupResult> {
  rememberPendingPayment({ clientSecret, kind: "card", amountPence: 0, label: "Saving your card" });

  const signal = { done: false };
  try {
    const result: IntentResult = await Promise.race([
      stripe.confirmSetup({
        elements,
        redirect: "if_required",
        confirmParams: { return_url: paymentReturnUrl() },
      }),
      watchFromServer(stripe, clientSecret, signal),
    ]);
    signal.done = true;

    const status = result.setupIntent?.status;
    if (result.error || (status && SETTLED.has(status))) clearPendingPayment();
    return { setupIntent: result.setupIntent, error: result.error };
  } catch (err) {
    // confirmSetup throws rather than returns on an integration error. Thrown
    // out of an onClick that becomes an unhandled rejection and the button
    // sticks on "Saving…" forever, so it is turned back into the error shape
    // the caller already knows how to show.
    signal.done = true;
    clearPendingPayment();
    return { error: { message: (err as Error)?.message || "Could not save that card." } as StripeError };
  } finally {
    signal.done = true;
  }
}
