"use client";

import { useEffect, useState } from "react";
import { authedPost } from "@/lib/authed-fetch";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { stripePromise } from "@/lib/stripe-client";
import { confirmCardSetup } from "@/lib/confirm-payment";
import { paymentMethodIdOf, persistSavedCard } from "@/lib/save-card";
import { useRole } from "@/contexts/RoleContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import TestModeNote from "@/components/TestModeNote";

const stripeAppearance = {
  theme: "night" as const,
  variables: {
    colorPrimary: "#0E7A3C",
    colorBackground: "#1a1a1a",
    colorText: "#ffffff",
    colorDanger: "#f87171",
    borderRadius: "12px",
    fontFamily: "system-ui, sans-serif",
  },
};

// ── Card-on-file: SetupIntent form (saves a card for off-session settlement) ──
function CardSetupForm({ clientSecret, onSaved, onCancel }: {
  clientSecret: string;
  onSaved: (card: { brand: string | null; last4: string | null }) => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async () => {
    if (!stripe || !elements || !user) return;
    setSaving(true);
    setErr(null);

    // Never stripe.confirmSetup() directly — saving a card runs the same 3D
    // Secure challenge a payment does, and breaks the same two ways when the
    // bank sends the payer into their banking app. See lib/confirm-payment.ts.
    const { error, setupIntent } = await confirmCardSetup({ stripe, elements, clientSecret });
    if (error) { setErr(error.message ?? "Could not save card."); setSaving(false); return; }

    const pmId = paymentMethodIdOf(setupIntent?.payment_method);
    if (!pmId) { setErr("No card was returned. Try again."); setSaving(false); return; }

    const card = await persistSavedCard(user.id, pmId);
    setSaving(false);
    onSaved(card);
  };

  return (
    <div className="space-y-3">
      <div className="bg-surface border border-border shadow-card rounded-card p-4">
        <PaymentElement options={{ layout: "tabs", paymentMethodOrder: ["card"] }} />
      </div>
      <TestModeNote />
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold text-text-secondary">Cancel</button>
        <button onClick={handleSave} disabled={!stripe || saving}
          className="flex-1 py-2.5 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-50">
          {saving ? "Saving…" : "Save Card"}
        </button>
      </div>
    </div>
  );
}

// ── Card-on-file section (lives on the profile) ───────────────────────────────
function PaymentMethodSection() {
  const { user } = useAuth();
  const [card, setCard] = useState<{ brand: string | null; last4: string | null } | null | undefined>(undefined);
  // No customer id here any more: /api/create-setup-intent writes it to the
  // profile itself, so the form no longer has to carry it across a 3D Secure
  // round trip it may not survive.
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles")
      .select("stripe_payment_method_id, card_brand, card_last4")
      .eq("id", user.id).maybeSingle()
      .then(({ data }) => {
        setCard(data?.stripe_payment_method_id ? { brand: data.card_brand, last4: data.card_last4 } : null);
      });
  }, [user]);

  const startSetup = async () => {
    if (!user) return;
    setStarting(true); setErr(null);
    try {
      const res = await authedPost("/api/create-setup-intent", {});
      const d = await res.json();
      if (d.clientSecret) setSetupSecret(d.clientSecret);
      else setErr(d.error ?? "Could not start card setup. Check Stripe keys in .env.local");
    } catch { setErr("Could not connect to payment service."); }
    setStarting(false);
  };

  const removeCard = async () => {
    if (!user) return;
    await supabase.from("profiles")
      .update({ stripe_payment_method_id: null, card_brand: null, card_last4: null })
      .eq("id", user.id);
    setCard(null);
  };

  if (card === undefined) return null;

  return (
    <section>
      <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Payment Method</h3>
      <div className="bg-surface border border-border shadow-card rounded-card p-4 space-y-3">
        <p className="text-xs text-text-secondary leading-relaxed">
          Save a card so your share of match fees is charged automatically when your squad
          is confirmed — no need to pay manually after every game.
        </p>

        {card && !setupSecret && (
          <div className="flex items-center gap-3 bg-background border border-border rounded-xl px-3 py-2.5">
            <div className="w-9 h-9 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2" strokeLinecap="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold capitalize">{card.brand ?? "Card"} •••• {card.last4 ?? "????"}</p>
              <p className="text-[11px] text-accent-ink">Saved · ready for auto-settlement</p>
            </div>
            <button onClick={removeCard} className="text-xs text-red-600 font-medium flex-shrink-0">Remove</button>
          </div>
        )}

        {setupSecret ? (
          <Elements stripe={stripePromise} options={{ clientSecret: setupSecret, appearance: stripeAppearance }}>
            <CardSetupForm
              clientSecret={setupSecret}
              onCancel={() => setSetupSecret(null)}
              onSaved={(c) => { setCard(c); setSetupSecret(null); }}
            />
          </Elements>
        ) : (
          <button onClick={startSetup} disabled={starting}
            className="w-full py-2.5 rounded-btn bg-accent/10 border border-accent/30 text-sm text-accent-ink font-semibold disabled:opacity-50">
            {starting ? "Starting…" : card ? "Update card" : "Add a card"}
          </button>
        )}

        {err && <p className="text-xs text-red-600">{err}</p>}
      </div>
    </section>
  );
}

