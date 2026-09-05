"use client";

// "Use 4242 4242 4242 4242" — shown ONLY when the app is running on a test
// Stripe key.
//
// This note was copy-pasted as fixed markup into five payment surfaces, so
// switching to a live account left every one of them telling real customers to
// type a test card — which declines, and reads as the app being broken.
//
// The publishable key is the authority rather than a flag someone has to
// remember to flip: pk_test_ means test mode, pk_live_ means real money. It is
// inlined at build time, so a production build renders nothing here at all.

export const STRIPE_TEST_MODE =
  (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "").startsWith("pk_test_");

export default function TestModeNote() {
  if (!STRIPE_TEST_MODE) return null;
  return (
    <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl px-4 py-3">
      <p className="text-[11px] text-blue-300 font-semibold mb-0.5">Test Mode</p>
      <p className="text-[11px] text-blue-200">
        Use <span className="font-mono font-bold">4242 4242 4242 4242</span> · any future expiry · any CVC
      </p>
    </div>
  );
}
