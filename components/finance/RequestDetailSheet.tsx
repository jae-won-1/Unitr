"use client";

import { useState } from "react";
import BottomSheet from "@/components/BottomSheet";
import { fmtDate } from "@/lib/settle-payments";
import {
  failed, KIND_LABEL, owes, pounds, requestAction,
  type FinanceRequest, type RequestAction, type RequestMember,
} from "@/lib/team-finance";

// One payment request, opened from its post on the dashboard.
//
// Everyone sees what it is for and where they stand on it. A leader also gets
// the payment status of everyone it was sent to — tick someone off who paid
// in cash, take a mistaken tick back, remind, or drop a player added by
// mistake. A payment made by card can't be unticked: that money arrived.

function sentOn(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function RequestDetailSheet({
  request, isLeader, userId, canPayByCard, cardBlockedReason, onClose, onChanged, onPay,
}: {
  request: FinanceRequest;
  isLeader: boolean;
  userId: string;
  /** The team's linked account can take a card payment. */
  canPayByCard: boolean;
  cardBlockedReason: string;
  onClose: () => void;
  /** Something was written — reload the dashboard. */
  onChanged: () => void | Promise<void>;
  onPay: (r: FinanceRequest) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const act = async (action: RequestAction, playerId?: string) => {
    setBusy(`${action}:${playerId ?? ""}`);
    setError(null);
    const res = await requestAction(request.id, action, playerId);
    if (failed(res)) setError(res.error);
    else {
      await onChanged();
      if (action === "cancel") onClose();
    }
    setBusy(null);
  };

  const mineOwes = owes(request.mine);

  const memberRow = (m: RequestMember) => {
    const owed = owes(m);
    const isBusy = (a: RequestAction) => busy === `${a}:${m.playerId}`;
    const anyBusy = busy !== null;
    return (
      <div key={m.playerId} className="flex items-center gap-2 bg-panel border border-border rounded-btn px-3.5 py-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{m.playerId === userId ? "You" : m.name}</p>
          <p className="text-[10px] text-text-secondary">
            {owed === 0
              ? `${pounds(m.amountPence)} · ${m.paidVia === "card" ? "paid by card" : "marked paid"}`
              : m.paidPence > 0
                ? `${pounds(owed)} of ${pounds(m.amountPence)} still to pay`
                : pounds(m.amountPence)}
          </p>
        </div>
        {owed === 0 ? (
          m.paidVia === "manual" ? (
            // A tick is undoable: cash counted twice, or the wrong row tapped.
            <button onClick={() => act("mark_unpaid", m.playerId)} disabled={anyBusy} title="Mark as still unpaid"
              className="text-[11px] font-bold bg-success-bg text-accent-ink px-3 py-1 rounded-full flex-shrink-0 disabled:opacity-60">
              {isBusy("mark_unpaid") ? "Saving…" : "Paid ✓"}
            </button>
          ) : (
            <span className="text-[11px] font-bold bg-success-bg text-accent-ink px-3 py-1 rounded-full flex-shrink-0">Paid ✓</span>
          )
        ) : (
          <>
            <button onClick={() => act("mark_paid", m.playerId)} disabled={anyBusy} title="They paid you directly"
              className="text-[11px] font-bold bg-accent/10 text-accent-ink border border-accent/30 px-3 py-1 rounded-full flex-shrink-0 disabled:opacity-60">
              {isBusy("mark_paid") ? "Saving…" : "Mark paid"}
            </button>
            {m.playerId !== userId && (
              <button onClick={() => act("remind", m.playerId)} disabled={anyBusy}
                className="text-[11px] font-bold bg-[#FDECEC] text-danger px-3 py-1 rounded-full flex-shrink-0 disabled:opacity-60">
                {isBusy("remind") ? "Sending…" : m.remindedAt ? "Remind again" : "Remind"}
              </button>
            )}
            {m.paidPence === 0 && (
              <button onClick={() => act("remove_member", m.playerId)} disabled={anyBusy}
                title="Remove from this request — added by mistake" aria-label={`Remove ${m.name} from this request`}
                className="text-text-secondary hover:text-red-600 flex-shrink-0 disabled:opacity-50">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <BottomSheet title={request.title} subtitle={KIND_LABEL[request.kind]} onClose={onClose}>
      <div className="bg-panel border border-border rounded-btn px-4 py-3 text-xs space-y-1.5">
        <div className="flex justify-between text-text-secondary">
          <span>{request.kind === "match_fee" ? "Share" : "Amount"}</span>
          <span className="font-bold text-text-primary">{pounds(request.mine?.amountPence ?? request.amountPence)}{isLeader ? " each" : ""}</span>
        </div>
        {request.dueDate && (
          <div className="flex justify-between text-text-secondary">
            <span>Due</span><span className="font-semibold text-text-primary">{fmtDate(request.dueDate)}</span>
          </div>
        )}
        <div className="flex justify-between text-text-secondary">
          <span>Sent</span><span className="font-semibold text-text-primary">{sentOn(request.createdAt)}</span>
        </div>
      </div>

      {request.description && (
        <p className="text-sm text-text-primary whitespace-pre-wrap leading-snug">{request.description}</p>
      )}

      {request.imageUrl && (
        <a href={request.imageUrl} target="_blank" rel="noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link, not an asset next/image can optimise */}
          <img src={request.imageUrl} alt="Attached to this request" className="w-full max-h-72 object-contain rounded-btn border border-border bg-panel" />
        </a>
      )}

      {/* The viewer's own share. */}
      {request.mine && (
        mineOwes > 0 ? (
          <div>
            <button onClick={() => onPay(request)} disabled={!canPayByCard}
              className="w-full py-3.5 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-40">
              Pay {pounds(mineOwes)}
            </button>
            {!canPayByCard && <p className="text-[11px] text-text-secondary mt-2 leading-snug">{cardBlockedReason}</p>}
          </div>
        ) : (
          <p className="text-sm font-semibold text-accent-ink bg-success-bg border border-success-border rounded-btn px-4 py-3">
            You&apos;ve paid this ✓
          </p>
        )
      )}

      {isLeader && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-text-secondary">Payment status</p>
            <p className="text-xs font-semibold text-text-secondary">
              {request.paidCount}/{request.memberCount} paid
              {request.outstandingPence > 0 && <> · {pounds(request.outstandingPence)} to come</>}
            </p>
          </div>
          {request.kind === "joining_fee" && request.captainExempt && (
            <p className="text-[11px] text-text-secondary">The captain is exempt from the joining fee.</p>
          )}
          {request.members.length === 0
            ? <p className="text-xs text-text-secondary py-4 text-center">Nobody is on this request any more.</p>
            : [...request.members].sort((a, b) => Number(owes(a) === 0) - Number(owes(b) === 0)).map(memberRow)}
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      {isLeader && (
        confirmCancel ? (
          <div className="border border-danger/30 bg-[#FDECEC] rounded-btn px-4 py-3 space-y-3">
            <p className="text-xs text-text-primary leading-snug">
              Cancel this request for everyone? Anything already paid stays in the balance; nobody will be asked for the rest.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setConfirmCancel(false)} className="py-2 rounded-btn border border-border bg-surface text-xs font-bold">Keep it</button>
              <button onClick={() => act("cancel")} disabled={busy !== null}
                className="py-2 rounded-btn bg-danger text-white text-xs font-bold disabled:opacity-60">
                {busy === "cancel:" ? "Cancelling…" : "Cancel request"}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setConfirmCancel(true)} className="text-xs font-semibold text-danger self-start">
            Cancel this request
          </button>
        )
      )}
    </BottomSheet>
  );
}
