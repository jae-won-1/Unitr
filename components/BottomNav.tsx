"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useRole } from "@/contexts/RoleContext";

type NavItem = {
  label: string;
  href: string;
  icon: (active: boolean) => React.ReactNode;
};

const navItems: NavItem[] = [
  {
    label: "Home",
    href: "/",
    icon: (active) => (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill={active ? "#0E7A3C" : "none"}
        stroke={active ? "#0E7A3C" : "#5A6478"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" />
        <path d="M9 21V12h6v9" />
      </svg>
    ),
  },
  {
    label: "Calendar",
    href: "/calendar",
    icon: (active) => (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke={active ? "#0E7A3C" : "#5A6478"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
    ),
  },
  {
    label: "My Team",
    href: "/my-team",
    icon: (active) => (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke={active ? "#0E7A3C" : "#5A6478"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
];

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { role, roleLoading } = useRole();

  // Venue managers only belong in /venue/* — redirect them away from player routes
  useEffect(() => {
    if (roleLoading) return;
    if (role === "venue_manager" && !pathname.startsWith("/venue")) {
      const allowed = ["/login", "/register", "/forgot-password", "/reset-password", "/pitches"];
      if (!allowed.some((p) => pathname.startsWith(p))) {
        router.replace("/venue/calendar");
      }
    }
  }, [role, roleLoading, pathname, router]);

  if (pathname.startsWith("/venue")) return null;
  if (role === "venue_manager") return null;

  return (
    // z-40, below the z-50 overlay floor. The nav is chrome: it renders after
    // every page in the layout, so at an equal z-index it silently painted over
    // the bottom of any sheet the page opened.
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-border pb-safe">
      <ul className="flex items-center justify-around h-16">
        {navItems.map((item) => {
          const isActive =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className="flex flex-col items-center justify-center gap-1 w-full h-full"
              >
                {item.icon(isActive)}
                <span
                  className={`text-[10px] ${isActive ? "font-bold" : "font-semibold"}`}
                  style={{ color: isActive ? "#0E7A3C" : "#5A6478" }}
                >
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
