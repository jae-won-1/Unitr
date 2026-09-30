// Whether this client is talking to Stripe in TEST mode.
//
// Local development (the web on `npm run dev`, the phone on `expo start`) runs
// Stripe in test mode against the SAME database as the live site. Every
// `profiles.stripe_customer_id` / `stripe_payment_method_id` there belongs to
// live mode, so in test mode a client must never write card details onto a
// profile: a test card would replace a real player's live one, and their next
// off-session charge would fail. lib/save-card.ts and the save-card offers
// read this; lib/stripe-customer.ts makes the matching call on the server.
//
// The React Native build reads its own key name — see stripe-mode.native.ts.
export const STRIPE_TEST_MODE = (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "").startsWith("pk_test_");
