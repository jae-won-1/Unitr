"use client";

import { useEffect, useState } from "react";
import BottomSheet from "@/components/BottomSheet";
import { DatePicker } from "@/components/DateTimePickers";
import { feeOnTop, PAYMENT_FEE_ENABLED } from "@/lib/payment-fee";
import {
  createRequest, failed, MAX_REQUEST_PENCE, MIN_REQUEST_PENCE, pounds,
  type FinanceRequest, type SquadMember,
} from "@/lib/team-finance";

// The + on Team Finance: a leader asks the squad for money, or sets the
// joining fee.
//
// The two share a form because they are the same thing underneath — a title,
// an amount each, and who pays. What differs is who it goes to: a payment
// request goes to whoever is ticked, the joining fee to the whole squad and to
// everyone who joins afterwards, and there is only ever one of it, so setting
// it again changes the fee rather than issuing a second.

type Mode = "request" | "fee";

export default function CreateRequestSheet({ teamId, squad, userId, joiningFee, initialMode = "request", onClose, onCreated }: {
  teamId: string;
  squad: SquadMember[];
  userId: string;
  /** The team's current joining fee, if it has one. */
  joiningFee: FinanceRequest | null;
  initialMode?: Mode;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(squad.map((s) => s.playerId)));
  const [captainExempt, setCaptainExempt] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Switching to the joining fee loads the one the team already has, so
  // "setting" it reads as changing a figure rather than starting again.
  useEffect(() => {
    if (mode === "fee") {
      setTitle(joiningFee?.title ?? "Joining fee");
      setDescription(joiningFee?.description ?? "");
      setAmount(joiningFee ? (joiningFee.amountPence / 100).toFixed(2).replace(/\.00$/, "") : "");
      setDueDate(joiningFee?.dueDate ?? "");
      setCaptainExempt(joiningFee?.captainExempt ?? false);
    } else {
      setTitle(""); setDescription(""); setAmount(""); setDueDate("");
    }
    setError(null);
  }, [mode, joiningFee]);

  useEffect(() => {
    if (!image) { setPreview(null); return; }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const amountPence = amount ? Math.round(parseFloat(amount) * 100) : 0;
  const amountOk = Number.isFinite(amountPence) && amountPence >= MIN_REQUEST_PENCE && amountPence <= MAX_REQUEST_PENCE;
  const captain = squad.find((s) => s.isCaptain) ?? null;
  const captainName = captain ? (captain.playerId === userId ? "you" : captain.name) : "the captain";
  const recipients = mode === "fee" ? squad.length - (captainExempt && captain ? 1 : 0) : picked.size;
  const ready = title.trim().length > 0 && amountOk && recipients > 0 && !sending;
  const allPicked = picked.size === squad.length;

  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const submit = async () => {
    if (!ready) return;
    setSending(true);
    setError(null);
    const res = await createRequest({
      teamId,
      kind: mode === "fee" ? "joining_fee" : "general",
      title: title.trim(),
      description: description.trim() || undefined,
      amountPence,
      dueDate: dueDate || null,
      playerIds: mode === "fee" ? undefined : Array.from(picked),
      captainExempt: mode === "fee" ? captainExempt : undefined,
      image,
    });
    if (failed(res)) { setError(res.error); setSending(false); return; }
    await onCreated();
    onClose();
  };

  const field = "w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60";
  const label = "block text-xs font-semibold text-text-secondary mb-1.5";

  return (
    <BottomSheet
      title={mode === "fee" ? (joiningFee ? "Change the joining fee" : "Set a joining fee") : "New payment request"}
      subtitle={mode === "fee"
        ? "Asked of everyone in the squad, and anyone who joins later"
        : "Ask your squad for money — kit, a tournament, a team dinner"}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          {error && <p className="text-xs text-red-600 text-center">{error}</p>}
          <button type="button" onClick={submit} disabled={!ready}
            className="w-full py-3.5 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-40">
            {sending ? "Sending…"
              : mode === "fee" ? (joiningFee ? "Save joining fee" : "Set joining fee")
              : `Send to ${recipients} player${recipients === 1 ? "" : "s"}`}
          </button>
        </div>
      }
    >
      <div className="flex bg-surface border border-border rounded-btn p-[3px] gap-[3px] flex-shrink-0">
        {([["request", "Payment request"], ["fee", "Joining fee"]] as const).map(([id, text]) => (
          <button key={id} type="button" onClick={() => setMode(id)}
            className={`flex-1 py-2 rounded-[9px] text-xs transition-colors ${mode === id ? "bg-accent text-white font-bold" : "text-text-secondary font-semibold"}`}>
            {text}
          </button>
        ))}
      </div>

      <div>
        <label className={label} htmlFor="fin-title">Title</label>
        <input id="fin-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)}
          placeholder={mode === "fee" ? "Joining fee" : "e.g. Away kit"} className={field} />
      </div>

      <div>
        <label className={label} htmlFor="fin-desc">Description</label>
        <textarea id="fin-desc" value={description} maxLength={1000} rows={3} onChange={(e) => setDescription(e.target.value)}
          placeholder="What it's for" className={`${field} resize-none`} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="fin-amount">Amount each</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-text-secondary">£</span>
            <input id="fin-amount" type="number" min="1" step="0.01" inputMode="decimal" enterKeyHint="done"
              value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
              className={`${field} pl-7`} />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-text-secondary">Due date</span>
            {dueDate && (
              <button type="button" onClick={() => setDueDate("")} className="text-[11px] font-semibold text-text-secondary">Clear</button>
            )}
          </div>
          <DatePicker value={dueDate} onChange={setDueDate} />
        </div>
      </div>

      {amount !== "" && !amountOk && (
        <p className="text-[11px] text-red-600 -mt-2">
          Between {pounds(MIN_REQUEST_PENCE)} and {pounds(MAX_REQUEST_PENCE)} each.
        </p>
      )}
      {amountOk && (
        <p className="text-[11px] text-text-secondary leading-snug -mt-2">
          {PAYMENT_FEE_ENABLED
            ? <>Paying by card, each player pays {pounds(amountPence + feeOnTop(amountPence))} — {pounds(amountPence)} plus a {pounds(feeOnTop(amountPence))} service fee. </>
            : null}
          Your team receives {pounds(amountPence)} each{recipients > 1 ? `, ${pounds(amountPence * recipients)} in all` : ""}.
        </p>
      )}

      <div>
        <span className={label}>Screenshot (optional)</span>
        {preview ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the file about to be uploaded */}
            <img src={preview} alt="Screenshot to attach" className="w-full max-h-48 object-contain rounded-btn border border-border bg-panel" />
            <button type="button" onClick={() => setImage(null)}
              className="absolute top-2 right-2 text-[11px] font-bold bg-surface border border-border px-2.5 py-1 rounded-full">
              Remove
            </button>
          </div>
        ) : (
          <label className="flex items-center justify-center gap-2 w-full border border-dashed border-border rounded-btn py-4 text-xs font-semibold text-text-secondary cursor-pointer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
            Add a screenshot — a receipt, a quote, the kit
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
              onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
          </label>
        )}
      </div>

      {mode === "fee" ? (
        <div className="space-y-3">
          {captain && (
            <button type="button" role="switch" aria-checked={captainExempt}
              onClick={() => setCaptainExempt((v) => !v)}
              className="w-full flex items-center gap-3 bg-panel border border-border rounded-btn px-3 py-2.5 text-left">
              <span className="flex-1 min-w-0">
                <span className="block text-xs font-semibold">Exempt the captain</span>
                <span className="block text-[11px] text-text-secondary leading-snug">
                  {captainExempt
                    ? `${captainName === "you" ? "You don't" : `${captainName} doesn't`} pay the joining fee.`
                    : `${captainName === "you" ? "You pay" : `${captainName} pays`} it like everyone else.`}
                </span>
              </span>
              <span className={`relative w-10 h-6 rounded-full flex-shrink-0 transition-colors ${captainExempt ? "bg-accent" : "bg-border"}`}>
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${captainExempt ? "left-[18px]" : "left-0.5"}`} />
              </span>
            </button>
          )}
          <p className="text-[11px] text-text-secondary leading-snug bg-panel border border-border rounded-btn px-3 py-2.5">
            The whole squad moves onto this fee{captainExempt ? ", except the captain" : ", the captain included"}.
            Anyone who has already paid a smaller fee owes the difference; nobody is refunded if you lower it
            {captainExempt ? " or exempt the captain" : ""}. Until it&apos;s paid a player can&apos;t vote available for games.
          </p>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-text-secondary">Send to</span>
            <button type="button" className="text-[11px] font-semibold text-accent-ink"
              onClick={() => setPicked(allPicked ? new Set() : new Set(squad.map((s) => s.playerId)))}>
              {allPicked ? "Clear all" : "Select all"}
            </button>
          </div>
          <div className="space-y-1.5">
            {squad.map((p) => {
              const on = picked.has(p.playerId);
              return (
                <button key={p.playerId} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(p.playerId)}
                  className="w-full flex items-center gap-2.5 bg-panel border border-border rounded-lg px-3 py-2.5 text-left">
                  <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${on ? "border-accent bg-accent" : "border-border"}`}>
                    {on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                  </span>
                  <span className="flex-1 text-xs font-medium truncate">{p.playerId === userId ? "You" : p.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
