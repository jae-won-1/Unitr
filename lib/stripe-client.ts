import { loadStripe, type StripePaymentElementOptions } from "@stripe/stripe-js";

export const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
);

// Shared Payment/Setup Element options.
//
// `billingDetails` is set to "never" for name, email and phone: Stripe renders
// those inputs (and Link's signup box behind them) inside the Element, which
// asked a payer to hand over their name and email just to keep a card on file.
// We already know who they are from the session, and nothing downstream reads
// the billing name — so the form is the card and nothing else. Address is left
// alone, because some cards need the postcode to authorise.
export const cardElementOptions: StripePaymentElementOptions = {
  layout: "tabs",
  paymentMethodOrder: ["card"],
  fields: { billingDetails: { name: "never", email: "never", phone: "never" } },
};
