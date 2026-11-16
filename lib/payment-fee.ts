// The fee a payer covers on top of a payment request.
//
// Decided by the user on 10 Nov 2026: a player paying a request pays the fee,
// so the team receives exactly what it asked for. The fee is added ON TOP of
// the amount — it is not taken out of it.
//
// Uniter pays Stripe's processing cost out of this fee, so it has to be at
// least that. THE FIGURES BELOW ARE A PLACEHOLDER: Stripe's published price for
// a standard UK card (1.5% + 20p), which undercharges on a foreign or premium
// card. Confirm the real rate before switching lib/finance-mode.ts on. UK law
// bans charging a consumer extra for paying by card, so this must be worded,
// and applied, as a service fee on every payment — it is, there being no other
// way to pay through Uniter.
//
// Separate from lib/uniter-fee.ts, which is the old percentage-only cut on
// credit payments (currently 0) and goes with credit.

export const PAYMENT_FEE_RATE = 0.015;
export const PAYMENT_FEE_FIXED_PENCE = 20;

export const PAYMENT_FEE_ENABLED = PAYMENT_FEE_RATE > 0 || PAYMENT_FEE_FIXED_PENCE > 0;

/**
 * The fee on top of `netPence`, sized so that after a percentage-plus-fixed
 * charge on the TOTAL, `netPence` is what is left: total = (net + fixed) / (1 − rate).
 * £10.00 → £10.36 charged, 36p fee.
 */
export function feeOnTop(netPence: number): number {
  if (!PAYMENT_FEE_ENABLED || netPence <= 0) return 0;
  const total = Math.ceil((netPence + PAYMENT_FEE_FIXED_PENCE) / (1 - PAYMENT_FEE_RATE));
  return total - netPence;
}

/** `netPence` plus its fee — what the payer's card is charged. */
export function withFeeOnTop(netPence: number): number {
  return netPence + feeOnTop(netPence);
}
