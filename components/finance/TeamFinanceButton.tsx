"use client";

import { useOwed } from "@/lib/use-owed";
import { pounds } from "@/lib/team-finance";

// The captain's way into Team Finance from Home — what the four-pill team
// credit row (TeamCreditsBar) becomes once the app is on linked finance.
// One button, because everything those pills did now lives on one screen:
// the balance and requests on its dashboard, Settle match fees as its sub-tab.
//
// A link rather than a popup: the screen has sub-tabs, a feed, a filter and a
// drill-down, which is more than a sheet over Home can hold.
export default function TeamFinanceButton({ teamId }: { teamId: string | null }) {
  const { feeOwedPence, duesOwedPence, otherOwedPence, openRequests, loading } = useOwed(teamId);
  const myOwed = feeOwedPence + duesOwedPence + otherOwedPence;

  return (
    <a href="/my-team/finance"
      className="flex items-center gap-3 bg-surface border border-border shadow-card rounded-card px-4 py-3.5 mt-2 hover:border-accent transition-colors">
      <span className="w-10 h-10 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 11h20M6 16h4"/>
        </svg>
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-bold">Team finance</span>
        <span className="block text-[11px] text-text-secondary mt-0.5">
          {loading ? "Checking…"
            : openRequests > 0
              ? `${openRequests} request${openRequests === 1 ? "" : "s"} still being paid`
              : "Payment requests, match fees, balance"}
        </span>
        {myOwed > 0 && (
          <span className="block text-[11px] font-semibold text-danger mt-0.5">You owe {pounds(myOwed)} yourself</span>
        )}
      </span>
      {openRequests > 0 && (
        <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
          {openRequests}
        </span>
      )}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0"><path d="M9 18l6-6-6-6"/></svg>
    </a>
  );
}