type Profile = {
  full_name: string;
  position: string | null;
  location: string | null;
  experience: string | null;
};

// Stats and video are switched off for the pilot. Greyed rather than deleted:
// the house convention is that a missing element shifts everything around it
// and breaks muscle memory (see components/QuickNav.tsx), and a player who
// looks for their stats should find out they are coming, not that they are
// gone. A placeholder rather than dimmed sample data — greying out invented
// numbers still shows invented numbers.
function PilotDisabledSection({ title, blurb }: { title: string; blurb: string }) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3 opacity-50">{title}</h3>
      <div className="bg-surface-2 border border-dashed border-border rounded-card p-5 text-center opacity-60 select-none">
        <p className="text-sm font-semibold text-text-secondary mb-1">Not available yet</p>
        <p className="text-xs text-text-secondary">{blurb}</p>
      </div>
    </section>
  );
}

type Friend = { id: string; name: string; position: string | null };

// Real friendships, from the same friend_requests rows the Transfer Market
// writes — an accepted request in either direction. Previously this was three
// invented players, so the count on every profile read "3" forever.
//
// friend_requests points at auth.users, which has no relationship to profiles
// registered in the schema cache, so the names are fetched separately (an
// embedded select would fail the whole query with PGRST200).
function useFriends(userId: string | undefined) {
  const [friends, setFriends] = useState<Friend[]>([]);

  useEffect(() => {
    if (!userId) { setFriends([]); return; }
    let cancelled = false;
    (async () => {
      const { data: rows, error } = await supabase
        .from("friend_requests")
        .select("from_player_id, to_player_id")
        .eq("status", "accepted")
        .or(`from_player_id.eq.${userId},to_player_id.eq.${userId}`);
      // supabase_transfer_market.sql may not have been run — degrade to an
      // empty list rather than breaking the page.
      if (error || !rows || rows.length === 0) { if (!cancelled) setFriends([]); return; }

      const otherIds = Array.from(new Set(
        rows.map((r) => (r.from_player_id === userId ? r.to_player_id : r.from_player_id) as string)
      ));
      const { data: profiles } = await supabase
        .from("profiles").select("id, full_name, position").in("id", otherIds);
      if (cancelled) return;
      setFriends((profiles ?? []).map((p) => ({
        id: p.id as string,
        name: (p.full_name as string) || "Player",
        position: (p.position as string) || null,
      })).sort((a, b) => a.name.localeCompare(b.name)));
    })();
    return () => { cancelled = true; };
  }, [userId]);

  return friends;
}

