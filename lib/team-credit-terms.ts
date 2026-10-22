// What a player is told about team credit before they pay into it, in one
// place so the web and the phone say the same thing.
//
// Team credit is a prepayment to Uniter for the team's pitches and events. It
// is spent, never withdrawn: there is no cash-out to anyone's card. Staff can
// still return a payment from the Stripe dashboard in an exceptional case (a
// cancelled event, a mistaken charge) and the webhook takes the credit back.
export const TEAM_CREDIT_NON_REFUNDABLE =
  "Team credit can't be withdrawn or refunded to your card — it's spent on your team's pitches and events.";
