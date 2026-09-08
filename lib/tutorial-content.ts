// The tutorial's words, in one place.
//
// Two surfaces read from this file: the in-app carousel
// (components/TutorialSheet.tsx), which shows one role's track, and the
// shareable slide deck, which shows every track plus BEYOND_PILOT. Keeping the
// copy here rather than inside the sheet is the whole point — the app and the
// deck cannot drift into describing the product differently, and a typo is
// fixed once.
//
// Tracks are keyed by the role RoleContext derives, so the sheet never has to
// map between the two. Venue managers and admins get no track: the pilot is
// players and captains, and staff learn the portal from a person, not a
// carousel.

/** The subset of Role that has a tutorial track. */
export type TutorialRole = "new_user" | "captain" | "player";

/**
 * Which illustration a slide carries. Deliberately a small closed set of
 * abstract marks rather than screenshots — the sheet is phone-width, and a
 * screenshot of the app rendered inside the app is unreadable at that size.
 * TutorialSheet maps each key to an inline SVG.
 */
export type TutorialArt =
  | "pitch" | "team" | "credit" | "calendar"
  | "trophy" | "tactics" | "chat" | "shield";

export type TutorialSlide = {
  /** Stable across copy edits — the deck anchors its role-picker links on it. */
  id: string;
  title: string;
  body: string;
  /** Where the slide teaches you to go. Real route, opened on tap. */
  cta?: { label: string; href: string };
  art: TutorialArt;
};

// ── The pilot tracks ──────────────────────────────────────────────────
// Each one is built around the pilot's critical path: get the team into the
// tournament, and get everyone paid. Anything that doesn't serve that is in
// BEYOND_PILOT instead.

const NEW_USER: TutorialSlide[] = [
  {
    id: "new-welcome",
    title: "Welcome to Uniter",
    body: "Teams find other teams to play, book a pitch, and split the cost between the players. Everything lives under three tabs: Home to find games, Calendar for what you're committed to, My Team for your squad.",
    art: "pitch",
  },
  {
    id: "new-create",
    title: "Start your own team",
    body: "You become the captain: you name the squad, set a joining fee, and enter the team into tournaments. It takes about a minute and you can invite people straight afterwards.",
    cta: { label: "Create a team", href: "/my-team/create" },
    art: "shield",
  },
  {
    id: "new-join",
    title: "Or join one that already exists",
    body: "Browse the teams on your home screen and ask to join — the captain approves you. If a captain has sent you their invite link, opening it puts you in the squad immediately, no approval needed.",
    cta: { label: "Browse teams", href: "/" },
    art: "team",
  },
  {
    id: "new-fillin",
    title: "No team? You can still play",
    body: "Fill In games are one-off spots in someone else's match when they're short. You pay £5, turn up, play. It's a perfectly good way to use Uniter on its own — you don't have to join a squad.",
    cta: { label: "Find a Fill In game", href: "/" },
    art: "calendar",
  },
];

const CAPTAIN: TutorialSlide[] = [
  {
    id: "cap-welcome",
    title: "You run the team",
    body: "Everything to do with your squad lives under My Team — the players, the money, the tactics. Home is where you find games to enter, and Calendar is everything you've already committed to.",
    cta: { label: "Open My Team", href: "/my-team" },
    art: "shield",
  },
  {
    id: "cap-money",
    title: "Team credit, and the joining fee",
    body: "Your team has one pot of credit. Tournament buy-ins and pitch bookings come out of it, and your squad tops it back up. The simplest way to fill it is a joining fee — a one-off amount each new member owes, which pays straight into the pot. Set it in Team Settings. You owe it too: you play in the games it pays for.",
    cta: { label: "Set your joining fee", href: "/my-team/settings" },
    art: "credit",
  },
  {
    id: "cap-squad",
    title: "Get your squad in, and share the load",
    body: "Team Settings holds your invite link — send it and people join instantly, no approving each one. The same page lets you promote trusted members to co-captain. A co-captain can do everything you can, apart from appointing other co-captains.",
    cta: { label: "Invite link & co-captains", href: "/my-team/settings" },
    art: "team",
  },
  {
    id: "cap-availability",
    title: "Ask who can actually play",
    body: "Post a few possible dates and the squad says which they can make. You don't have to — but if you've run a poll and then enter a game on one of those dates, everyone's answer carries across automatically. Nobody gets asked the same question twice.",
    cta: { label: "Collect availability", href: "/my-team/collect-availability" },
    art: "calendar",
  },
  {
    id: "cap-enter",
    title: "Enter the tournament",
    body: "Open tournaments show up on your home feed. Entering takes the buy-in out of your team credit there and then, so make sure the pot covers it first. Once you're in, the whole squad is asked whether they're available, and the event appears on everyone's calendar.",
    cta: { label: "Find a tournament", href: "/" },
    art: "trophy",
  },
  {
    id: "cap-manage",
    title: "Manage the match",
    body: "Tap any fixture on your Calendar to manage it: see who's available, pick a formation and a lineup, and check the kickoff time and pitch. A tournament is one entry on your calendar but several games — each one gets its own lineup.",
    cta: { label: "Open your Calendar", href: "/calendar" },
    art: "tactics",
  },
  {
    id: "cap-settle",
    title: "Collect what you're owed",
    body: "Settle Payments is where you get the money back off the players. It goes fixture by fixture, shows you who has paid and who hasn't, and tracks each member's joining fee alongside. Ticking someone off is bookkeeping — the money itself moves when they top up.",
    cta: { label: "Settle payments", href: "/my-team/history" },
    art: "credit",
  },
];

