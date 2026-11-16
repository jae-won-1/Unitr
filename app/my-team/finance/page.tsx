"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLeadership } from "@/lib/team-leadership";
import { LINKED_FINANCE } from "@/lib/finance-mode";
import { fmtDate } from "@/lib/settle-payments";
import {
  accountAction, applyFilter, DEFAULT_FILTER, failed, isComplete, isDefaultFilter, KIND_LABEL,
  loadDashboard, owes, pounds, setTrackedBalance, trackedBalanceNote,
  type FinanceAccount, type FinanceDashboard, type FinanceFilter, type FinanceRequest,
} from "@/lib/team-finance";
import BottomSheet from "@/components/BottomSheet";
import PaymentsFilterSheet from "@/components/finance/PaymentsFilterSheet";
import RequestDetailSheet from "@/components/finance/RequestDetailSheet";
import CreateRequestSheet from "@/components/finance/CreateRequestSheet";
import PayRequestSheet from "@/components/finance/PayRequestSheet";
import SettleMatchFees from "@/components/finance/SettleMatchFees";
import dynamic from "next/dynamic";

// Stripe's embedded onboarding needs a browser, so it never renders on the server.
const ConnectOnboardingSheet = dynamic(() => import("@/components/ConnectOnboardingSheet"), { ssr: false });

// Team Finance (docs/PAYMENT_PIVOT.md) — what replaces the team credit row.
//
// A leader gets two sub-tabs: the Dashboard (tracked balance, the team's bank
// account, every payment request as a post) and Settle match fees. The + in
// the header creates a request or sets the joining fee. A member gets the
// dashboard alone, showing only what was sent to them, with a Pay button on
// anything they still owe.
//
// Everything is read through /api/finance/dashboard, which decides who may
// see what; this page holds no Supabase query of its own.

const CARD_BLOCKED =
  "Card payments open once your captain has linked the team's bank account. Until then, pay them directly and they'll tick you off.";