function ProfileContent({ isCaptain, profile, teamName }: { isCaptain: boolean; profile: Profile | null; teamName: string | null }) {
  const { signOut, user } = useAuth();
  const name = profile?.full_name ?? "Player";
  const initials = name.split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const subtitle = [profile?.position, profile?.location].filter(Boolean).join(" · ") || "No position set";
  const [modal, setModal] = useState<"friends" | null>(null);
  const friends = useFriends(user?.id);

  // The stats sections below are disabled for the pilot, so nothing reads a
  // player's record and the queries that fed them are gone rather than run and
  // thrown away on every profile view. To switch stats back on, restore:
  //   • loadPlayerStats(user.id) from lib/stats.ts — career totals, not
  //     team-scoped, so a player's record survives a transfer
  //   • select rating from admin_player_ratings where player_id = user.id —
  //     organiser ratings from hosted events, averaged. The table may not
  //     exist (supabase_admin_hosting.sql unrun), so it must degrade to null.

  return (
    <div className="flex flex-col gap-6">
      {/* Avatar */}
      <section className="flex flex-col items-center">
        <div className="w-20 h-20 rounded-full bg-accent/10 border-2 border-accent flex items-center justify-center mb-3">
          <span className="text-2xl font-extrabold text-accent-ink">{initials}</span>
        </div>
        <h2 className="text-xl font-extrabold">{name}</h2>
        <p className="text-text-secondary text-sm mt-0.5">{subtitle}</p>
        {isCaptain && teamName && (
          <span className="mt-2 text-xs font-semibold bg-accent/10 text-accent-ink border border-accent/30 px-3 py-1 rounded-full">
            Captain — {teamName}
          </span>
        )}
        {/* Only what the player actually told us. Preferred foot and years of
            experience were hardcoded strings and are gone — registration never
            asks for either. Position was hardcoded "CAM" too; it is real now. */}
        {(profile?.position || profile?.experience) && (
          <div className="flex gap-2 mt-3 flex-wrap justify-center">
            {profile?.position && (
              <span className="text-xs bg-accent/10 text-accent-ink border border-accent/30 px-3 py-1 rounded-full font-medium">{profile.position}</span>
            )}
            {profile?.experience && (
              <span className="text-xs bg-surface-2 text-text-secondary border border-border px-3 py-1 rounded-full font-medium">{profile.experience}</span>
            )}
          </div>
        )}

        {/* Friends count. "Bookmarked Teams" sat beside this with two invented
            clubs behind it; nothing anywhere persists a bookmark, so it is gone
            rather than greyed — there is no feature waiting to be switched on. */}
        <div className="flex gap-6 mt-4">
          <button onClick={() => setModal("friends")} className="flex flex-col items-center gap-0.5">
            <span className="text-lg font-bold">{friends.length}</span>
            <span className="text-xs text-text-secondary">{friends.length === 1 ? "Friend" : "Friends"}</span>
          </button>
        </div>
      </section>

      <button className="w-full py-3 rounded-xl border border-accent text-accent-ink font-semibold text-sm">
        Edit Profile
      </button>

      <PaymentMethodSection />

      {/* Friends modal */}
      {modal === "friends" && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim" onClick={() => setModal(null)}>
          <div className="w-full max-w-lg bg-surface border-t border-border rounded-t-2xl p-5 pb-8 max-h-[85dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <p className="font-bold text-base">Friends ({friends.length})</p>
              <button onClick={() => setModal(null)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="space-y-2">
              {friends.length === 0 ? (
                <p className="text-xs text-text-secondary text-center py-6">
                  No friends yet. Send a friend request from the Transfer Market or Search.
                </p>
              ) : friends.map((f) => {
                const fi = f.name.split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                return (
                  <div key={f.id} className="flex items-center gap-3 bg-surface border border-border rounded-btn px-4 py-3">
                    <div className="w-9 h-9 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-accent-ink">{fi}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{f.name}</p>
                      <p className="text-xs text-text-secondary">{f.position ?? "No position set"}</p>
                    </div>
                    {/* Straight into the thread with that player, not the inbox. */}
                    <a href={`/messages/${f.id}`} className="w-7 h-7 rounded-full border border-border bg-surface flex items-center justify-center flex-shrink-0">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                      </svg>
                    </a>
                  </div>
                );
              })}
            </div>
            <a href="/search" className="block w-full mt-4 py-2.5 rounded-xl border border-border text-sm font-semibold text-text-secondary text-center">
              Find more friends
            </a>
          </div>
        </div>
      )}

      {/* Badges were four hardcoded awards ("Hat-trick Hero", "Top Scorer")
          with nothing behind them, and no way to earn one. Removed outright
          rather than greyed — unlike stats, it is not a feature waiting to be
          switched on, so there is nothing to promise. */}
      <PilotDisabledSection
        title="Season Stats"
        blurb="Games, goals and assists start recording once match results go live after the pilot."
      />

      <PilotDisabledSection
        title="My Stats"
        blurb="Start rate, goals and assists per game are derived from match results, which are off during the pilot."
      />

      <PilotDisabledSection
        title="Individual Highlights"
        blurb="Uploading and watching match clips arrives after the pilot, once video ingestion is built."
      />

      {isCaptain && (
        <a href="/my-team" className="w-full py-3 rounded-btn bg-accent text-white font-bold text-sm text-center block">
          Manage My Team
        </a>
      )}

      <button
        onClick={() => signOut()}
        className="w-full py-3 rounded-xl border border-border text-text-secondary font-semibold text-sm flex items-center justify-center gap-2"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
        Sign Out
      </button>
    </div>
  );
}

export default function ProfilePage() {
  const { role, roleLoading } = useRole();
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [teamName, setTeamName] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("full_name, position, location, experience").eq("id", user.id).maybeSingle()
      .then(({ data }) => { if (data) setProfile(data as Profile); });
    supabase.from("teams").select("name").eq("captain_id", user.id).maybeSingle()
      .then(({ data }) => { if (data) setTeamName(data.name as string); });
  }, [user]);

  if (roleLoading) return <div className="flex items-center justify-center min-h-screen"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;

  return (
    <div className="flex flex-col min-h-screen px-4 pt-16">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-extrabold">Profile</h1>
      </header>
      {role === "new_user" && !user && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <div className="w-16 h-16 rounded-full bg-surface-2 border border-border flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="1.5" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </div>
          <p className="text-sm font-semibold">No profile yet</p>
          <p className="text-xs text-text-secondary text-center max-w-[220px]">Create an account to build your player profile and track your stats.</p>
          <div className="flex gap-3">
            <a href="/register" className="px-6 py-3 rounded-btn bg-accent text-white font-bold text-sm">Create Account</a>
            <a href="/login" className="px-6 py-3 rounded-xl border border-border text-text-primary font-bold text-sm">Sign In</a>
          </div>
        </div>
      )}
      {role === "new_user" && user && (
        <ProfileContent isCaptain={false} profile={profile} teamName={null} />
      )}
      {role !== "new_user" && (
        <ProfileContent isCaptain={role === "captain"} profile={profile} teamName={teamName} />
      )}
    </div>
  );
}
