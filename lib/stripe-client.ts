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
//
// Link is turned off outright (`wallets.link: "never"`). Hiding the billing
// fields wasn't enough: Link renders its own "Save my information for faster
// checkout" box with its own email, phone and name inputs, which is a second
// account signup on top of the one the payer already has with us.
export const cardElementOptions: StripePaymentElementOptions = {
  layout: "tabs",
  paymentMethodOrder: ["card"],
  // Opting out of a field obliges us to supply it at confirm time instead —
  // resolveBillingDetails() in lib/confirm-payment.ts does that for name and
  // email. Phone is deliberately NOT opted out of: there is no phone number on
  // a profile to send, so claiming "never" here would owe Stripe a value we
  // haven't got. Left at the default it costs nothing, because the Element only
  // renders a phone field for payment methods that require one, and cards
  // don't.
  fields: { billingDetails: { name: "never", email: "never" } },
  wallets: { link: "never" },
  // Stripe prints its own mandate line ("By providing your card information,
  // you allow ... to charge your card for future payments") whenever the
  // intent carries setup_future_usage. It is unconditional, so it told every
  // payer their card was being kept even when they had not asked for that,
  // and it sat below the card field where nobody read it.
  //
  // Suppressing it obliges us to collect that consent ourselves, which is
  // exactly what the save-card tick box does — an explicit opt-in carrying
  // the same wording, instead of a notice. See useSaveCardTickbox in
  // components/SaveCardPrompt.tsx; do not turn this off without one.
  terms: { card: "never" },
};
