"use client";

import { useEffect, useState } from "react";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { stripePromise } from "@/lib/stripe-client";
import { useRole } from "@/contexts/RoleContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

const stripeAppearance = {
  theme: "night" as const,
  variables: {
    colorPrimary: "#00E676",
    colorBackground: "#1a1a1a",
    colorText: "#ffffff",
    colorDanger: "#f87171",
    borderRadius: "12px",
    fontFamily: "system-ui, sans-serif",
  },
};

// ── Card-on-file: SetupIntent form (saves a card for off-session settlement) ──
function CardSetupForm({ customerId, onSaved, onCancel }: {
  customerId: string | null;
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

    const { error, setupIntent } = await stripe.confirmSetup({ elements, redirect: "if_required" });
    if (error) { setErr(error.message ?? "Could not save card."); setSaving(false); return; }

    const pm = setupIntent?.payment_method;
    const pmId = typeof pm === "string" ? pm : pm?.id;
    if (!pmId) { setErr("No card was returned. Try again."); setSaving(false); return; }

    let brand: string | null = null, last4: string | null = null;
    try {
      const res = await fetch("/api/payment-method", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethodId: pmId }),
      });
      const d = await res.json();
      brand = d.brand ?? null; last4 = d.last4 ?? null;
    } catch { /* brand/last4 are cosmetic — saving the card still succeeds */ }

    await supabase.from("profiles").update({
      stripe_customer_id: customerId,
      stripe_payment_method_id: pmId,
      card_brand: brand,
      card_last4: last4,
    }).eq("id", user.id);

    setSaving(false);
    onSaved({ brand, last4 });
  };

  return (
    <div className="space-y-3">
      <div className="bg-surface-2 border border-border rounded-2xl p-4">
        <PaymentElement options={{ layout: "tabs", paymentMethodOrder: ["card"] }} />
      </div>
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl px-4 py-3">
        <p className="text-[11px] text-blue-300 font-semibold mb-0.5">Test Mode</p>
        <p className="text-[11px] text-blue-200 leading-relaxed">
          Use card <span className="font-mono font-bold">4242 4242 4242 4242</span> · any future expiry · any 3-digit CVC
        </p>
      </div>
      {err && <p className="text-xs text-red-400">{err}</p>}
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold text-text-secondary">Cancel</button>
        <button onClick={handleSave} disabled={!stripe || saving}
          className="flex-1 py-2.5 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50">
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
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles")
      .select("stripe_customer_id, stripe_payment_method_id, card_brand, card_last4")
      .eq("id", user.id).maybeSingle()
      .then(({ data }) => {
        setCustomerId(data?.stripe_customer_id ?? null);
        setCard(data?.stripe_payment_method_id ? { brand: data.card_brand, last4: data.card_last4 } : null);
      });
  }, [user]);

  const startSetup = async () => {
    if (!user) return;
    setStarting(true); setErr(null);
    try {
      const res = await fetch("/api/create-setup-intent", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, email: user.email }),
      });
      const d = await res.json();
      if (d.clientSecret) { setSetupSecret(d.clientSecret); setCustomerId(d.customerId); }
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
      <div className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
        <p className="text-xs text-text-secondary leading-relaxed">
          Save a card so your share of match fees is charged automatically when your squad
          is confirmed — no need to pay manually after every game.
        </p>

        {card && !setupSecret && (
          <div className="flex items-center gap-3 bg-background border border-border rounded-xl px-3 py-2.5">
            <div className="w-9 h-9 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold capitalize">{card.brand ?? "Card"} •••• {card.last4 ?? "????"}</p>
              <p className="text-[11px] text-accent">Saved · ready for auto-settlement</p>
            </div>
            <button onClick={removeCard} className="text-xs text-red-400 font-medium flex-shrink-0">Remove</button>
          </div>
        )}

        {setupSecret ? (
          <Elements stripe={stripePromise} options={{ clientSecret: setupSecret, appearance: stripeAppearance }}>
            <CardSetupForm
              customerId={customerId}
              onCancel={() => setSetupSecret(null)}
              onSaved={(c) => { setCard(c); setSetupSecret(null); }}
            />
          </Elements>
        ) : (
          <button onClick={startSetup} disabled={starting}
            className="w-full py-2.5 rounded-xl bg-accent/10 border border-accent/30 text-sm text-accent font-semibold disabled:opacity-50">
            {starting ? "Starting…" : card ? "Update card" : "Add a card"}
          </button>
        )}

        {err && <p className="text-xs text-red-400">{err}</p>}
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

