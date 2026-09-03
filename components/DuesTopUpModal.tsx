"use client";

import { useCallback, useEffect, useState } from "react";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { supabase } from "@/lib/supabase";
import { stripePromise } from "@/lib/stripe-client";
import { useSaveCardOffer } from "@/components/SaveCardPrompt";
import { waitForCredit } from "@/lib/credit-sync";
import { authedPost } from "@/lib/authed-fetch";
import { fmtFee, useJoiningFee } from "@/lib/joining-fee";

// Full "Pay & Top Up" popup: the itemised match fees the captain has requested
// from this player, each payable on its own, plus a manual top-up. Paying a due
// refills the team's credit balance and marks that charge settled.
//
// Extracted from the My Team credits bar so the home screen can offer the same
// thing without a redirect. NOTE: My Team still carries its own copy of this
// flow — until that is migrated onto this component, any change to the payment
// logic here has to be mirrored in app/my-team/page.tsx.

export type MyDue = {
  pcsId: string;
  matchId: string;
  kind: "match" | "tournament";
  opponent: string;
  date: string;
  remainingPence: number;
  sharePence: number;
};

export type SavedCard = { customerId: string; paymentMethodId: string; last4: string | null };

// Apply a completed payment toward a single targeted due (targetPcsId) or the
// player's own outstanding fees, oldest-game-first.
//
// This is the bookkeeping half ONLY. The team's credit is added server-side —
// by the Stripe webhook for manual card entry, or by /api/settle-match for a
// saved card — because the browser cannot prove a payment happened.
export async function applyTopUp(
  userId: string,
  amountPence: number,
  targetPcsId?: string
): Promise<void> {
  if (targetPcsId) {
    const { data: row } = await supabase.from("payment_collection_status")
      .select("share_pence").eq("id", targetPcsId).maybeSingle();
    await supabase.from("payment_collection_status").update({
      credited_pence: row?.share_pence ?? amountPence,
      received: true,
      updated_at: new Date().toISOString(),
    }).eq("id", targetPcsId);
    return;
  }

  let remaining = amountPence;
  const { data: dueRowsRaw } = await supabase.from("payment_collection_status")
    .select("id, match_id, share_pence, credited_pence").eq("player_id", userId).eq("included", true);
  const dueMatchIds = [...new Set((dueRowsRaw ?? []).map((r) => r.match_id))];
  const { data: dueMatches } = dueMatchIds.length > 0
    ? await supabase.from("matches").select("id, match_date").in("id", dueMatchIds)
    : { data: [] as { id: string; match_date: string }[] };
  const matchDateById = new Map((dueMatches ?? []).map((m) => [m.id, m.match_date as string]));
  const dueRows = [...(dueRowsRaw ?? [])].sort((a, b) =>
    (matchDateById.get(a.match_id) ?? "").localeCompare(matchDateById.get(b.match_id) ?? "")
  );
  for (const row of dueRows) {
    if (remaining <= 0) break;
    const need = row.share_pence - (row.credited_pence ?? 0);
    if (need <= 0) continue;
    const applied = Math.min(remaining, need);
    const newCredited = (row.credited_pence ?? 0) + applied;
    await supabase.from("payment_collection_status").update({
      credited_pence: newCredited,
      received: newCredited >= row.share_pence,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    remaining -= applied;
  }
}

// ── Dues data ─────────────────────────────────────────────────
// A charge targets either a match or a tournament entry, so each set of labels
// is resolved from its own table rather than assuming match_id is present.
export function useMyDues(teamId: string | null, userId: string) {
  const [dues, setDues] = useState<MyDue[]>([]);
  const [owedPence, setOwedPence] = useState(0);

  const reload = useCallback(async () => {
    if (!teamId) return;
    const { data: rows } = await supabase.from("payment_collection_status")
      .select("id, match_id, open_match_id, share_pence, credited_pence")
      .eq("player_id", userId).eq("included", true).eq("received", false);
    const pending = (rows ?? [])
      .map((r) => ({ ...r, remaining: r.share_pence - (r.credited_pence ?? 0) }))
      .filter((r) => r.remaining > 0);
    if (pending.length === 0) { setDues([]); setOwedPence(0); return; }

    const matchIds = [...new Set(pending.map((r) => r.match_id).filter(Boolean))] as string[];
    const omIds = [...new Set(pending.map((r) => r.open_match_id).filter(Boolean))] as string[];
    const [{ data: ms }, { data: oms }] = await Promise.all([
      matchIds.length
        ? supabase.from("matches").select("id, posting_team_id, challenging_team_id, match_date").in("id", matchIds)
        : Promise.resolve({ data: [] as { id: string; posting_team_id: string; challenging_team_id: string; match_date: string }[] }),
      omIds.length
        ? supabase.from("open_matches").select("id, title, match_date").in("id", omIds)
        : Promise.resolve({ data: [] as { id: string; title: string; match_date: string }[] }),
    ]);
    const matchById = new Map((ms ?? []).map((m) => [m.id, m]));
    const omById = new Map((oms ?? []).map((o) => [o.id, o]));
    const oppIds = [...new Set((ms ?? []).map((m) => (m.posting_team_id === teamId ? m.challenging_team_id : m.posting_team_id)))];
    const { data: teamsData } = oppIds.length
      ? await supabase.from("teams").select("id, name").in("id", oppIds)
      : { data: [] as { id: string; name: string }[] };
    const teamName = new Map((teamsData ?? []).map((t) => [t.id, t.name as string]));

    const mapped: MyDue[] = pending.map((r) => {
      if (r.open_match_id) {
        const t = omById.get(r.open_match_id);
        return {
          pcsId: r.id, matchId: r.open_match_id, kind: "tournament" as const,
          opponent: t?.title || "Tournament", date: t?.match_date ?? "",
          remainingPence: r.remaining, sharePence: r.share_pence,
        };
      }
      const m = matchById.get(r.match_id);
      const oppId = m ? (m.posting_team_id === teamId ? m.challenging_team_id : m.posting_team_id) : null;
      return {
        pcsId: r.id, matchId: r.match_id, kind: "match" as const,
        opponent: oppId ? (teamName.get(oppId) ?? "Opponent") : "Opponent",
        date: m?.match_date ?? "",
        remainingPence: r.remaining, sharePence: r.share_pence,
      };
    }).sort((a, b) => a.date.localeCompare(b.date));

    setDues(mapped);
    setOwedPence(mapped.reduce((sum, d) => sum + d.remainingPence, 0));
  }, [teamId, userId]);

  useEffect(() => { reload(); }, [reload]);

  return { dues, owedPence, reload };
}

// ── Card entry step ───────────────────────────────────────────
function CreditsCheckoutForm({ amount, teamId, userId, currentCredits, targetPcsId, skipDuesApply, onSuccess, onBack }: {
  amount: number; teamId: string; userId: string; currentCredits: number;
  targetPcsId?: string;
  // A joining-fee payment: the deposit is applied to the fee server-side by
  // credit_from_payment, and must not tick off match-due bookkeeping here.
  skipDuesApply?: boolean;
  onSuccess: (newBalance: number, paymentIntentId: string) => void; onBack: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const handlePay = async () => {
    if (!stripe || !elements) return;
    setPaying(true);
    setPayError(null);
    const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (error) { setPayError(error.message ?? "Payment failed."); setPaying(false); return; }
    if (paymentIntent?.status === "succeeded") {
      if (!skipDuesApply) await applyTopUp(userId, Math.round(amount * 100), targetPcsId);
      // Credit lands via the Stripe webhook — wait for it rather than assuming.
      const settled = await waitForCredit(teamId, Math.round(currentCredits * 100));
      onSuccess(settled !== null ? settled / 100 : currentCredits + amount, paymentIntent.id);
    } else {
      setPayError("Payment did not complete. Please try again.");
      setPaying(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-surface border border-border rounded-btn px-4 py-3 text-xs space-y-1.5">
        <div className="flex justify-between text-text-secondary"><span>Adding to team credits</span><span className="font-bold text-text-primary">£{amount.toFixed(2)}</span></div>
        <div className="flex justify-between text-text-secondary"><span>New balance</span><span className="font-bold text-accent-ink">£{(currentCredits + amount).toFixed(2)}</span></div>
      </div>
      <div className="bg-surface border border-border rounded-btn p-4">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">Card Details</p>
        <PaymentElement options={{ layout: "tabs", paymentMethodOrder: ["card"] }} />
      </div>
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl px-4 py-3">
        <p className="text-[11px] text-blue-300 font-semibold mb-0.5">Test Mode</p>
        <p className="text-[11px] text-blue-200">Use <span className="font-mono font-bold">4242 4242 4242 4242</span> · any future expiry · any CVC</p>
      </div>
      {payError && <p className="text-xs text-red-600 text-center">{payError}</p>}
      <button onClick={handlePay} disabled={!stripe || paying}
        className="w-full py-3.5 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-50">
        {paying ? "Processing…" : `Pay £${amount.toFixed(2)}`}
      </button>
      <button onClick={onBack} className="w-full py-2 text-xs text-text-secondary">← Back</button>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────
export default function DuesTopUpModal({ teamId, userId, onClose, onBalanceChange }: {
  teamId: string;
  userId: string;
  onClose: () => void;
  onBalanceChange?: (balancePence: number) => void;
}) {
  const { dues, owedPence, reload: reloadDues } = useMyDues(teamId, userId);
  // Server-side, any deposit pays the joining fee down first
  // (supabase_joining_fees.sql) — so "pay your joining fee" is just a top-up
  // of at least the outstanding amount, and this only reads the result.
  const { owedPence: feeOwedPence, duePence: feeDuePence, reload: reloadFee } = useJoiningFee(teamId, userId);
  const [credits, setCredits] = useState<number | null>(null);
  const [savedCard, setSavedCard] = useState<SavedCard | null>(null);

  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customInput, setCustomInput] = useState("");
  const [payTarget, setPayTarget] = useState<{ pcsId: string; amountPence: number } | null>(null);
  const [feeTargeted, setFeeTargeted] = useState(false);  // current card entry is for the joining fee
  const [feeBusy, setFeeBusy] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loadingIntent, setLoadingIntent] = useState(false);
  const [intentError, setIntentError] = useState<string | null>(null);
  const [dueError, setDueError] = useState<string | null>(null);
  const [dueBusy, setDueBusy] = useState<Set<string>>(new Set());
  const [duePaidFlash, setDuePaidFlash] = useState(false);
  const [topUpBusy, setTopUpBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const saveCard = useSaveCardOffer(userId);

  const setBalance = useCallback((pounds: number) => {
    setCredits(pounds);
    onBalanceChange?.(Math.round(pounds * 100));
  }, [onBalanceChange]);

  useEffect(() => {
    supabase.from("team_credits").select("balance_pence").eq("team_id", teamId).maybeSingle()
      .then(({ data }) => setCredits((data?.balance_pence ?? 0) / 100));

    supabase.from("profiles").select("stripe_customer_id, stripe_payment_method_id, card_last4").eq("id", userId).maybeSingle()
      .then(({ data }) => {
        if (data?.stripe_customer_id && data?.stripe_payment_method_id) {
          setSavedCard({
            customerId: data.stripe_customer_id,
            paymentMethodId: data.stripe_payment_method_id,
            last4: data.card_last4 ?? null,
          });
        }
      });
  }, [teamId, userId]);

  const effectiveAmount = payTarget
    ? payTarget.amountPence / 100
    : selectedAmount ?? (customInput ? parseFloat(customInput) : null);

  // Clear a paid-off due locally and mark the row. The credit itself was
  // already applied by /api/settle-match, which returns the resulting balance
  // — a realtime event isn't guaranteed to reach the payer's own browser
  // in time, so set it directly from that.
  const applyDuePaid = async (due: MyDue, newBalancePence: number | null) => {
    if (typeof newBalancePence === "number") setBalance(newBalancePence / 100);
    await supabase.from("payment_collection_status")
      .update({ credited_pence: due.sharePence, received: true, updated_at: new Date().toISOString() })
      .eq("id", due.pcsId);
    // Any deposit also pays the joining fee down server-side.
    await Promise.all([reloadDues(), reloadFee()]);
  };

  const payDueWithCard = async (due: MyDue) => {
    if (!savedCard) return;
    setDueBusy((prev) => new Set(prev).add(due.pcsId));
    setDueError(null);
    try {
      // pcsId lets the route read the outstanding amount off the due row and
      // check it belongs to the caller, rather than trusting either from here.
      const res = await authedPost("/api/settle-match", {
        items: [{
          pcsId: due.pcsId,
          amountPence: due.remainingPence,
          sharePence: due.remainingPence,
          feePence: 0,
          teamId,   // the route refills this team's credit once the charge clears
          // Stripe metadata only — a tournament due carries its open_match id.
          matchId: due.kind === "match" ? due.matchId : undefined,
          openMatchId: due.kind === "tournament" ? due.matchId : undefined,
        }],
      });
      const data = await res.json();
      const r = data.results?.[0];
      if (r?.ok) {
        await applyDuePaid(due, r.creditedBalancePence ?? null);
        setDuePaidFlash(true);
      } else {
        setDueError(r?.error ?? data.error ?? "Card was declined — try topping up manually.");
      }
    } catch {
      setDueError("Payment failed. Please try again.");
    }
    setDueBusy((prev) => { const n = new Set(prev); n.delete(due.pcsId); return n; });
  };

  // Pay the outstanding joining fee off the saved card: an ordinary top-up of
  // exactly the amount owed — credit_from_payment applies it to the fee.
  const payFeeWithSavedCard = async () => {
    if (!savedCard || feeOwedPence <= 0) return;
    setFeeBusy(true);
    setDueError(null);
    try {
      const res = await authedPost("/api/settle-match", {
        items: [{
          amountPence: feeOwedPence, sharePence: feeOwedPence, feePence: 0,
          teamId,   // the route refills this team's credit once the charge clears
        }],
      });
      const data = await res.json();
      const r = data.results?.[0];
      if (r?.ok) {
        if (typeof r.creditedBalancePence === "number") setBalance(r.creditedBalancePence / 100);
        await reloadFee();
        setDuePaidFlash(true);
      } else {
        setDueError(r?.error ?? data.error ?? "Card was declined — try topping up manually.");
      }
    } catch {
      setDueError("Payment failed. Please try again.");
    }
    setFeeBusy(false);
  };

  // No saved card: one-off card entry for exactly the fee owed.
  const startCardEntryForFee = async () => {
    if (feeOwedPence <= 0) return;
    setFeeTargeted(true);
    setSelectedAmount(feeOwedPence / 100);
    setCustomInput("");
    setDueError(null);
    setLoadingIntent(true);
    setIntentError(null);
    const res = await fetch("/api/create-credits-intent", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountPence: feeOwedPence, teamId, playerId: userId, customerId: saveCard.customerId }),
    });
    const data = await res.json();
    if (data.clientSecret) setClientSecret(data.clientSecret);
    else { setIntentError(data.error ?? "Failed to set up payment."); setFeeTargeted(false); }
    setLoadingIntent(false);
  };

  // No saved card: set up a one-off payment for exactly this due's amount.
  const startCardEntryForDue = async (due: MyDue) => {
    setPayTarget({ pcsId: due.pcsId, amountPence: due.remainingPence });
    setDueError(null);
    setLoadingIntent(true);
    setIntentError(null);
    const res = await fetch("/api/create-credits-intent", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountPence: due.remainingPence, teamId, playerId: userId, customerId: saveCard.customerId }),
    });
    const data = await res.json();
    if (data.clientSecret) setClientSecret(data.clientSecret);
    else { setIntentError(data.error ?? "Failed to set up payment."); setPayTarget(null); }
    setLoadingIntent(false);
  };

  const handleContinue = async () => {
    if (!effectiveAmount || effectiveAmount < 1) return;
    setLoadingIntent(true);
    setIntentError(null);
    const res = await fetch("/api/create-credits-intent", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountPence: Math.round(effectiveAmount * 100), teamId, playerId: userId, customerId: saveCard.customerId }),
    });
    const data = await res.json();
    if (data.clientSecret) setClientSecret(data.clientSecret);
    else setIntentError(data.error ?? "Failed to set up payment.");
    setLoadingIntent(false);
  };

  const payTopUpWithSavedCard = async () => {
    if (!savedCard || !effectiveAmount || effectiveAmount < 1) return;
    setTopUpBusy(true);
    setIntentError(null);
    const amountPence = Math.round(effectiveAmount * 100);
    try {
      // A plain top-up onto your own card — no due row to derive from, so the
      // amount stands as chosen. The worst a tampered amount does is overcharge
      // the person choosing it.
      const res = await authedPost("/api/settle-match", {
        items: [{
          amountPence, sharePence: amountPence, feePence: 0,
          teamId,   // the route refills this team's credit once the charge clears
        }],
      });
      const data = await res.json();
      const r = data.results?.[0];
      if (r?.ok) {
        await applyTopUp(userId, amountPence, payTarget?.pcsId ?? undefined);
        setBalance(typeof r.creditedBalancePence === "number"
          ? r.creditedBalancePence / 100
          : (credits ?? 0) + effectiveAmount);
        setSuccess(true);
        await Promise.all([reloadDues(), reloadFee()]);
      } else {
        setIntentError(r?.error ?? data.error ?? "Card was declined — try a different card below.");
      }
    } catch {
      setIntentError("Payment failed. Please try again.");
    }
    setTopUpBusy(false);
  };

  return (
    <>
    <div className="fixed inset-0 z-[80] flex items-end justify-center" style={{ background: "rgba(11,21,38,0.55)" }} onClick={onClose}>
      {/* Bottom sheet, matching the rebrand's single overlay shape. */}
      <div className="w-full max-w-lg bg-surface rounded-t-[24px] px-5 pt-5 pb-6 max-h-[88dvh] overflow-y-auto"
        style={{ boxShadow: "0 -8px 32px rgba(11,21,38,0.18)" }} onClick={(e) => e.stopPropagation()}>
        <span className="block w-11 h-1 rounded-full bg-border mx-auto mb-4" />
        {credits === null ? (
          <div className="py-10 flex justify-center">
            <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          </div>
        ) : success ? (
          <div className="flex flex-col items-center text-center gap-4 py-4">
            <div className="w-16 h-16 rounded-full bg-success-bg border-2 border-success-border flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <p className="font-bold text-lg">Credits Added!</p>
            <p className="text-sm text-text-secondary">£{effectiveAmount?.toFixed(2)} added to your team balance.</p>
            <p className="text-base font-bold text-accent-ink">New balance: £{credits.toFixed(2)}</p>
            <button onClick={onClose} className="w-full py-3 rounded-btn bg-accent text-white font-bold text-sm">Done</button>
          </div>
        ) : clientSecret && effectiveAmount ? (
          <>
            <div className="flex items-center justify-between mb-5">
              <p className="font-bold text-lg">Pay &amp; Top Up</p>
              <button onClick={onClose}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "night", variables: { colorPrimary: "#0E7A3C", colorBackground: "#1a1a1a", colorText: "#ffffff", borderRadius: "12px" } } }}>
              <CreditsCheckoutForm
                amount={effectiveAmount}
                teamId={teamId}
                userId={userId}
                currentCredits={credits}
                targetPcsId={payTarget?.pcsId}
                skipDuesApply={feeTargeted}
                onSuccess={(newBalance, paymentIntentId) => saveCard.offer(paymentIntentId, async () => {
                  setBalance(newBalance);
                  setSuccess(true);
                  await Promise.all([reloadDues(), reloadFee()]);
                })}
                onBack={() => { setClientSecret(null); setPayTarget(null); setFeeTargeted(false); }}
              />
            </Elements>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between mb-1">
              <p className="font-bold text-lg">Top Up Credits</p>
              <button onClick={onClose}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <p className="text-xs text-text-secondary mb-4">
              Current balance: <span className="font-semibold text-text-primary">£{credits.toFixed(2)}</span>
            </p>

            {feeOwedPence > 0 && (
              <div className="mb-5">
                <p className="text-xs font-bold text-red-600 uppercase tracking-wider mb-2">Joining fee due</p>
                <div className="flex items-center gap-2 bg-surface border border-border rounded-btn px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">Team joining fee</p>
                    <p className="text-[10px] text-text-secondary">
                      {feeDuePence !== feeOwedPence ? `${fmtFee(feeOwedPence)} of ${fmtFee(feeDuePence)} remaining` : `${fmtFee(feeDuePence)}, paid once`}
                    </p>
                  </div>
                  <button
                    onClick={() => (savedCard ? payFeeWithSavedCard() : startCardEntryForFee())}
                    disabled={feeBusy || loadingIntent}
                    className="flex-shrink-0 text-xs font-bold bg-accent text-white px-3 py-2 rounded-lg disabled:opacity-50">
                    {feeBusy ? "Paying…" : `Pay ${fmtFee(feeOwedPence)}`}
                  </button>
                </div>
                <p className="text-[10px] text-text-secondary mt-2">
                  Your joining fee goes into the team&rsquo;s credit balance, which pays for pitch
                  bookings and tournament entry fees. Until it&rsquo;s paid you can&rsquo;t join or
                  vote available for games.
                </p>
              </div>
            )}

            {dues.length > 0 && (
              <div className="mb-5">
                <div className="flex items-center gap-1.5 mb-2">
                  <p className="text-xs font-bold text-red-600 uppercase tracking-wider">Payments due</p>
                  <span className="text-[10px] font-bold bg-red-500 text-white px-1.5 rounded-full">{dues.length}</span>
                </div>
                <div className="space-y-2">
                  {dues.map((due) => {
                    const busy = dueBusy.has(due.pcsId);
                    return (
                      <div key={due.pcsId} className="flex items-center gap-2 bg-surface border border-border rounded-btn px-3 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{due.kind === "tournament" ? due.opponent : `vs ${due.opponent}`}</p>
                          <p className="text-[10px] text-text-secondary">{due.date} · £{(due.remainingPence / 100).toFixed(2)} share</p>
                        </div>
                        <button
                          onClick={() => (savedCard ? payDueWithCard(due) : startCardEntryForDue(due))}
                          disabled={busy || loadingIntent}
                          className="flex-shrink-0 text-xs font-bold bg-accent text-white px-3 py-2 rounded-lg disabled:opacity-50">
                          {busy ? "Paying…" : `Pay £${(due.remainingPence / 100).toFixed(2)}`}
                        </button>
                      </div>
                    );
                  })}
                </div>
                {savedCard ? (
                  <p className="text-[10px] text-text-secondary mt-2">Charged instantly to your saved card •••• {savedCard.last4 ?? "0000"}.</p>
                ) : (
                  <p className="text-[10px] text-text-secondary mt-2">Tap to pay — add a card on your Profile to skip card entry next time.</p>
                )}
                {dueError && <p className="text-[11px] text-red-600 mt-2">{dueError}</p>}
                <div className="flex items-center gap-2 my-4">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-[10px] text-text-secondary uppercase tracking-wider">or top up manually</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              </div>
            )}

            {duePaidFlash && (
              <div className="flex items-center gap-2 bg-accent/10 border border-accent/30 rounded-xl px-3 py-2 mb-4">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                <p className="text-[11px] text-accent-ink font-semibold">Payment received — team credit topped up.</p>
              </div>
            )}

            <div className={`grid gap-2 mb-4 ${owedPence > 0 ? "grid-cols-5" : "grid-cols-4"}`}>
              {owedPence > 0 && (() => {
                const owedAmount = owedPence / 100;
                return (
                  <button onClick={() => { setSelectedAmount(owedAmount); setCustomInput(""); }}
                    className={`py-3 rounded-xl border text-sm font-bold transition-colors ${selectedAmount === owedAmount && !customInput ? "bg-red-500 text-white border-red-500" : "bg-red-500/10 border-red-500/30 text-red-600"}`}>
                    £{owedAmount.toFixed(2)}
                  </button>
                );
              })()}
              {[10, 20, 50, 100].map((amt) => (
                <button key={amt} onClick={() => { setSelectedAmount(amt); setCustomInput(""); }}
                  className={`py-3 rounded-xl border text-sm font-bold transition-colors ${selectedAmount === amt && !customInput ? "bg-accent text-white border-accent" : "bg-surface-2 border-border text-text-primary"}`}>
                  £{amt}
                </button>
              ))}
            </div>

            <div className="relative mb-5">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-text-secondary">£</span>
              <input
                type="number" min="1" step="0.01" inputMode="decimal" enterKeyHint="done" placeholder="Custom amount"
                value={customInput}
                onChange={(e) => { setCustomInput(e.target.value); setSelectedAmount(null); }}
                className="w-full bg-surface border border-border rounded-btn pl-7 pr-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60"
              />
            </div>

            {effectiveAmount && effectiveAmount >= 1 && (
              <div className="bg-surface border border-border rounded-btn px-4 py-3 mb-4 text-xs space-y-1.5">
                <div className="flex justify-between text-text-secondary"><span>Adding</span><span className="font-semibold text-text-primary">£{effectiveAmount.toFixed(2)}</span></div>
                <div className="flex justify-between text-text-secondary"><span>New balance</span><span className="font-semibold text-accent-ink">£{(credits + effectiveAmount).toFixed(2)}</span></div>
              </div>
            )}

            {intentError && <p className="text-xs text-red-600 text-center mb-3">{intentError}</p>}

            {savedCard ? (
              <>
                <button
                  disabled={!effectiveAmount || effectiveAmount < 1 || topUpBusy}
                  onClick={payTopUpWithSavedCard}
                  className="w-full py-3.5 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {topUpBusy ? (
                    <><svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Charging…</>
                  ) : effectiveAmount && effectiveAmount >= 1 ? `Pay £${effectiveAmount.toFixed(2)} with •••• ${savedCard.last4 ?? "0000"}` : "Enter an amount"}
                </button>
                <button
                  disabled={!effectiveAmount || effectiveAmount < 1 || loadingIntent || topUpBusy}
                  onClick={handleContinue}
                  className="w-full py-2.5 text-xs text-text-secondary disabled:opacity-50"
                >
                  {loadingIntent ? "Setting up…" : "Use a different card"}
                </button>
              </>
            ) : (
              <button
                disabled={!effectiveAmount || effectiveAmount < 1 || loadingIntent}
                onClick={handleContinue}
                className="w-full py-3.5 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-50"
              >
                {loadingIntent ? "Setting up…" : effectiveAmount && effectiveAmount >= 1 ? `Continue to pay £${effectiveAmount.toFixed(2)}` : "Enter an amount"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
    {/* Outside the backdrop above — nested, its clicks would bubble into that
        backdrop's onClose and dismiss the whole modal mid-prompt. */}
    {saveCard.prompt}
    </>
  );
}
