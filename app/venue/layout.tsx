"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

// ── Nav config ────────────────────────────────────────────────
type NavItem = { label: string; href: string; icon: (active: boolean) => React.ReactNode };

const stroke = (active: boolean) => (active ? "#00E676" : "#9E9E9E");

const venueNav: NavItem[] = [
  {
    label: "Calendar",
    href: "/venue/calendar",
    icon: (a) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={stroke(a)} strokeWidth="2" strokeLinecap="round">
        <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
    ),
  },
  {
    label: "Bookings",
    href: "/venue/bookings",
    icon: (a) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={stroke(a)} strokeWidth="2" strokeLinecap="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>
      </svg>
    ),
  },
  {
    label: "Customers",
    href: "/venue/customers",
    icon: (a) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={stroke(a)} strokeWidth="2" strokeLinecap="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
  },
  {
    label: "Progress",
    href: "/venue/open-matches",
    icon: (a) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={stroke(a)} strokeWidth="2" strokeLinecap="round">
        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/>
        <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
        <path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/>
      </svg>
    ),
  },
  {
    label: "Academy",
    href: "/venue/academy",
    icon: (a) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={stroke(a)} strokeWidth="2" strokeLinecap="round">
        <path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>
      </svg>
    ),
  },
  {
    label: "Store",
    href: "/venue/store",
    icon: (a) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={stroke(a)} strokeWidth="2" strokeLinecap="round">
        <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
      </svg>
    ),
  },
  {
    label: "Reports",
    href: "/venue/reports",
    icon: (a) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={stroke(a)} strokeWidth="2" strokeLinecap="round">
        <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
      </svg>
    ),
  },
  {
    label: "Settings",
    href: "/venue/settings",
    icon: (a) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={stroke(a)} strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    ),
  },
];

export default function VenueLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const [initials, setInitials] = useState("?");
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) { setInitials("?"); return; }
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle()
      .then(({ data }) => {
        if (data?.full_name) {
          const parts = (data.full_name as string).split(" ").filter(Boolean);
          setInitials(parts.map((w: string) => w[0]).join("").slice(0, 2).toUpperCase());
        }
      });
  }, [user]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* ── Sidebar: icon rail on mobile, full on desktop ── */}
      {/* z-40: chrome, same floor as the player nav — venue sheets are z-50+ */}
      <aside className="fixed top-0 left-0 bottom-0 z-40 w-16 md:w-60 bg-surface border-r border-border flex flex-col">
        {/* Brand */}
        <div className="h-14 flex items-center gap-2.5 px-3 md:px-5 border-b border-border flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-accent/15 border border-accent/40 flex items-center justify-center flex-shrink-0">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2.5" strokeLinecap="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
          </div>
          <div className="hidden md:block min-w-0">
            <p className="text-sm font-bold leading-tight truncate">Venue Portal</p>
            <p className="text-[10px] text-text-secondary leading-tight">Powered by Unitr</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 md:px-3 space-y-1">
          {venueNav.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} title={item.label}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors justify-center md:justify-start ${
                  isActive ? "bg-accent/10 border border-accent/30" : "border border-transparent hover:bg-white/[0.03]"
                }`}>
                <span className="flex-shrink-0">{item.icon(isActive)}</span>
                <span className="hidden md:inline text-sm font-medium" style={{ color: isActive ? "#00E676" : "#9E9E9E" }}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* Footer: profile + back to player app */}
        <div className="border-t border-border p-2 md:p-3 flex-shrink-0 space-y-1">
          {user && (
            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setProfileOpen((o) => !o)}
                title="Account"
                className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors justify-center md:justify-start hover:bg-white/[0.03]"
              >
                <span className="w-7 h-7 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-[11px] font-bold text-accent">{initials}</span>
                </span>
                <span className="hidden md:inline text-sm font-medium text-text-secondary truncate">Account</span>
              </button>

              {profileOpen && (
                <div className="absolute left-0 bottom-full mb-2 w-44 bg-surface border border-border rounded-2xl shadow-lg overflow-hidden z-50">
                  <Link href="/venue/settings" onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 text-sm text-text-primary hover:bg-surface-2 transition-colors">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                    Settings
                  </Link>
                  <button onClick={() => { setProfileOpen(false); signOut(); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-400 hover:bg-surface-2 transition-colors border-t border-border">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          )}
          <Link href="/" title="Player app"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-text-secondary hover:text-accent hover:bg-white/[0.03] transition-colors justify-center md:justify-start">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0">
              <path d="M19 12H5M12 5l-7 7 7 7"/>
            </svg>
            <span className="hidden md:inline text-sm font-medium">Player app</span>
          </Link>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="ml-16 md:ml-60 min-h-screen">
        {children}
      </main>
    </div>
  );
}
