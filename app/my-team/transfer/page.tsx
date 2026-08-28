"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  loadViewer, loadEdges, loadInbox, searchPlayers, searchTeams,
  sendFriendRequest, respondToFriendRequest, sendOffer, acceptOffer, declineOffer, askToJoin,
  type MarketPlayer, type MarketTeam, type MarketEdges, type Viewer,
  type InboxOffer, type InboxFriend,
} from "@/lib/transfer-market";

// Two-sided discovery. Players browse teams to find somewhere to play; captains
// browse players to fill gaps in the squad. Same page, same search, one toggle —
// because "who's out there" is one question, and splitting it into two screens
// would mean the free agent and the captain scouting them never meet.
//
// Cards are relationship-aware: the button reflects where you already stand
// with that row (requested / offered / friends), so the market never invites
// you to send something twice.

const POSITIONS = ["All", "GK", "CB", "LB", "RB", "CDM", "CM", "CAM", "RW", "LW", "ST"];
const EXPERIENCES = ["All", "Casual", "Competitive", "Semi-Pro"];

function initials(name: string) {
  return name.split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

// ── Shared bits ───────────────────────────────────────────────
function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
        active ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"
      }`}>
      {label}
    </button>
  );
}

function Avatar({ name, muted }: { name: string; muted?: boolean }) {
  return (
    <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 border ${
      muted ? "bg-surface border-border" : "bg-accent/10 border-accent/30"
    }`}>
      <span className={`text-xs font-bold ${muted ? "text-text-secondary" : "text-accent"}`}>{initials(name)}</span>
    </div>
  );
}

