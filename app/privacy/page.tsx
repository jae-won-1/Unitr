import type { Metadata } from "next";
import { LegalPage, H2, List } from "@/components/LegalPage";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy policy — Uniter" };

// The privacy policy, linked from sign-up and Profile on both apps and from the
// store listings. It describes what the code actually collects — keep it in
// step when a feature starts collecting something new (CLAUDE.md lists the
// services). Draft: to be reviewed by someone qualified before relying on it.
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        Uniter is a football app for players and teams: you make a profile, join or run a team,
        enter events, and pay for them. This policy explains what information we collect to do
        that, why, who we share it with, and the choices you have. Uniter is run by{" "}
        {LEGAL.operator}, {LEGAL.address} (&ldquo;Uniter&rdquo;, &ldquo;we&rdquo;), which is
        responsible for your information under UK data protection law.
      </p>

      <H2>What we collect</H2>
      <List items={[
        <><strong>Your account:</strong> your email address and password, or your name and email
          from Google if you sign in with Google.</>,
        <><strong>Your football profile:</strong> your name, the positions you play, your
          experience level, age group, gender (including &ldquo;prefer not to say&rdquo;), how
          often you play and the kind of football you want. Other players can see your profile —
          that is how teams find players.</>,
        <><strong>Your team activity:</strong> the teams you join or run, join requests and
          offers, your availability answers, line-ups, results, goals and match stats,
          announcements, and messages you send in team chat or directly to another player.</>,
        <><strong>Payments:</strong> card payments are handled by Stripe. We never see or store
          your full card number. We keep a reference to your Stripe customer and saved card,
          the card&rsquo;s brand and last four digits (so you can recognise it), and a record of
          what you paid, when and for what — including your team&rsquo;s credit balance and its
          history.</>,
        <><strong>Technical information:</strong> what our servers and our hosting providers log
          when you use the app, such as your IP address, device or browser type and the time of a
          request, kept for security and to fix faults.</>,
      ]} />
      <p>
        We do not use advertising, we do not sell your information, and we do not track you
        across other apps or websites. The apps do not collect your location, contacts or photos.
      </p>

      <H2>Why we use it</H2>
      <List items={[
        <>To provide the service you signed up for — your account, your teams, events, chat and
          payments. This is necessary for our contract with you.</>,
        <>To keep financial records of payments and team credit, which the law requires us to
          keep.</>,
        <>To keep Uniter secure and fair — for example limiting repeated payment attempts,
          preventing fraud and handling card disputes. This is in our legitimate interests and
          yours.</>,
        <>To send you messages about your account, your team and your games inside the app.</>,
      ]} />

      <H2>Who we share it with</H2>
      <p>Only the services that run Uniter, and only what each one needs:</p>
      <List items={[
        <><strong>Stripe</strong> — card payments and saved cards.</>,
        <><strong>Supabase</strong> — our database and sign-in.</>,
        <><strong>Vercel</strong> — hosts the website and the servers the apps talk to.</>,
        <><strong>Expo</strong> — delivers updates to the mobile app.</>,
        <><strong>Google</strong> — only if you choose to sign in with Google.</>,
        <><strong>OpenStreetMap</strong> — map tiles on the website&rsquo;s pitch map, which
          receives your IP address when the map loads.</>,
      ]} />
      <p>
        Within Uniter, your profile is visible to other users, your team&rsquo;s money and chat to
        your team, and an event&rsquo;s entries to its organiser. We would also share information
        if the law required it. Some of these providers process data outside the UK; where they
        do, they use safeguards recognised by UK law, such as standard contractual clauses.
      </p>

      <H2>How long we keep it</H2>
      <p>
        We keep your information while you have an account. When you delete your account we
        erase your profile and saved card, remove you from your team, and remove your sign-in.
        Records of payments and team credit are kept for six years, as UK tax and accounting law
        requires, under &ldquo;Deleted player&rdquo; rather than your name. Messages you sent stay
        in the conversation for the people you sent them to, also shown as &ldquo;Deleted
        player&rdquo;.
      </p>

      <H2>Your choices and rights</H2>
      <List items={[
        <>Edit your profile at any time from Profile → Edit Profile.</>,
        <>Remove your saved card from Profile.</>,
        <>Delete your account from the bottom of Profile, in the app or on the website. If you
          captain a team with other players, you hand the team to a co-captain first.</>,
        <>You can ask us for a copy of your information, to correct it, to restrict or object to
          how we use it, or to erase it, by emailing {LEGAL.contactEmail}.</>,
        <>If you are unhappy with how we handle your information, you can complain to the
          Information Commissioner&rsquo;s Office (ico.org.uk). We would appreciate the chance to
          put it right first.</>,
      ]} />

      <H2>Children</H2>
      <p>
        You must be at least {LEGAL.minimumAge} to have a Uniter account. If you are under 18,
        you need a parent or guardian&rsquo;s permission before making any payment.
      </p>

      <H2>Changes and contact</H2>
      <p>
        If we change this policy we will update the date at the top, and tell you in the app if
        the change is significant. Questions: {LEGAL.contactEmail}.
      </p>
    </LegalPage>
  );
}
