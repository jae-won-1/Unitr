import type { Metadata } from "next";
import { LegalPage, H2, List } from "@/components/LegalPage";
import { LEGAL } from "@/lib/legal";
import { TEAM_CREDIT_CAP_PENCE } from "@/lib/team-credit-terms";

export const metadata: Metadata = { title: "Terms of use — Uniter" };

// The terms, linked from sign-up and Profile on both apps and from the store
// listings. The team-credit section is the one docs/LAUNCH_PLAN.md says the
// terms must carry: a prepayment, not refundable, what happens when Uniter
// cancels, how mistaken charges are handled. It must agree with
// lib/team-credit-terms.ts (shown before every payment) and lib/credit-cap.ts.
// Draft: to be reviewed by someone qualified before relying on it.
export default function TermsPage() {
  const cap = `£${(TEAM_CREDIT_CAP_PENCE / 100).toLocaleString("en-GB")}`;
  return (
    <LegalPage title="Terms of use">
      <p>
        These terms are the agreement between you and {LEGAL.operator} (&ldquo;Uniter&rdquo;,
        &ldquo;we&rdquo;) for using the Uniter app and website. By creating an account you agree
        to them. Our <a href="/privacy" className="text-accent-ink font-semibold">privacy
        policy</a> explains how we handle your information.
      </p>

      <H2>Your account</H2>
      <List items={[
        <>You must be at least {LEGAL.minimumAge} to create an account.</>,
        <>Give accurate details, including the men&rsquo;s or women&rsquo;s category your team
          plays in, and keep your sign-in to yourself. You are responsible for what happens on
          your account.</>,
        <>You can delete your account at any time from Profile. A captain with other players in
          the team hands it to a co-captain first; a captain alone in the team closes it.</>,
      ]} />

      <H2>Teams and captains</H2>
      <p>
        A captain (and any co-captain they appoint) runs the team: they accept players, enter
        events and spend the team&rsquo;s credit on the team&rsquo;s behalf. By joining a team you
        accept that they can do this. A captain can hand the team to a co-captain, who then takes
        over the team, its credit and its fixtures.
      </p>

      <H2>Team credit</H2>
      <p>
        Each team has a credit balance. It is a prepayment to Uniter for the team&rsquo;s pitches
        and events booked through Uniter — like money on a gym account — not a bank account or
        stored money you can spend elsewhere.
      </p>
      <List items={[
        <><strong>How it gets in.</strong> Players pay by card for something named: a joining
          fee, their share of a game or event, or a top-up the team needs. The money goes to
          Uniter and the team&rsquo;s balance goes up by the same amount.</>,
        <><strong>What it pays for.</strong> The team&rsquo;s pitches and event entries booked
          through Uniter.</>,
        <><strong>It is not refundable.</strong> Team credit can&rsquo;t be withdrawn or refunded
          to your card, and it isn&rsquo;t returned if you leave the team or delete your account.
          If a team is closed, any credit left in it is lost.</>,
        <><strong>It has a limit.</strong> A team can hold up to {cap} of credit.</>,
        <><strong>If Uniter cancels an event, or removes a team from one,</strong> the buy-in
          the team paid goes back to the team&rsquo;s credit.</>,
        <><strong>If you were charged by mistake,</strong> email {LEGAL.contactEmail}. If we
          agree it was a mistake we refund it to your card, and the credit that payment created
          is taken back off the team.</>,
        <><strong>If you dispute a payment with your bank,</strong> the credit it created is
          taken back off the team. This can leave the team&rsquo;s balance below zero, which the
          team then owes.</>,
      ]} />

      <H2>Paying</H2>
      <List items={[
        <>Card payments are processed by Stripe. If you choose to save a card, it can be charged
          later for amounts you owe your team, such as your share of a game you played.</>,
        <>What you owe your team — a joining fee, your share of games you played — stays owed if
          you leave the team or delete your account.</>,
        <>On the website, a guest place in another team&rsquo;s game (&ldquo;Fill In&rdquo;) costs
          a flat fee paid to Uniter by card, shown before you pay.</>,
      ]} />

      <H2>Events and games</H2>
      <List items={[
        <>Event details, schedules and results are set by the organiser. Uniter may change,
          postpone or cancel an event; if we cancel it, see Team credit above.</>,
        <>Pitches are run by their venues. You must follow the venue&rsquo;s rules.</>,
        <>Football is a contact sport. You take part at your own risk and are responsible for
          being fit to play. Nothing in these terms limits our liability for death or personal
          injury caused by our negligence, or anything else the law does not allow us to
          limit.</>,
      ]} />

      <H2>Behaving well</H2>
      <p>
        Don&rsquo;t harass or abuse other users, post anything unlawful or offensive, impersonate
        anyone, enter a category you don&rsquo;t belong in, or try to get around how the app
        works — for example its payment limits or security. We can remove content, remove a team
        from an event, or suspend or close an account that breaks these rules.
      </p>

      <H2>Our responsibility</H2>
      <p>
        We work to keep Uniter running and accurate, but it is provided as it is and may
        sometimes be unavailable. Apart from what the law doesn&rsquo;t let us exclude, we
        aren&rsquo;t liable for losses that weren&rsquo;t foreseeable, or for anything a venue,
        organiser or another user does. Your legal rights as a consumer are not affected.
      </p>

      <H2>Changes, law and contact</H2>
      <p>
        We may update these terms; we will change the date at the top and tell you in the app
        about significant changes. These terms are governed by the law of England and Wales.
        Questions or complaints: {LEGAL.contactEmail}, or write to {LEGAL.address}.
      </p>
    </LegalPage>
  );
}