// ── Player card ───────────────────────────────────────────────
function PlayerCard({ player, edges, viewer, onAction }: {
  player: MarketPlayer;
  edges: MarketEdges;
  viewer: Viewer | null;
  onAction: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const friend = edges.friends.get(player.id) ?? "none";
  const offer = edges.offers.get(player.id) ?? "none";

  // A captain can only sign a free agent. Someone already in a squad has to
  // leave it first, so offering would be a button that can't do anything.
  const canOffer = !!viewer?.captainTeamId && !player.teamName;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    await fn();
    await onAction();
    setBusy(false);
  };

  const meta = [player.position, player.location, player.experience].filter(Boolean).join(" · ");

  return (
    <div className="bg-surface-2 border border-border rounded-2xl p-4">
      <div className="flex items-center gap-3 mb-3">
        <Avatar name={player.full_name} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate">{player.full_name}</p>
          <p className="text-xs text-text-secondary truncate mt-0.5">{meta || "No info set"}</p>
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${
          player.teamName
            ? "bg-surface text-text-secondary border-border"
            : "bg-accent/10 text-accent border-accent/30"
        }`}>
          {player.teamName ?? "Free agent"}
        </span>
      </div>

      <div className="flex gap-2">
        <a href={`/profile/${player.id}`}
          className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold text-text-secondary text-center">
          View Profile
        </a>

        {friend === "friends" ? (
          <span className="flex-1 py-2.5 rounded-xl bg-accent/10 border border-accent/30 text-accent text-sm font-bold text-center">
            Friends ✓
          </span>
        ) : friend === "sent" ? (
          <span className="flex-1 py-2.5 rounded-xl bg-surface border border-border text-text-secondary text-sm font-semibold text-center">
            Request sent
          </span>
        ) : friend === "incoming" ? (
          <button type="button" disabled={busy}
            onClick={() => run(() => respondToFriendRequest(player.id, viewer!.userId, true))}
            className="flex-1 py-2.5 rounded-xl bg-accent text-black text-sm font-bold disabled:opacity-50">
            Accept friend
          </button>
        ) : (
          <button type="button" disabled={busy || !viewer}
            onClick={() => run(() => sendFriendRequest(viewer!.userId, player.id))}
            className="flex-1 py-2.5 rounded-xl border border-accent/40 text-accent text-sm font-bold disabled:opacity-40">
            Add friend
          </button>
        )}
      </div>

      {canOffer && (
        <button type="button"
          disabled={busy || offer === "pending" || offer === "accepted"}
          onClick={() => run(() => sendOffer(viewer!.captainTeamId!, viewer!.userId, player.id, null))}
          className={`w-full mt-2 py-2.5 rounded-xl text-sm font-bold disabled:opacity-60 ${
            offer === "none" || offer === "declined" ? "bg-accent text-black" : "bg-surface border border-border text-text-secondary"
          }`}>
          {offer === "pending" ? "Offer sent"
            : offer === "accepted" ? "Offer accepted"
            : offer === "declined" ? "Offer declined · send again"
            : "Send offer to join"}
        </button>
      )}
    </div>
  );
}

// ── Team card ─────────────────────────────────────────────────
function TeamCard({ team, edges, viewer, onAction }: {
  team: MarketTeam;
  edges: MarketEdges;
  viewer: Viewer | null;
  onAction: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const join = edges.joins.get(team.id) ?? "none";
  // Being in a squad already is what blocks a join request, not being a captain
  // specifically — one team at a time either way.
  const alreadyPlacedElsewhere = !!viewer?.myTeamId && viewer.myTeamId !== team.id;

  const meta = [team.location, team.format, team.level, `${team.members} member${team.members === 1 ? "" : "s"}`]
    .filter(Boolean).join(" · ");

  const run = async () => {
    setBusy(true);
    await askToJoin(team.id, viewer!.userId);
    await onAction();
    setBusy(false);
  };

  return (
    <div className="bg-surface-2 border border-border rounded-2xl p-4">
      <div className="flex items-center gap-3 mb-3">
        <Avatar name={team.name} muted />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate">{team.name}</p>
          <p className="text-xs text-text-secondary truncate mt-0.5">{meta}</p>
        </div>
      </div>

      <div className="flex gap-2">
        <a href={`/my-team/${team.id}`}
          className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold text-text-secondary text-center">
          View Team
        </a>

        {join === "captain" ? (
          <span className="flex-1 py-2.5 rounded-xl bg-surface border border-border text-text-secondary text-sm font-semibold text-center">
            Your team
          </span>
        ) : join === "member" ? (
          <span className="flex-1 py-2.5 rounded-xl bg-accent/10 border border-accent/30 text-accent text-sm font-bold text-center">
            You&apos;re in ✓
          </span>
        ) : join === "pending" ? (
          <span className="flex-1 py-2.5 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm font-semibold text-center">
            Request pending
          </span>
        ) : (
          <button type="button" disabled={busy || !viewer || alreadyPlacedElsewhere}
            title={alreadyPlacedElsewhere ? "Leave your current team first" : undefined}
            onClick={run}
            className="flex-1 py-2.5 rounded-xl bg-accent text-black text-sm font-bold disabled:opacity-40">
            Ask to join
          </button>
        )}
      </div>
    </div>
  );
}

// ── Inbox ─────────────────────────────────────────────────────
function InboxSheet({ offers, friends, userId, onClose, onAction }: {
  offers: InboxOffer[];
  friends: InboxFriend[];
  userId: string;
  onClose: () => void;
  onAction: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => { setBusy(true); await fn(); await onAction(); setBusy(false); };

  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto bg-black/60" onClick={onClose}>
      <div className="min-h-full flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-[#141414] border border-border rounded-2xl p-6" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <p className="font-bold text-lg">Your inbox</p>
            <button onClick={onClose} aria-label="Close">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>

          {offers.length === 0 && friends.length === 0 && (
            <p className="text-sm text-text-secondary py-4 text-center">Nothing waiting on you.</p>
          )}

          {offers.length > 0 && (
            <section className="mb-5">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Team offers</p>
              <div className="space-y-2">
                {offers.map((o) => (
                  <div key={o.id} className="bg-surface-2 border border-border rounded-xl p-3">
                    <p className="text-sm font-semibold">{o.teamName}</p>
                    <p className="text-xs text-text-secondary mt-0.5">
                      {o.message ?? "wants you to join their squad."}
                    </p>
                    <div className="flex gap-2 mt-3">
                      <button type="button" disabled={busy} onClick={() => run(() => declineOffer(o.id))}
                        className="flex-1 py-2 rounded-lg border border-border text-xs font-semibold text-text-secondary disabled:opacity-50">
                        Decline
                      </button>
                      <button type="button" disabled={busy} onClick={() => run(() => acceptOffer(o.id, o.teamId, userId))}
                        className="flex-1 py-2 rounded-lg bg-accent text-black text-xs font-bold disabled:opacity-50">
                        Accept &amp; join
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {friends.length > 0 && (
            <section>
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Friend requests</p>
              <div className="space-y-2">
                {friends.map((f) => (
                  <div key={f.fromId} className="bg-surface-2 border border-border rounded-xl p-3 flex items-center gap-3">
                    <Avatar name={f.name} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{f.name}</p>
                      <p className="text-[11px] text-text-secondary truncate">
                        {[f.position, f.location].filter(Boolean).join(" · ") || "Player"}
                      </p>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button type="button" disabled={busy}
                        onClick={() => run(() => respondToFriendRequest(f.fromId, userId, false))}
                        className="px-2.5 py-1.5 rounded-lg border border-border text-[11px] font-semibold text-text-secondary disabled:opacity-50">
                        Ignore
                      </button>
                      <button type="button" disabled={busy}
                        onClick={() => run(() => respondToFriendRequest(f.fromId, userId, true))}
                        className="px-2.5 py-1.5 rounded-lg bg-accent text-black text-[11px] font-bold disabled:opacity-50">
                        Accept
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────
export default function TransferMarketPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"players" | "teams">("players");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [posFilter, setPosFilter] = useState("All");
  const [expFilter, setExpFilter] = useState("All");

  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [players, setPlayers] = useState<MarketPlayer[]>([]);
  const [teams, setTeams] = useState<MarketTeam[]>([]);
  const [edges, setEdges] = useState<MarketEdges>({ friends: new Map(), offers: new Map(), joins: new Map() });
  const [inbox, setInbox] = useState<{ offers: InboxOffer[]; friends: InboxFriend[] }>({ offers: [], friends: [] });
  const [inboxOpen, setInboxOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!user) { setViewer(null); return; }
    loadViewer(user.id).then(setViewer);
  }, [user]);

  // Relationship state and the inbox move together: accepting an offer changes
  // both, so one refresh keeps every card honest.
  const refreshEdges = useCallback(async () => {
    if (!user || !viewer) return;
    const [e, i] = await Promise.all([loadEdges(viewer), loadInbox(user.id)]);
    setEdges(e);
    setInbox(i);
  }, [user, viewer]);

  useEffect(() => { refreshEdges(); }, [refreshEdges]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const run = tab === "players"
      ? searchPlayers(debounced, user?.id).then((r) => { if (!cancelled) setPlayers(r); })
      : searchTeams(debounced).then((r) => { if (!cancelled) setTeams(r); });
    run.finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tab, debounced, user?.id]);

  const visiblePlayers = players.filter((p) =>
    (posFilter === "All" || p.position === posFilter) &&
    (expFilter === "All" || p.experience === expFilter)
  );

  const pending = inbox.offers.length + inbox.friends.length;
  const count = tab === "players" ? visiblePlayers.length : teams.length;

  return (
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-8">
      <div className="flex items-center gap-3 mb-5">
        <a href="/my-team">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </a>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Transfer Market</h1>
          <p className="text-xs text-text-secondary">Find players and teams</p>
        </div>
        {user && (
          <button type="button" onClick={() => setInboxOpen(true)}
            className="relative w-10 h-10 rounded-full bg-surface-2 border border-border flex items-center justify-center">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4h16v12H5.17L4 17.17z"/>
            </svg>
            {pending > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-black text-[10px] font-bold flex items-center justify-center">
                {pending}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Search — moved off the home screen, where it sat above a dashboard it
          couldn't act on. Discovery is this page's whole job. */}
      <div className="relative mb-4">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          type="search"
          autoCapitalize="none"
          autoCorrect="off"
          enterKeyHint="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tab === "players" ? "Search players by name…" : "Search teams by name…"}
          className="w-full bg-surface-2 border border-border rounded-xl pl-10 pr-10 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60"
        />
        {loading && (
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          </div>
        )}
      </div>

      {/* Toggle */}
      <div className="flex gap-2 mb-4">
        {(["players", "teams"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold border capitalize transition-colors ${
              tab === t ? "bg-accent text-black border-accent" : "bg-surface-2 text-text-secondary border-border"
            }`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "players" && (
        <div className="flex flex-col gap-2 mb-4">
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {POSITIONS.map((p) => <Chip key={p} label={p} active={posFilter === p} onClick={() => setPosFilter(p)} />)}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {EXPERIENCES.map((e) => <Chip key={e} label={e} active={expFilter === e} onClick={() => setExpFilter(e)} />)}
          </div>
        </div>
      )}

      {!user && (
        <div className="bg-accent/10 border border-accent/30 rounded-xl px-4 py-3 mb-4">
          <p className="text-xs text-accent font-semibold mb-0.5">Browsing as a guest</p>
          <p className="text-xs text-text-secondary">
            <a href="/register" className="underline">Create an account</a> to send requests, offers, and friend invites.
          </p>
        </div>
      )}

      <p className="text-xs text-text-secondary mb-3">
        {loading ? "Searching…" : `${count} ${tab === "players" ? "player" : "team"}${count === 1 ? "" : "s"} found`}
      </p>

      <div className="space-y-3">
        {!loading && count === 0 && (
          <div className="bg-surface-2 border border-border rounded-2xl p-6 text-center">
            <p className="text-sm text-text-secondary">
              {debounced.trim() ? `No ${tab} match “${debounced.trim()}”.` : `No ${tab} on Unitr yet.`}
            </p>
          </div>
        )}

        {tab === "players"
          ? visiblePlayers.map((p) => (
              <PlayerCard key={p.id} player={p} edges={edges} viewer={viewer} onAction={refreshEdges} />
            ))
          : teams.map((t) => (
              <TeamCard key={t.id} team={t} edges={edges} viewer={viewer} onAction={refreshEdges} />
            ))}
      </div>

      {inboxOpen && user && (
        <InboxSheet
          offers={inbox.offers}
          friends={inbox.friends}
          userId={user.id}
          onClose={() => setInboxOpen(false)}
          onAction={async () => { await refreshEdges(); if (viewer) setViewer(await loadViewer(user.id)); }}
        />
      )}
    </div>
  );
}
