// Unitr's cut, in one place.
//
// This used to be a bare `0.05` written out at eight call sites — three API
// routes, four components and a page — so changing the rate meant finding all
// eight and trusting you had. Everything now derives from the rate below,
// including the UI copy: at 0 the fee lines hide themselves rather than
// printing "£0.00 (0%)" beside every price.
//
// Currently **0** — the rate is being agreed with partners. Restore the
// platform fee by setting UNITR_FEE_RATE back to 0.05 (or whatever is agreed)
// and nothing else needs touching.
//
// Rows already written keep the fee they were charged: `unitr_fee_pence` on
// player_payments and pitch_bookings is a snapshot, not a recomputation, so
// changing this rate never rewrites what someone has already paid.

export const UNITR_FEE_RATE = 0;

/** False while Unitr takes no cut — hide fee lines entirely rather than showing £0.00. */
export const UNITR_FEE_ENABLED = UNITR_FEE_RATE > 0;

/** The rate as a label, e.g. "5%". */
export const UNITR_FEE_LABEL = `${Number((UNITR_FEE_RATE * 100).toFixed(2))}%`;

/** The fee charged on top of `basePence`. */
export function feeOn(basePence: number): number {
  return Math.round(basePence * UNITR_FEE_RATE);
}

/** `basePence` plus its fee — what the payer actually owes. */
export function withFee(basePence: number): number {
  return basePence + feeOn(basePence);
}

/** The fee already contained inside a gross `totalPence` — the inverse of `withFee`. */
export function feeWithin(totalPence: number): number {
  return Math.round(totalPence - totalPence / (1 + UNITR_FEE_RATE));
}