const PLAYER: TutorialSlide[] = [
  {
    id: "ply-welcome",
    title: "You're in the squad",
    body: "Three tabs: Home shows what your captain needs from you and what games are around, Calendar is everything you're committed to, My Team is the squad, the tactics and the money.",
    cta: { label: "Open My Team", href: "/my-team" },
    art: "team",
  },
  {
    id: "ply-fee",
    title: "Pay your joining fee first",
    body: "Most teams charge a one-off joining fee. It isn't a separate charge — it goes into your team's credit, which is what pays for pitches and tournament entries. Until it's paid you can't mark yourself available for games, so it's the first thing to sort.",
    cta: { label: "Check what you owe", href: "/my-team" },
    art: "credit",
  },
  {
    id: "ply-availability",
    title: "Say whether you're playing",
    body: "Available or Unavailable, on every upcoming fixture — on your home screen and on each Calendar card. Answer as early as you can, because your captain picks the lineup from it. You can change your mind right up to kickoff.",
    cta: { label: "Open your Calendar", href: "/calendar" },
    art: "calendar",
  },
  {
    id: "ply-tactics",
    title: "See the lineup before you turn up",
    body: "Once the captain has picked a team, open the fixture to see the formation and where you're playing. For a tournament, each game in the day gets its own lineup, so check the one you're about to play.",
    cta: { label: "See your fixtures", href: "/calendar" },
    art: "tactics",
  },
  {
    id: "ply-pay",
    title: "Payment requests and topping up",
    body: "When your captain collects for a game, the request arrives as a message. Paying tops up the team's credit, which is the pot the pitch is booked from. You can save a card so it takes a couple of taps.",
    cta: { label: "Open Messages", href: "/messages" },
    art: "chat",
  },
];

export const TUTORIAL: Record<TutorialRole, TutorialSlide[]> = {
  new_user: NEW_USER,
  captain: CAPTAIN,
  player: PLAYER,
};

/** Human label for a track — the deck's role picker, not shown in the app. */
export const TRACK_LABEL: Record<TutorialRole, string> = {
  new_user: "I'm new / I haven't got a team",
  captain: "I captain a team",
  player: "I play for a team",
};

// ── Beyond the pilot ──────────────────────────────────────────────────
// Built and usable, but not on the pilot's critical path, so the in-app
// carousel leaves them out — a first-run tutorial that lists everything
// teaches nothing. The shareable deck shows them at the end, as "here's what
// else this thing does".

export const BEYOND_PILOT: TutorialSlide[] = [
  {
    id: "bey-posts",
    title: "Play another team directly",
    body: "Post a match with the dates and pitches you'd take, and other captains challenge you for it. First to accept gets the game, and the pitch fee is split between the two teams.",
    art: "pitch",
  },
  {
    id: "bey-booking",
    title: "Book a pitch on its own",
    body: "Browse pitches by time and price and book one outright, with no opponent lined up. You can turn a booked pitch into a match post afterwards — any team can then join it immediately, because the pitch is already paid for.",
    art: "calendar",
  },
  {
    id: "bey-transfer",
    title: "The Transfer Market",
    body: "Two-sided discovery: teams looking for players, players looking for teams. Captains send offers, players send join requests, and you can add people as friends.",
    art: "team",
  },
  {
    id: "bey-chat",
    title: "Team group chat and announcements",
    body: "Every squad gets a group chat automatically — approve someone and they're in it, no setup. Captains can also send an announcement, which reaches everyone as a direct message as well.",
    art: "chat",
  },
  {
    id: "bey-ringers",
    title: "Ringers, when you're short",
    body: "If a team can't field a full side, they can open the spare places up. A guest pays a flat £5 to fill in, and they're kept out of the team's own payment split.",
    art: "team",
  },
  {
    id: "bey-results",
    title: "Results and verification",
    body: "Submit the score, the scorers and who actually played. The other team confirms it from their side, so a result is agreed by both captains rather than taken on one team's word.",
    art: "trophy",
  },
  {
    id: "bey-profile",
    title: "Profiles, stats and badges",
    body: "Every player has a profile with their position, season stats, badges and highlights — the beginning of the record that will eventually drive matchmaking and leagues.",
    art: "shield",
  },
  {
    id: "bey-venue",
    title: "The venue portal",
    body: "Pitch owners get a separate app of their own: a booking calendar, their customers, open matches at their venue, reports and payouts. Players never see it, and venue accounts never see the player side.",
    art: "pitch",
  },
];
