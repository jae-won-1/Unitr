-- Admin take-down of match posts.
--
-- Until now the only person who could pull a post off the feed was the team
-- that put it there — a captain or co-captain pressing "Take Down Post", which
-- flipped match_posts.status to 'cancelled' and nothing else. Unitr staff had
-- no way to remove a post at all, so anything abusive, duplicated or plain
-- wrong stayed on every team's home screen until its kickoff passed.
--
-- Nothing new is stored about the post itself; the take-down is still the
-- status flip. What these columns add is the *provenance* of that flip, which
-- matters once a second kind of person can perform it: a captain whose post
-- vanished is owed an answer to "who took this down, and why?", and the admin
-- who did it is owed a record they can point at.
--
-- Idempotent — safe to re-run.

alter table public.match_posts
  add column if not exists taken_down_by uuid references auth.users(id),
  add column if not exists taken_down_at timestamptz,
  -- Free text the admin types into the take-down sheet. Null for a team taking
  -- down its own post, which needs no justification to anyone.
  add column if not exists taken_down_reason text;

-- The admin posts page lists live posts newest-first and the taken-down ones
-- underneath; both read status, and the second reads taken_down_at.
create index if not exists match_posts_status_idx on public.match_posts(status, created_at desc);

-- No RLS change. Writes to match_posts are already `using (true)` like the rest
-- of the prototype, so the take-down is authorised in code — /api/posts/take-down
-- checks isAdmin / isTeamLeader against the caller's session token, the same way
-- every other privileged route does.
