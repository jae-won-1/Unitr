import { LINKED_FINANCE } from "@/lib/finance-mode";

// Where tapping a notification goes.
//
// A row carries the link it was written with, but several are written by SQL
// triggers with the nearest page that existed at the time ("/", "/my-team"),
// and a stored link can't know which payment system the app is on. So the
// type decides where it can, and the stored link is the fallback. Shared by
// the web's bell and the phone's notifications screen.

export type NotificationTarget = { type: string; link: string | null };

export function notificationHref(n: NotificationTarget): string | null {
  switch (n.type) {
    // "Pay your own joining fee" — paid in Team finance, or with Top Up on Home.
    case "joining_fee":
      return LINKED_FINANCE ? "/my-team/finance" : "/";
    // "You are a co-captain" — the squad list, where the badge now shows.
    case "co_captain":
      return "/my-team?tab=members";
    // "You're now the captain" — Team Settings, which is now theirs to run.
    case "team_handover":
      return "/my-team/settings";
    default:
      return n.link;
  }
}
