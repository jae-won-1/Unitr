"use client";

import { useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import BottomSheet from "@/components/BottomSheet";
import TestModeNote from "@/components/TestModeNote";
import { stripePromise, cardElementOptions } from "@/lib/stripe-client";
import { confirmCardSetup } from "@/lib/confirm-payment";
import { cardLabel, failed, teamCardAction, type TeamCard } from "@/lib/team-finance";

// The team card on Team finance — what pays for the team's event entries.
//
// A leader saves it once; any leader can then pay with it, replace it or
// remove it, because it sits on the team's own Stripe customer
// (/api/finance/team-card). The advice under it is the point of the design:
// use the DEBIT card of the bank account linked above, so what the squad pays
// into requests (paid out to that account) is the money the card spends.

function SetupForm({ teamId, clientSecret, onSaved }: {
  teamId: string; clientSecret: string; onSaved: (card: TeamCard | null) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!stripe || !elements) return;
    setSaving(true);
    setError(null);
    // Never stripe.confirmSetup() directly — saving a card runs the same 3D
    // Secure challenge a payment does (lib/confirm-payment.ts).
    const { error: setupError, setupIntent } = await confirmCardSetup({ stripe, elements, clientSecret });
    if (setupError || !setupIntent?.id) {
      setError(setupError?.message ?? "Couldn't save that card.");
      setSaving(false);
      return;
    }
    const res = await teamCardAction(teamId, "save", setupIntent.id);
    if (failed(res)) { setError(res.error); setSaving(false); return; }
    onSaved(res.card ?? null);
  };

  return (
    <div className="space-y-3">
      <div className="bg-surface border border-border rounded-btn p-4">
        <PaymentElement options={cardElementOptions} />
      </div>
      <TestModeNote />
      {error && <p className="text-xs text-red-600 text-center">{error}</p>}
      <button type="button" onClick={save} disabled={!stripe || saving}
        className="w-full py-3.5 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-50">
        {saving ? "Saving…" : "Save team card"}
      </button>
    </div>
  );
}

export default function TeamCardPanel({ teamId, card, unavailable, onChanged }: {
  teamId: string;
  card: TeamCard | null;
  /** Set while supabase_team_card.sql hasn't been run. */
  unavailable?: string;
  onChanged: () => void | Promise<void>;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    const res = await teamCardAction(teamId, "setup");
    setBusy(false);
    if (failed(res) || !res.clientSecret) { setError(failed(res) ? res.error : "Couldn't start adding the card."); return; }
    setClientSecret(res.clientSecret);
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    const res = await teamCardAction(teamId, "remove");
    setBusy(false);
    setConfirmRemove(false);
    if (failed(res)) { setError(res.error); return; }
    await onChanged();
  };

  if (unavailable) {
    return (
      <div className="bg-surface border border-border shadow-card rounded-card p-4 opacity-60">
        <p className="font-bold text-sm">Team card</p>
        <p className="text-xs text-text-secondary mt-1">{unavailable}</p>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border shadow-card rounded-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-bold text-sm">Team card</p>
        {card && (
          <button type="button" onClick={start} disabled={busy} className="text-xs font-bold text-accent-ink disabled:opacity-50">
            Replace
          </button>
        )}
      </div>

      {card ? (
        <>
          <div className="flex items-center gap-3 mt-2 bg-panel border border-border rounded-btn px-3.5 py-3">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">{cardLabel(card)}</p>
              <p className="text-[11px] text-text-secondary">
                {card.expMonth && card.expYear ? `Expires ${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)} · ` : ""}
                Saved by {card.savedByMe ? "you" : card.savedByName ?? "a leader"}
              </p>
            </div>
          </div>
          {card.funding === "credit" && (
            <p className="text-[11px] text-yellow-700 bg-yellow-500/10 border border-yellow-500/30 rounded-btn px-3 py-2 mt-2 leading-snug">
              This is a credit card. What your squad pays goes to the team&apos;s bank account, not to this card —
              use that account&apos;s debit card so the two stay together.
            </p>
          )}
          <p className="text-[11px] text-text-secondary mt-2 leading-snug">
            Pays for the team&apos;s event entries. Refunds come back to it.
          </p>
          {confirmRemove ? (
            <div className="flex gap-2 mt-3">
              <button type="button" onClick={() => setConfirmRemove(false)}
                className="flex-1 py-2 rounded-btn border border-border text-xs font-bold">Keep it</button>
              <button type="button" onClick={remove} disabled={busy}
                className="flex-1 py-2 rounded-btn bg-danger text-white text-xs font-bold disabled:opacity-60">
                {busy ? "Removing…" : "Remove card"}
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmRemove(true)} className="text-xs font-semibold text-danger mt-3">
              Remove card
            </button>
          )}
        </>
      ) : (
        <>
          <p className="text-xs text-text-secondary mt-1 leading-snug">
            The card your team pays for event entries with. Use the debit card of the bank account linked above:
            what your squad pays in goes to that account, so it&apos;s the money this card spends. Any captain or
            co-captain can use it.
          </p>
          <button type="button" onClick={start} disabled={busy}
            className="w-full mt-3 py-2.5 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-50">
            {busy ? "Starting…" : "Add team card"}
          </button>
        </>
      )}
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

      {clientSecret && (
        <BottomSheet title={card ? "Replace the team card" : "Add a team card"}
          subtitle="Nothing is charged now. Your bank may ask you to approve it." onClose={() => setClientSecret(null)}>
          <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "stripe", variables: { colorPrimary: "#008000", borderRadius: "12px" } } }}>
            <SetupForm teamId={teamId} clientSecret={clientSecret}
              onSaved={async () => { setClientSecret(null); await onChanged(); }} />
          </Elements>
        </BottomSheet>
      )}
    </div>
  );
}
