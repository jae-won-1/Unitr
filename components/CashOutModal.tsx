"use client";

import { useCallback, useEffect, useState } from "react";
import BottomSheet from "@/components/BottomSheet";
import { authedGet, authedPost } from "@/lib/authed-fetch";

// Cash out leftover team credit back to the cards that funded it.
//
// The case this exists for: a team enters one pilot event, the squad has put
// more into the pot than the entry cost, and they don't come back. The
// difference is real money sitting in a balance nobody will spend, so the
// captain hands it back.
//
// Everyone gets the same amount, capped at what they personally paid in —
// Stripe refunds go against a charge and can't exceed it, so a player who put
// in less than an equal share is refunded what they put in, and the rest is
// re-shared. The preview says so plainly before anything moves.

type Recipient = {
  playerId: string;
  name: string;
  contributedPence: number;
  refundedPence: number;
  amountPence: number;
  cappedByContribution: boolean;
};

type Preview = {
  availablePence: number;
  requestedPence: number;
  refundablePence: number;
  unallocatedPence: number;
  recipients: Recipient[];
};

type RefundResult = { playerId: string; name: string; amountPence: number; refundedPence: number; ok: boolean; error?: string };

const money = (pence: number) => `£${(pence / 100).toFixed(2)}`;

export default function CashOutModal({ teamId, onClose, onDone }: {
  teamId: string;
  onClose: () => void;
  onDone: (newBalancePence: number) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [results, setResults] = useState<RefundResult[] | null>(null);

  // One id per confirmed cash-out, reused if the request has to be retried, so
  // a double-tap or a dropped response can't refund the same money twice.
  const [requestId] = useState(() =>
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authedGet(`/api/credit/refund?teamId=${encodeURIComponent(teamId)}`);
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "Couldn't work out the refund."); setPreview(null); }
      else setPreview(d as Preview);
    } catch {
      setError("Couldn't reach the payment service.");
    }
    setLoading(false);
  }, [teamId]);

  useEffect(() => { load(); }, [load]);

  const handleRefund = async () => {
    setWorking(true);
    setError(null);
    try {
      const res = await authedPost("/api/credit/refund", { teamId, requestId });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "The refund didn't go through."); setWorking(false); return; }
      setResults(d.results as RefundResult[]);
      onDone(d.balancePence as number);
    } catch {
      setError("Couldn't reach the payment service.");
    }
    setWorking(false);
  };

  // ── Done ──
  if (results) {
    const failed = results.filter((r) => !r.ok);
    const total = results.reduce((sum, r) => sum + r.refundedPence, 0);
    return (
      <BottomSheet title="Refund sent" subtitle={`${money(total)} on its way back`} onClose={onClose}>
        <div className="space-y-2">
          <p className="text-xs text-text-secondary">
            Refunds land back on each card in 5–10 working days — that&rsquo;s Stripe&rsquo;s timing, not ours.
          </p>
          {results.map((r) => (
            <div key={r.playerId} className="flex items-center gap-2 bg-panel border border-border rounded-btn px-3.5 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{r.name}</p>
                {!r.ok && <p className="text-[11px] text-red-400">{r.error ?? "Didn't go through"}</p>}
              </div>
              <span className={`text-sm font-bold tabular-nums ${r.ok ? "text-accent" : "text-red-400"}`}>
                {money(r.refundedPence)}
              </span>
            </div>
          ))}
          {failed.length > 0 && (
            <p className="text-[11px] text-yellow-600">
              {failed.length === 1 ? "One refund" : `${failed.length} refunds`} couldn&rsquo;t be sent. That
              credit is still in the team balance — try again, or ask Unitr to sort it by hand.
            </p>
          )}
          <button onClick={onClose} className="w-full py-3 rounded-xl bg-accent text-white font-bold text-sm mt-1">
            Done
          </button>
        </div>
      </BottomSheet>
    );
  }

  // ── Loading / nothing to do ──
  if (loading) {
    return (
      <BottomSheet title="Refund team credit" onClose={onClose}>
        <div className="py-10 text-center">
          <div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" />
        </div>
      </BottomSheet>
    );
  }

  const nothingToRefund = !preview || preview.refundablePence <= 0;

  return (
    <BottomSheet
      title="Refund team credit"
      subtitle={
        preview
          ? preview.unallocatedPence > 0
            ? `${money(preview.refundablePence)} refundable of ${money(preview.availablePence)}`
            : `${money(preview.availablePence)} available`
          : undefined
      }
      onClose={onClose}
      footer={
        nothingToRefund ? undefined : confirming ? (
          <div className="flex gap-2">
            <button onClick={() => setConfirming(false)} disabled={working}
              className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold text-text-secondary disabled:opacity-50">
              Back
            </button>
            <button onClick={handleRefund} disabled={working}
              className="flex-[2] py-3 rounded-xl bg-danger text-white font-bold text-sm disabled:opacity-50">
              {working ? "Refunding…" : `Refund ${money(preview!.refundablePence)}`}
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirming(true)}
            className="w-full py-3 rounded-xl bg-accent text-white font-bold text-sm">
            Refund {money(preview!.refundablePence)} to {preview!.recipients.filter((r) => r.amountPence > 0).length} card
            {preview!.recipients.filter((r) => r.amountPence > 0).length === 1 ? "" : "s"}
          </button>
        )
      }
    >
      <div className="space-y-2">
        {error && <p className="text-sm text-red-400">{error}</p>}

        {nothingToRefund ? (
          <p className="text-sm text-text-secondary py-6 text-center">
            {preview && preview.availablePence > 0
              ? "This team's credit was all recorded as cash, so there's no card to send it back to. Settle up in person."
              : "There's no leftover credit to refund."}
          </p>
        ) : (
          <>
            {preview!.unallocatedPence > 0 && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3.5 py-3">
                <p className="text-xs font-semibold text-text-primary">
                  {money(preview!.unallocatedPence)} of this balance can&rsquo;t be refunded
                </p>
                <p className="text-[11px] text-text-secondary mt-0.5">
                  A refund can only reverse a card payment we have a record of. This much came in as
                  cash the captain logged by hand, or from players already refunded in full — it stays
                  in the team balance and has to be settled in person.
                </p>
              </div>
            )}

            <p className="text-xs text-text-secondary">
              Everyone who paid in by card gets the same amount back, up to what they personally put in.
              The team&rsquo;s balance drops by the same total.
            </p>

            {preview!.recipients.map((r) => (
              <div key={r.playerId} className="flex items-center gap-2 bg-panel border border-border rounded-btn px-3.5 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{r.name}</p>
                  <p className="text-[11px] text-text-secondary">
                    Paid in {money(r.contributedPence)}
                    {r.refundedPence > 0 && ` · ${money(r.refundedPence)} already refunded`}
                    {r.cappedByContribution && r.amountPence > 0 && " · capped at what they paid"}
                  </p>
                </div>
                <span className={`text-sm font-bold tabular-nums ${r.amountPence > 0 ? "text-accent" : "text-text-secondary"}`}>
                  {money(r.amountPence)}
                </span>
              </div>
            ))}

            {confirming && (
              <div className="bg-danger/10 border border-danger/30 rounded-xl px-3.5 py-3">
                <p className="text-xs text-text-primary font-semibold">This can&rsquo;t be undone from the app.</p>
                <p className="text-[11px] text-text-secondary mt-0.5">
                  {money(preview!.refundablePence)} goes back to {preview!.recipients.filter((r) => r.amountPence > 0).length} card
                  {preview!.recipients.filter((r) => r.amountPence > 0).length === 1 ? "" : "s"} and comes off
                  the team&rsquo;s balance. To put it back, the squad tops up again.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}
