"use client";

import { useRole } from "@/contexts/RoleContext";
import { useAuth } from "@/contexts/AuthContext";

// The home screen's quick-action row. Deliberately the same shape for every
// role: five slots, of which only the first changes. Slots 2–5 stay in fixed
// positions so the bar is muscle-memory regardless of whether you're a captain,
// a squad player, or someone who just signed up. Actions that need something
// the viewer doesn't have yet (a team, an account) render greyed rather than
// disappearing — a missing slot would shift every other icon.

type Item = {
  label: string;
  href: string;
  icon: React.ReactNode;
  disabled?: boolean;
};

const ICONS = {
  team: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  ball: <><circle cx="12" cy="12" r="10" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /><path d="M2 12h20" /></>,
  fillIn: <><circle cx="9" cy="7" r="4" /><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" /><path d="M19 8v6" /><path d="M16 11h6" /></>,
  pitch: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M12 5v14" /><circle cx="12" cy="12" r="3" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></>,
  stats: <><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></>,
};

export default function QuickNav({ ringerHref = "/play?tab=ringer" }: { ringerHref?: string }) {
  const { role } = useRole();
  const { user } = useAuth();

  // Slot 1 — the only role-specific entry point.
  const first: Item =
    role === "captain"
      ? { label: "Post a Match", href: "/play/create", icon: ICONS.ball }
      : role === "player"
      ? { label: "My Team", href: "/my-team", icon: ICONS.team }
      : { label: "Register Team", href: user ? "/my-team/create" : "/login", icon: ICONS.team };

  // Slots 2–5 — identical for everyone, greyed when the viewer can't use them.
  const noTeam = role === "new_user";
  const items: Item[] = [
    first,
    { label: "Fill In", href: user ? ringerHref : "/login", icon: ICONS.fillIn },
    { label: "Book Pitch", href: user ? "/book" : "/login", icon: ICONS.pitch },
    { label: "Calendar", href: "/my-team/availability", icon: ICONS.calendar, disabled: noTeam },
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
            <div key={item.label} className="flex flex-col items-center gap-2 flex-1 min-w-[64px] opacity-50 cursor-not-allowed" title="Join a team first">
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