function todayKey(): string {
  // London's date, so "overdue" doesn't depend on the viewer's device.
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const FILTER_LABEL: Record<FinanceFilter["show"], string> = { active: "Active", completed: "Completed", all: "All" };

// ── One request, as a post ────────────────────────────────────────────
function RequestPost({ request, isLeader, canPayByCard, onOpen, onPay }: {
  request: FinanceRequest; isLeader: boolean; canPayByCard: boolean;
  onOpen: () => void; onPay: () => void;
}) {
  const mineOwes = owes(request.mine);
  const overdue = Boolean(request.dueDate) && request.dueDate! < todayKey() && !isComplete(request);
  const paidShare = request.memberCount > 0 ? request.paidCount / request.memberCount : 0;

  return (
    <div role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className="bg-surface border border-border shadow-card rounded-card p-4 cursor-pointer">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className={`inline-block text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
            request.kind === "general" ? "bg-surface border-border text-text-secondary" : "bg-accent/10 border-accent/30 text-accent-ink"}`}>
            {KIND_LABEL[request.kind]}
          </span>
          <p className="font-semibold text-sm mt-1.5 truncate">{request.title}</p>
        </div>
        <div className="flex flex-col items-end flex-shrink-0">
          <p className="text-sm font-bold">{pounds(request.mine?.amountPence ?? request.amountPence)}</p>
          {isLeader && <p className="text-[10px] text-text-secondary">each</p>}
        </div>
      </div>

      {request.description && (
        <p className="text-xs text-text-secondary mt-1.5 line-clamp-2">{request.description}</p>
      )}

      <p className="text-[11px] text-text-secondary mt-2">
        {request.dueDate && (
          <span className={overdue ? "text-danger font-semibold" : ""}>
            {overdue ? "Overdue · was due " : "Due "}{fmtDate(request.dueDate)} ·{" "}
          </span>
        )}
        Sent {shortDate(request.createdAt)}
        {request.imageUrl && " · screenshot attached"}
      </p>

      {isLeader && (
        <div className="mt-3">
          <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
            <div className="h-full bg-accent rounded-full" style={{ width: `${Math.round(paidShare * 100)}%` }} />
          </div>
          <p className="text-[11px] text-text-secondary mt-1.5">
            {request.paidCount}/{request.memberCount} paid
            {request.outstandingPence > 0
              ? <> · <span className="font-semibold text-danger">{pounds(request.outstandingPence)} to come</span></>
              : <> · <span className="font-semibold text-accent-ink">complete</span></>}
          </p>
        </div>
      )}

      {request.mine && (
        mineOwes > 0 ? (
          <button type="button" disabled={!canPayByCard}
            onClick={(e) => { e.stopPropagation(); onPay(); }}
            className="w-full mt-3 py-2.5 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-40">
            {isLeader ? `Pay your ${pounds(mineOwes)}` : `Pay ${pounds(mineOwes)}`}
          </button>
        ) : !isLeader && (
          <p className="mt-3 text-[11px] font-bold text-accent-ink">You&apos;ve paid ✓</p>
        )
      )}
    </div>
  );
}

// ── The team's bank account ───────────────────────────────────────────
function AccountPanel({ teamId, account, onChanged }: {
  teamId: string; account: FinanceAccount; onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Linking happens in a sheet on this page (Stripe's embedded onboarding);
  // the hosted page is only the fallback if that form won't load.
  const [onboarding, setOnboarding] = useState(false);

  const finishOnboarding = async () => {
    setOnboarding(false);
    setBusy(true);
    const res = await accountAction(teamId, "refresh");
    if (failed(res)) setError(res.error);
    await onChanged();
    setBusy(false);
  };

  const sheet = onboarding && (
    <ConnectOnboardingSheet
      title="Link the team's bank account"
      fetchClientSecret={async () => {
        const res = await accountAction(teamId, "session");
        if (failed(res)) throw new Error(res.error);
        if (!res.clientSecret) throw new Error("Couldn't start linking with Stripe.");
        return res.clientSecret;
      }}
      onClose={finishOnboarding}
      onFinished={finishOnboarding}
      onUseHostedPage={() => { setOnboarding(false); void go("link"); }}
    />
  );

  const go = async (action: "link" | "refresh" | "dashboard") => {
    setBusy(true);
    setError(null);
    const res = await accountAction(teamId, action);
    if (failed(res)) { setError(res.error); setBusy(false); return; }
    if (res.url) {
      // Stripe's onboarding takes the whole tab; its payouts page opens beside it.
      if (action === "dashboard") window.open(res.url, "_blank", "noopener");
      else { window.location.href = res.url; return; }
    }
    await onChanged();
    setBusy(false);
  };

  if (account.ready) {
    return (
      <div className="flex items-center gap-2.5 bg-success-bg border border-success-border rounded-card px-4 py-3">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2.5" strokeLinecap="round" className="flex-shrink-0"><polyline points="20 6 9 17 4 12"/></svg>
        <p className="flex-1 min-w-0 text-xs text-text-primary leading-snug">
          <span className="font-bold">Bank account linked.</span>{" "}
          Card payments go to {account.linkedByMe ? "your" : `${account.linkedByName ?? "a leader"}'s`} linked account.
        </p>
        {account.linkedByMe && (
          <button type="button" onClick={() => go("dashboard")} disabled={busy}
            className="text-xs font-bold text-accent-ink flex-shrink-0 disabled:opacity-50">
            Payouts
          </button>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border shadow-card rounded-card p-4">
      <p className="font-bold text-sm">{account.linked ? "Finish linking the bank account" : "Link the team's bank account"}</p>
      <p className="text-xs text-text-secondary mt-1 leading-snug">
        {account.linked && !account.linkedByMe
          ? `${account.linkedByName ?? "Another leader"} started linking the team's bank account and needs to finish it with Stripe. Until then players pay you directly and you tick them off.`
          : "Players can then pay requests by card, Apple Pay or Google Pay, and the money goes straight to this account — Uniter never holds it. Use a club account, or one you keep just for the team. Until it's linked, players pay you directly and you tick them off."}
      </p>
      {(!account.linked || account.linkedByMe) && (
        <button type="button" onClick={() => { setError(null); setOnboarding(true); }} disabled={busy}
          className="w-full mt-3 py-2.5 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-50">
          {busy ? "Checking…" : account.linked ? "Finish setting up" : "Link bank account"}
        </button>
      )}
      {account.linked && (
        <button type="button" onClick={() => go("refresh")} disabled={busy}
          className="w-full mt-2 py-2 text-xs font-semibold text-text-secondary disabled:opacity-50">
          Check again
        </button>
      )}
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      {sheet}
    </div>
  );
}

// ── Set the tracked balance to match the bank ─────────────────────────
function SetBalanceSheet({ teamId, currentPence, onClose, onSaved }: {
  teamId: string; currentPence: number; onClose: () => void; onSaved: () => void | Promise<void>;
}) {
  const [value, setValue] = useState((currentPence / 100).toFixed(2));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pence = Math.round(parseFloat(value) * 100);
  const valid = Number.isFinite(pence);

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setError(null);
    const res = await setTrackedBalance(teamId, pence);
    if (failed(res)) { setError(res.error); setSaving(false); return; }
    await onSaved();
    onClose();
  };

  return (
    <BottomSheet title="Set balance" subtitle="Enter what the team's bank account shows right now" onClose={onClose}>
      <div className="relative">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-text-secondary">£</span>
        <input type="number" step="0.01" inputMode="decimal" enterKeyHint="done" autoFocus
          value={value} onChange={(e) => setValue(e.target.value)} aria-label="Bank balance in pounds"
          className="w-full bg-background border border-border rounded-btn pl-7 pr-4 py-3 text-sm text-text-primary outline-none focus:border-accent/60" />
      </div>
      <p className="text-[11px] text-text-secondary leading-snug">
        The difference is recorded as a correction and the balance carries on tracking from there. No money moves.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button type="button" onClick={save} disabled={!valid || saving}
        className="w-full py-3.5 rounded-btn bg-accent text-white font-bold text-sm disabled:opacity-40">
        {saving ? "Saving…" : "Save balance"}
      </button>
    </BottomSheet>
  );
}

// ── Page ──────────────────────────────────────────────────────────────
export default function TeamFinancePage() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { teamId, captainId, loading: teamLoading } = useLeadership(userId);

  const [dashboard, setDashboard] = useState<FinanceDashboard | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<"dashboard" | "settle">("dashboard");
  const [filter, setFilter] = useState<FinanceFilter>(DEFAULT_FILTER);
  const [showFilter, setShowFilter] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showSetBalance, setShowSetBalance] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // A snapshot, not a lookup: the row changes the moment the payment lands,
  // and the sheet is still showing its receipt.
  const [paying, setPaying] = useState<FinanceRequest | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Loads can overlap — back from Stripe, the first load and the one after the
  // account refresh are in flight together — so only the latest may land.
  // Otherwise a slow, older answer overwrites the fresh one and the page asks
  // to link an account that is already linked.
  const loadSeq = useRef(0);
  const reload = useCallback(async () => {
    if (!teamId) return;
    const seq = ++loadSeq.current;
    const res = await loadDashboard(teamId);
    if (seq !== loadSeq.current) return;
    if (failed(res)) { setLoadError(res.error); return; }
    setLoadError(null);
    setDashboard(res);
  }, [teamId]);

  useEffect(() => { if (LINKED_FINANCE) reload(); }, [reload]);

  // Requests arrive while the page sits open in another tab — a leader sets
  // the joining fee, a teammate pays — so coming back to it asks again rather
  // than showing what was true when it was opened.
  useEffect(() => {
    if (!LINKED_FINANCE) return;
    const onVisible = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  // Back from Stripe's onboarding: ask Stripe where the account stands, then
  // drop the marker from the address so a refresh doesn't ask again.
  useEffect(() => {
    if (!LINKED_FINANCE || !teamId) return;
    const connect = new URLSearchParams(window.location.search).get("connect");
    if (!connect) return;
    window.history.replaceState(null, "", "/my-team/finance");
    (async () => {
      const res = await accountAction(teamId, "refresh");
      if (failed(res)) setNotice(res.error);
      else if (res.account?.ready) setNotice("Bank account linked — your squad can now pay by card.");
      else setNotice(connect === "refresh"
        ? "That setup link expired. Tap Finish setting up to carry on."
        : "Stripe still needs a few details before the account can take payments. Tap Finish setting up to carry on.");
      await reload();
    })();
  }, [teamId, reload]);

  const shown = useMemo(
    () => (dashboard ? applyFilter(dashboard.requests, filter) : []),
    [dashboard, filter],
  );

  const header = (
    <div className="flex items-center gap-3 mb-5">
      <a href="/" aria-label="Back to Home">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      </a>
      <div className="flex-1 min-w-0">
        <h1 className="text-xl font-extrabold">Team finance</h1>
        <p className="text-xs text-text-secondary">
          {dashboard?.isLeader ? "Ask for money, see who has paid" : "What you owe your team"}
        </p>
      </div>
      {dashboard?.isLeader && !dashboard.setupNeeded && (
        <button type="button" onClick={() => setShowCreate(true)} aria-label="New payment request or joining fee"
          className="w-10 h-10 rounded-full bg-accent text-white flex items-center justify-center flex-shrink-0 shadow-card">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      )}
    </div>
  );

  const shell = (body: React.ReactNode) => (
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-8">{header}{body}</div>
  );
  const spinner = (
    <div className="py-12 text-center"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" /></div>
  );
  const message = (text: string) => <p className="text-sm text-text-secondary text-center py-12">{text}</p>;

  if (!LINKED_FINANCE) return shell(message("Team finance isn't switched on yet."));
  if (!userId) return shell(message("Sign in to see your team's finance."));
  if (teamLoading) return shell(spinner);
  if (!teamId) return shell(message("Join or create a team to use team finance."));
  if (loadError) return shell(message(loadError));
  if (!dashboard) return shell(spinner);
  if (dashboard.setupNeeded) return shell(message(dashboard.setupNeeded));

  const { isLeader, account } = dashboard;
  const open = openId ? dashboard.requests.find((r) => r.id === openId) ?? null : null;
  const joiningFee = dashboard.requests.find((r) => r.kind === "joining_fee") ?? null;
  const myOwed = dashboard.requests.reduce((sum, r) => sum + owes(r.mine), 0);
  const myOpen = dashboard.requests.filter((r) => owes(r.mine) > 0).length;

  return shell(
    <>
      {isLeader && (
        <div className="flex bg-surface border border-border rounded-btn p-[3px] gap-[3px] mb-4">
          {([["dashboard", "Dashboard"], ["settle", "Settle match fees"]] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)}
              className={`flex-1 py-2 rounded-[9px] text-xs transition-colors ${tab === id ? "bg-accent text-white font-bold" : "text-text-secondary font-semibold"}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {notice && (
        <div className="flex items-start gap-2 bg-panel border border-border rounded-card px-4 py-3 mb-4">
          <p className="flex-1 text-xs text-text-primary leading-snug">{notice}</p>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="text-text-secondary flex-shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      )}

      {isLeader && tab === "settle" && captainId ? (
        <SettleMatchFees
          teamId={teamId} captainId={captainId} userId={userId}
          requests={dashboard.requests}
          entrySpend={dashboard.entrySpend}
          onIssued={async () => { await reload(); setTab("dashboard"); }}
        />
      ) : (
        <div className="space-y-4">
          {isLeader ? (
            <>
              <div className="bg-surface border border-border shadow-card rounded-card p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-wider text-text-secondary">Team balance</p>
                  <button type="button" onClick={() => setShowSetBalance(true)} className="text-xs font-bold text-accent-ink">
                    Set balance
                  </button>
                </div>
                <p className={`text-3xl font-extrabold mt-1 ${(dashboard.balancePence ?? 0) < 0 ? "text-danger" : ""}`}>
                  {(dashboard.balancePence ?? 0) < 0 ? "−" : ""}{pounds(Math.abs(dashboard.balancePence ?? 0))}
                </p>
                <p className="text-[11px] text-text-secondary mt-1.5 leading-snug">{trackedBalanceNote}</p>
              </div>
              <AccountPanel teamId={teamId} account={account} onChanged={reload} />
            </>
          ) : (
            <div className={`rounded-card border px-4 py-3.5 ${myOwed > 0 ? "bg-[#FDECEC] border-danger/30" : "bg-success-bg border-success-border"}`}>
              {myOwed > 0 ? (
                <>
                  <p className="text-xs font-bold uppercase tracking-wider text-danger">You owe</p>
                  <p className="text-3xl font-extrabold mt-1">{pounds(myOwed)}</p>
                  <p className="text-[11px] text-text-secondary mt-1">
                    Across {myOpen} request{myOpen === 1 ? "" : "s"}.{!account.ready && ` ${CARD_BLOCKED}`}
                  </p>
                </>
              ) : (
                <p className="text-sm font-bold text-accent-ink">You&apos;re all paid up ✓</p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <h2 className="text-lg font-bold tracking-[-0.01em] uppercase">Payment requests</h2>
            <button type="button" onClick={() => setShowFilter(true)}
              className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border ${
                isDefaultFilter(filter) ? "border-border text-text-primary bg-surface" : "border-accent text-accent-ink bg-accent/10"}`}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M3 6h18M6 12h12M10 18h4"/></svg>
              {FILTER_LABEL[filter.show]}
            </button>
          </div>

          {shown.length === 0 ? (
            <p className="text-sm text-text-secondary text-center py-10">
              {dashboard.requests.length === 0
                ? (isLeader ? "No payment requests yet. Tap + to ask your squad for money or set a joining fee." : "Nothing has been asked of you yet.")
                : "Nothing matches that filter."}
            </p>
          ) : (
            <div className="space-y-3">
              {shown.map((r) => (
                <RequestPost key={r.id} request={r} isLeader={isLeader} canPayByCard={account.ready}
                  onOpen={() => setOpenId(r.id)} onPay={() => setPaying(r)} />
              ))}
            </div>
          )}

          {isLeader && dashboard.entries.length > 0 && (
            <div className="pt-2">
              <h2 className="text-lg font-bold tracking-[-0.01em] uppercase mb-2">Balance changes</h2>
              <div className="space-y-1.5">
                {dashboard.entries.map((e) => (
                  <div key={e.id} className="flex items-center gap-2.5 bg-surface border border-border rounded-btn px-3.5 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">
                        {e.note ?? (e.kind === "spend" ? "Paid by team card" : e.kind === "expense" ? "Expense" : "Correction")}
                      </p>
                      <p className="text-[10px] text-text-secondary">{shortDate(e.createdAt)}</p>
                    </div>
                    <span className={`text-xs font-bold flex-shrink-0 ${e.amountPence < 0 ? "text-red-600" : "text-green-600"}`}>
                      {e.amountPence < 0 ? "−" : "+"}{pounds(Math.abs(e.amountPence))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {showFilter && (
        <PaymentsFilterSheet filter={filter} onClose={() => setShowFilter(false)}
          onDone={(f) => { setFilter(f); setShowFilter(false); }} />
      )}

      {open && !paying && (
        <RequestDetailSheet
          request={open} isLeader={isLeader} userId={userId}
          canPayByCard={account.ready} cardBlockedReason={CARD_BLOCKED}
          onClose={() => setOpenId(null)} onChanged={reload}
          onPay={(r) => setPaying(r)}
        />
      )}

      {paying && (
        <PayRequestSheet request={paying} userId={userId} onPaid={reload}
          onClose={() => { setPaying(null); setOpenId(null); }} />
      )}

      {showCreate && (
        <CreateRequestSheet teamId={teamId} squad={dashboard.squad} userId={userId} joiningFee={joiningFee}
          onClose={() => setShowCreate(false)} onCreated={reload} />
      )}

      {showSetBalance && (
        <SetBalanceSheet teamId={teamId} currentPence={dashboard.balancePence ?? 0}
          onClose={() => setShowSetBalance(false)} onSaved={reload} />
      )}
    </>,
  );
}