const stats = [
  { label: "Games", value: "47" },
  { label: "Goals", value: "23" },
  { label: "Assists", value: "31" },
  { label: "Rating", value: "8.7" },
];

const badges = [
  { label: "Hat-trick Hero", icon: "⚽" },
  { label: "Team Player", icon: "🤝" },
  { label: "Top Scorer", icon: "🏆" },
  { label: "Consistent", icon: "🔥" },
];

const FRIENDS = [
  { name: "Marcus Webb", position: "GK", avatar: "MW" },
  { name: "Liam Foster", position: "CAM", avatar: "LF" },
  { name: "Devon King", position: "ST", avatar: "DK" },
];

const BOOKMARKED_TEAMS = [
  { name: "Hackney United", level: "Competitive", location: "Hackney Marshes" },
  { name: "Shoreditch Rovers", level: "Semi-Pro", location: "Powerleague Shoreditch" },
];

function ProfileContent({ isCaptain, profile, teamName }: { isCaptain: boolean; profile: Profile | null; teamName: string | null }) {
  const { signOut } = useAuth();
  const name = profile?.full_name ?? "Player";
  const initials = name.split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const subtitle = [profile?.position, profile?.location].filter(Boolean).join(" · ") || "No position set";
  const [modal, setModal] = useState<"friends" | "teams" | null>(null);

  return (
    <div className="flex flex-col gap-6">
      {/* Avatar */}
      <section className="flex flex-col items-center">
        <div className="w-20 h-20 rounded-full bg-accent/10 border-2 border-accent flex items-center justify-center mb-3">
          <span className="text-2xl font-bold text-accent">{initials}</span>
        </div>
        <h2 className="text-xl font-bold">{name}</h2>
        <p className="text-text-secondary text-sm mt-0.5">{subtitle}</p>
        {isCaptain && teamName && (
          <span className="mt-2 text-xs font-semibold bg-accent/10 text-accent border border-accent/30 px-3 py-1 rounded-full">
            Captain — {teamName}
          </span>
        )}
        <div className="flex gap-2 mt-3 flex-wrap justify-center">
          <span className="text-xs bg-accent/10 text-accent border border-accent/30 px-3 py-1 rounded-full font-medium">CAM</span>
          <span className="text-xs bg-surface-2 text-text-secondary border border-border px-3 py-1 rounded-full font-medium">Right Foot</span>
          <span className="text-xs bg-surface-2 text-text-secondary border border-border px-3 py-1 rounded-full font-medium">6 years exp.</span>
        </div>

        {/* Friends & Bookmarked Teams counts */}
        <div className="flex gap-6 mt-4">
          <button onClick={() => setModal("friends")} className="flex flex-col items-center gap-0.5">
            <span className="text-lg font-bold">{FRIENDS.length}</span>
            <span className="text-xs text-text-secondary">Friends</span>
          </button>
          <div className="w-px bg-border" />
          <button onClick={() => setModal("teams")} className="flex flex-col items-center gap-0.5">
            <span className="text-lg font-bold">{BOOKMARKED_TEAMS.length}</span>
            <span className="text-xs text-text-secondary">Bookmarked Teams</span>
          </button>
        </div>
      </section>

      <button className="w-full py-3 rounded-xl border border-accent text-accent font-semibold text-sm">
        Edit Profile
      </button>

      <PaymentMethodSection />

      {/* Friends modal */}
      {modal === "friends" && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setModal(null)}>
          <div className="w-full max-w-lg bg-surface border-t border-border rounded-t-2xl p-5 pb-8 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <p className="font-bold text-base">Friends ({FRIENDS.length})</p>
              <button onClick={() => setModal(null)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="space-y-2">
              {FRIENDS.map((f) => (
                <div key={f.name} className="flex items-center gap-3 bg-surface-2 border border-border rounded-xl px-4 py-3">
                  <div className="w-9 h-9 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-accent">{f.avatar}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{f.name}</p>
                    <p className="text-xs text-text-secondary">{f.position}</p>
                  </div>
                  <a href="/messages" className="w-7 h-7 rounded-full border border-border bg-surface flex items-center justify-center flex-shrink-0">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                  </a>
                </div>
              ))}
            </div>
            <a href="/search" className="block w-full mt-4 py-2.5 rounded-xl border border-border text-sm font-semibold text-text-secondary text-center">
              Find more friends
            </a>
          </div>
        </div>
      )}

      {/* Bookmarked Teams modal */}
      {modal === "teams" && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setModal(null)}>
          <div className="w-full max-w-lg bg-surface border-t border-border rounded-t-2xl p-5 pb-8 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <p className="font-bold text-base">Bookmarked Teams ({BOOKMARKED_TEAMS.length})</p>
              <button onClick={() => setModal(null)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="space-y-2">
              {BOOKMARKED_TEAMS.map((t) => {
                const ti = t.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                return (
                  <div key={t.name} className="flex items-center gap-3 bg-surface-2 border border-border rounded-xl px-4 py-3">
                    <div className="w-9 h-9 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-text-secondary">{ti}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{t.name}</p>
                      <p className="text-xs text-text-secondary">{t.level} · {t.location}</p>
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="#00E676" stroke="#00E676" strokeWidth="2" strokeLinecap="round">
                      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                    </svg>
                  </div>
                );
              })}
            </div>
            <a href="/search" className="block w-full mt-4 py-2.5 rounded-xl border border-border text-sm font-semibold text-text-secondary text-center">
              Browse more teams
            </a>
          </div>
        </div>
      )}

      {/* Stats */}
      <section>
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Season Stats</h3>
        <div className="grid grid-cols-4 gap-2">
          {stats.map((s) => (
            <div key={s.label} className="bg-surface-2 border border-border rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-accent">{s.value}</p>
              <p className="text-[10px] text-text-secondary mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Badges */}
      <section>
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Badges</h3>
        <div className="grid grid-cols-2 gap-2">
          {badges.map((b) => (
            <div key={b.label} className="bg-surface-2 border border-border rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="text-xl">{b.icon}</span>
              <p className="text-sm font-medium">{b.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* My Stats */}
      <section>
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">My Stats</h3>
        <div className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
          {[
            { label: "Win Rate", value: "72%", bar: 72 },
            { label: "Goals Per Game", value: "0.49", bar: 49 },
            { label: "Pass Accuracy", value: "84%", bar: 84 },
          ].map((s) => (
            <div key={s.label}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-text-secondary">{s.label}</span>
                <span className="font-semibold">{s.value}</span>
              </div>
              <div className="w-full h-1.5 bg-background rounded-full">
                <div className="h-1.5 bg-accent rounded-full" style={{ width: `${s.bar}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Individual Highlights */}
      <section>
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Individual Highlights</h3>
        <div className="space-y-3">
          {[
            { id: "h1", title: "Goal vs Regents FC", match: "Feb 15, 2026 · 11v11", duration: "0:18", tag: "Goal" },
            { id: "h2", title: "Through-ball assist vs Dalston Athletic", match: "Jan 22, 2026 · League", duration: "0:24", tag: "Assist" },
            { id: "h3", title: "Man of the Match — vs East End FC", match: "Jan 8, 2026 · Friendly", duration: "1:02", tag: "MOTM" },
          ].map((clip) => (
            <div key={clip.id} className="bg-surface-2 border border-border rounded-2xl overflow-hidden">
              <div className="relative w-full" style={{ paddingBottom: "48%", background: "linear-gradient(135deg, #1a0a2e 0%, #2a1040 50%, #150820 100%)" }}>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-12 h-12 rounded-full bg-black/40 border border-white/20 flex items-center justify-center">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  </div>
                </div>
                <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded">{clip.duration}</div>
                <div className="absolute top-2 left-2">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${clip.tag === "Goal" ? "bg-red-500/80 text-white" : clip.tag === "Assist" ? "bg-blue-500/80 text-white" : "bg-accent/80 text-black"}`}>
                    {clip.tag}
                  </span>
                </div>
              </div>
              <div className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">{clip.title}</p>
                  <p className="text-xs text-text-secondary mt-0.5">{clip.match}</p>
                </div>
                <button className="text-xs text-accent font-medium flex items-center gap-1">
                  Share
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {isCaptain && (
        <a href="/my-team" className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm text-center block">
          Manage My Team
        </a>
      )}


      <button
        onClick={signOut}
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
        <h1 className="text-2xl font-bold">Profile</h1>
      </header>
      {role === "new_user" && !user && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <div className="w-16 h-16 rounded-full bg-surface-2 border border-border flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="1.5" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </div>
          <p className="text-sm font-semibold">No profile yet</p>
          <p className="text-xs text-text-secondary text-center max-w-[220px]">Create an account to build your player profile and track your stats.</p>
          <div className="flex gap-3">
            <a href="/register" className="px-6 py-3 rounded-xl bg-accent text-black font-bold text-sm">Create Account</a>
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
