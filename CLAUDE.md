# Unitr — Project Brief

I'm building a football platform that provides the following services: player-team matching, matchmaking, pitch booking platform, and a social media space based on match stats/videos.

---

## Core Concept

Users on the app should be able to create a profile and create teams or join existing teams. Existing teams should also be able to register the team on the platform and find players. Once registered, teams can gather availabilities within their team and post a game so other teams with matching availability can find the game and match together. The team that posts the game should be able to use the pitch booking platform (booking.com style) to scroll through pitches and choose one. Once a match is fixed, we want to use Stripe to take split payments from each player for the pitch booking fees. We want to create a stats/video based social media space where teams and players can track each other's performance, and use the data to provide better matchmaking/player-team matching, and also create leagues.

---

## General Notes

- The platform has 5 main pages: **Home**, **Play**, **My Team**, **Messages**, and **Profile**.
- For payment and pitch booking features that require actual APIs and customers, use **dummy data** to show how it would work.
- The focus is not a fully functioning platform but an **initial iteration to visualise the idea** and see which functions would require technical expertise.

---

## Pages

### Home
The dashboard area. Displays:
- Upcoming fixtures, leagues, and tournaments the user is part of.
- Clicking a fixture shows match details.
- A scrollable social media feed where users can post performance stats/videos for players in their region to see.
- A combined feed from other players, teams, and the user's own team.

### Play
The area where teams create games/tournaments and post them to find opponent teams.
- **Matches** and **tournaments** are separated categories.
- Users can view match posts created by other teams.
- A **filter option** to display games that match the availability of the user's team.

**Creating a match flow:**
1. Team captain opens a calendar UI where each teammate selects their availability — data is combined into a team availability view.
2. A map/list UI shows available pitches matching the team's availability.
3. The team selects a pitch.
4. Once two teams are matched, they are taken to a **payment page** where the pitch fee is split automatically among all participating players via Stripe.
5. As soon as a match is confirmed, payment is taken automatically and the pitch booking is confirmed.

**Ringer category:**
- A separate section for individuals who want to join a quick match for a discounted price.
- Displays matches that need extra players — anyone can join for a discounted rate.

### My Team
Displays team performance stats: table ranking, win rate, upcoming fixtures.

- **Tactics board** — a football tactics board where you can upload formations, set piece positions, and situational scenarios (FIFA-style).
- **Players button** — displays team players with individual stats accessible via "View Profile".
- **Transfer Window** (inside Players) — teams can scout for players looking to join a new team. Teams can send requests to players. There is also an inbox to view requests that players have sent to join the team.

### Messages
- The team's **group chat** is pinned at the top.
- A **match group chat** between captains of each matched team.
- **Direct messaging** between individual players.

### Profile
- Profile information section: position, play style, playing experience, supporting team, etc.
- **My Stats** section: performance tracking (stats/videos) from matches, teams, and leagues — displayed and shareable to the social media board.

---

## Technical Areas Requiring Expertise

- **Stripe** — split payments between players on match confirmation, automatic pitch booking confirmation.
- **Pitch booking API** — booking.com-style pitch discovery, availability matching, and reservation.
- **Real-time messaging** — group chats, direct messages, match-specific chats.
- **Availability aggregation** — combining individual player availability into team-wide availability windows.
- **Stats/video ingestion** — uploading, processing, and displaying match performance data and video.
- **Matchmaking algorithm** — using stats and availability data to surface relevant opponents and player-team matches.
- **League engine** — generating tables, fixtures, and standings automatically.
