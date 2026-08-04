"use client";

import { useRole } from "@/contexts/RoleContext";
import { useAuth } from "@/contexts/AuthContext";

// The home screen's quick-action row: four fixed slots, identical for every
// role and in the same order every time, so the bar is muscle memory whether
// you're a captain, a squad player, or someone who just signed up. Actions the
// viewer can't take yet render greyed rather than disappearing — a missing slot
// would shift every other icon and break that.

type Item = {
  label: string;
  href: string;
  icon: React.ReactNode;
  disabled?: boolean;
  /** Tooltip explaining a greyed slot. Required whenever disabled is set. */
  reason?: string;
};

const ICONS = {
  ball: <><circle cx="12" cy="12" r="10" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /><path d="M2 12h20" /></>,
  pitch: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M12 5v14" /><circle cx="12" cy="12" r="3" /></>,
  transfer: <><path d="M16 3l4 4-4 4" /><path d="M20 7H4" /><path d="M8 21l-4-4 4-4" /><path d="M4 17h16" /></>,
  stats: <><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></>,
};

export default function QuickNav() {
  const { role } = useRole();
  const { user } = useAuth();

  const noTeam = role === "new_user";

  const items: Item[] = [
    // Posting a match commits the team to a fixture and a pitch fee, so it stays
    // a captain's action — a squad player sees it greyed rather than hidden.
    {
      label: "Post a Match",
      href: "/play/create",
      icon: ICONS.ball,
      disabled: role !== "captain",
      reason: noTeam ? "Join or register a team first" : "Only your captain can post a match",
    },
    { label: "Book a Pitch", href: user ? "/book" : "/login", icon: ICONS.pitch },
    {
      label: "Transfer Market",
      href: "/my-team/transfer",
      icon: ICONS.transfer,
      disabled: noTeam,
      reason: "Join or register a team first",
    },
    { label: "Stats", href: user ? "/profile" : "/login", icon: ICONS.stats },
  ];

  return (
    <section>
      <div className="flex justify-between gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => {
          const inner = (
            <>
              <span
                className={`w-14 h-14 rounded-full flex items-center justify-center ${
                  item.disabled ? "bg-surface-2 border border-border text-text-secondary" : "bg-accent text-black"
                }`}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  {item.icon}
                </svg>
              </span>
              <p className={`text-[11px] font-semibold text-center leading-tight ${item.disabled ? "text-text-secondary" : ""}`}>
                {item.label}
              </p>
            </>
          );

          return item.disabled ? (
            <div key={item.label} className="flex flex-col items-center gap-2 flex-1 min-w-[64px] opacity-50 cursor-not-allowed" title={item.reason}>
              {inner}
            </div>
          ) : (
            <a key={item.label} href={item.href} className="flex flex-col items-center gap-2 flex-1 min-w-[64px]">
              {inner}
            </a>
          );
        })}
      </div>
    </section>
  );
}
