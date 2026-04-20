# Unitr — Backend Implementation Plan

## Current State
The frontend is entirely static — all data is hardcoded, context only lives in browser memory/localStorage, and nothing persists between users or sessions. There is no backend.

---

## 1. Database
**Recommended: PostgreSQL via [Supabase](https://supabase.com)** (free tier, hosted, includes auth and storage)

### Core Tables

```
users              id, email, name, position, experience, location, avatar
teams              id, name, location, level, captain_id, league, created_at
team_members       team_id, user_id, role (captain/player)
matches            id, host_team_id, opponent_team_id, date, time, location, pitch_id, status
match_requests     id, match_id, requesting_team_id, status (pending/accepted/rejected)
availability       id, user_id, match_id, date_option_id, is_available
date_options       id, match_id, date, time (up to 5 per match)
pitches            id, name, address, price_per_hour, format, surface, amenities
pitch_bookings     id, pitch_id, team_id, match_id, date, time, status
tactics            id, team_id, formation, style, pressing, notes
tactics_media      id, tactics_id, match_id, type (image/video), label, url
transfer_requests  id, team_id, player_id, status, created_at
```

**Can Claude Code do this?** ✅ Yes — schema design, Prisma/Drizzle setup, migrations.

---

## 2. Authentication
**Recommended: Supabase Auth or NextAuth.js**

Covers:
- Register / Sign In
- Session management (who is logged in)
- Role assignment (captain vs player, derived from `team_members.role`)

**Can Claude Code do this?** ✅ Yes — NextAuth with Supabase is well-documented and straightforward to scaffold.

---

## 3. API Routes (Next.js)
Replace all hardcoded data with real database calls. Each feature maps to API routes:

| Feature | Routes needed |
|---|---|
| Teams | `GET /api/teams`, `POST /api/teams`, `GET /api/teams/[id]` |
| Players | `GET /api/players`, `GET /api/players/[id]` |
| Matches | `GET /api/matches`, `POST /api/matches`, `PATCH /api/matches/[id]` |
| Availability | `POST /api/availability`, `GET /api/matches/[id]/availability` |
| Transfer requests | `POST /api/transfer-requests`, `GET /api/transfer-requests` |
| Tactics | `GET /api/tactics/[teamId]`, `PUT /api/tactics/[teamId]` |
| Pitch bookings | `GET /api/pitches`, `POST /api/bookings` |

**Can Claude Code do this?** ✅ Yes — standard Next.js API route work.

---

## 4. Matchmaking Logic
The core algorithm:
1. Fetch all posted matches
2. Compare date options of each posted match against the requesting team's confirmed availability
3. Sort results by overlap score (most players available = higher rank)

This is pure business logic — no special infrastructure needed.

**Can Claude Code do this?** ✅ Yes — entirely.

---

## 5. File Storage (Tactics media — images/videos)
**Recommended: Supabase Storage or Cloudinary**

Needed for:
- Tactics images/videos uploaded by captain
- Player profile photos

**Can Claude Code do this?** ✅ Yes — Claude can wire up Supabase Storage or Cloudinary SDK with upload endpoints.

---

## 6. Real-time Messaging
**Recommended: Supabase Realtime or Pusher**

Needed for:
- Team group chat
- Match chat between captains
- Direct messages

This requires WebSockets. Supabase Realtime works by subscribing to database changes — lowest friction option if already using Supabase.

**Can Claude Code do this?** ⚠️ Partially — Claude can set up Supabase Realtime subscriptions and the message schema. Basic messaging Claude can do; production-grade messaging (read receipts, notifications, reliability) needs more expertise.

---

## 7. Stripe Split Payments
**Recommended: Stripe Connect**

Flow:
1. Match confirmed → pitch fee known
2. Stripe creates a PaymentIntent split across all confirmed players
3. Each player is charged their share automatically
4. On success → pitch booking confirmed

**Can Claude Code do this?** ⚠️ Partially — Claude can scaffold the Stripe SDK integration and webhook handlers. However **Stripe Connect** (which handles splitting payments between multiple parties) has complex compliance requirements around KYC, payout accounts, and regulatory approval. This area most needs a technical expert or dedicated fintech developer.

---

## Summary Table

| Area | Claude Code | Technical Expert |
|---|---|---|
| Database schema + migrations | ✅ Yes | |
| Auth (register/login/sessions) | ✅ Yes | |
| All API routes / CRUD | ✅ Yes | |
| Matchmaking algorithm | ✅ Yes | |
| File storage (images/video) | ✅ Yes | |
| Basic real-time messaging | ✅ Mostly | Production hardening |
| Stripe basic payments | ✅ Mostly | |
| **Stripe Connect split payments** | ⚠️ Partial | ✅ Needed |
| **Production deployment + scaling** | ⚠️ Partial | ✅ Recommended |
| **GDPR / data compliance** | ❌ | ✅ Needed |
| **Video processing (transcoding)** | ❌ | ✅ Needed (beyond simple upload) |

---

## Recommended Build Order

1. **Supabase setup** — database + auth *(1–2 days with Claude Code)*
2. **API routes** — replace all hardcoded data *(3–5 days with Claude Code)*
3. **File storage** — tactics media uploads *(1 day)*
4. **Matchmaking logic** — availability aggregation + match filtering *(1–2 days)*
5. **Basic messaging** — Supabase Realtime *(2–3 days)*
6. **Stripe payments** — needs expert input on Connect setup

---

## Notes
- Start with Supabase setup + auth — everything else depends on real users and sessions existing.
- The frontend role switcher (`RoleContext`) will be replaced by real session-based roles once auth is in place.
- The `TacticsContext` and all other localStorage-based state will be replaced by API calls to the database.
