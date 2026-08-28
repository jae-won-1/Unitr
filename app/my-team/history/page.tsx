"use client";

import { SettlePaymentsList } from "@/components/SettlePaymentsModal";

// The route form of Settle Payments. The list itself is shared with the popup
// opened from the money row on Home / My Team, so both stay in step; this page
// only adds the back-arrow header. Still linked from the result-submission
// flow, which lands here rather than back into a modal.
export default function SettlePaymentsPage() {
  return (
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-8">
      <div className="flex items-center gap-3 mb-6">
        <a href="/my-team">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </a>
        <div>
          <h1 className="text-xl font-extrabold">Settle Payments</h1>
          <p className="text-xs text-text-secondary">Upcoming and past fixtures for your team</p>
        </div>
      </div>

      <SettlePaymentsList />
    </div>
  );
}
