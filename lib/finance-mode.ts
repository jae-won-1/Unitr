// Which money system this build runs.
//
// docs/PAYMENT_PIVOT.md: team credit (Uniter holds a balance for each team) is
// being replaced by linked team accounts — a leader links the team's bank
// account through Stripe, asks the squad for money with payment requests, and
// the money goes straight there. The new system is built complete behind this
// switch and the app changes over once (user, 10 Nov 2026), rather than
// running two pots side by side for live teams.
//
// Off unless NEXT_PUBLIC_FINANCE_MODE is "linked". Put that in
// .env.development.local to try it; the live site stays on credit until the
// variable is set in Vercel. The phone reads EXPO_PUBLIC_* variables, not this
// one, so it stays on credit until it gets its own copy of this file.
//
// Do not switch it on in production until paying for pitches and events by
// team card is built too (step 3 of the pivot) — until then those still spend
// team credit, and this switch takes the Top Up button away.
export const LINKED_FINANCE = process.env.NEXT_PUBLIC_FINANCE_MODE === "linked";
