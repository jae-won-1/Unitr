import Stripe from "stripe";
import { feeOn } from "@/lib/unitr-fee";

// Server-side only — do not import in client components
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-04-22.dahlia",
});

// Payment helpers (also used in API routes)
export function calcSplit(pitchPricePerHour: number, playerCount: number) {
  const pitchTotal = pitchPricePerHour * 100; // pence
  const perPlayer = Math.round(pitchTotal / playerCount);
  const unitrFee = feeOn(perPlayer);
  const totalPerPlayer = perPlayer + unitrFee;
  return { pitchTotal, perPlayer, unitrFee, totalPerPlayer };
}
