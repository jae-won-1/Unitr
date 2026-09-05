// A card payment that was started but may not have finished.
//
// On mobile, 3D Secure sends the payer into their banking app. iOS and Android
// are free to evict the backgrounded browser tab while that happens, and when
// they do the confirmPayment() promise dies with the page: Stripe is left
// holding an authenticated PaymentIntent, the payer approved it in their bank,
// and nothing in the app ever hears back. The charge silently never completes
// and the payer is shown nothing at all. That is the failure this file exists
// to close.
//
// The client secret is written to localStorage *before* confirming, because it
// has to outlive the tab. ResumePaymentBanner reads it on the next load and
// finishes the job. The secret is already a client-side value by design, is
// scoped to the payer's own browser and origin, and is cleared the moment the
// payment reaches a final state.

const KEY = "unitr.pendingPayment";

// An intent abandoned for an hour is not worth resuming — Stripe will have
// moved on and the payer certainly has.
const MAX_AGE_MS = 60 * 60 * 1000;

// What finishing the payment completes.
//   "credit"  — the Stripe webhook grants the credit off the intent's metadata,
//               so authenticating is genuinely all that is left to do.
//   "booking" — the app still had a write to make after the charge (create the
//               booking, record the ringer signup). Resuming recovers the
//               payment but NOT that write, so the banner says so rather than
//               claiming everything worked.
export type PendingKind = "credit" | "booking";

export type PendingPayment = {
  clientSecret: string;
  kind: PendingKind;
  amountPence: number;
  /** What the payer thought they were paying for, shown back to them. */
  label: string;
  startedAt: number;
};

export function rememberPendingPayment(entry: Omit<PendingPayment, "startedAt">) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...entry, startedAt: Date.now() }));
  } catch {
    // Private mode, quota, storage disabled. The payment still works — it just
    // can't be recovered if the tab dies, which is where we were already.
  }
}

export function readPendingPayment(): PendingPayment | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingPayment;
    if (!p?.clientSecret || Date.now() - (p.startedAt ?? 0) > MAX_AGE_MS) {
      clearPendingPayment();
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

export function clearPendingPayment() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}

// Where Stripe sends the payer when it has to leave the page to authenticate.
//
// Every confirm in the app is `redirect: "if_required"`, so this is only used
// when a redirect is genuinely unavoidable. Supplying it costs nothing in the
// common case and removes the failure where Stripe needs to redirect, finds no
// return_url, and errors instead of taking the payment.
export function paymentReturnUrl(): string {
  return `${window.location.origin}/payment-return`;
}
