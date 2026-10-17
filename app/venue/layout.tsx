"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { loadVenuePitches, type VenuePitch } from "@/lib/venue-pitches";

// ── Nav config ────────────────────────────────────────────────
// Icons draw in currentColor, so the link's text colour drives them.
type NavItem = { label: string; href: string; icon: React.ReactNode };

const svg = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const };

const ICONS = {
  pitch: (
    <svg {...svg}><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="12" y1="5" x2="12" y2="19"/><circle cx="12" cy="12" r="2.5"/></svg>
  ),
  add: (
    <svg {...svg}><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>
  ),
  bookings: (
    <svg {...svg}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>
    </svg>
  ),
  progress: (
    <svg {...svg}>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/>
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/>
    </svg>
  ),
  customers: (
    <svg {...svg}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  reports: (
    <svg {...svg}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
  ),
  settings: (
    <svg {...svg}>
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
  academy: (
    <svg {...svg}><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
  ),
  store: (
    <svg {...svg}>
      <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
    </svg>
  ),
};

// The Calendar section is built from the venue's pitches — one calendar each.
const MATCH_NAV: NavItem[] = [
  { label: "Bookings", href: "/venue/bookings", icon: ICONS.bookings },
  { label: "Progress", href: "/venue/open-matches", icon: ICONS.progress },
];
const VENUE_NAV: NavItem[] = [
  { label: "Customers", href: "/venue/customers", icon: ICONS.customers },
  { label: "Reports", href: "/venue/reports", icon: ICONS.reports },
  { label: "Settings", href: "/venue/settings", icon: ICONS.settings },
];
// Not yet filed under a section.
const OTHER_NAV: NavItem[] = [
  { label: "Academy", href: "/venue/academy", icon: ICONS.academy },
  { label: "Store", href: "/venue/store", icon: ICONS.store },
];

function NavLink({ item, active, badge }: { item: NavItem; active: boolean; badge?: number }) {
  return (
    <Link href={item.href} title={item.label}
      className={`relative flex items-center gap-3 rounded-btn px-3 py-2.5 transition-colors justify-center md:justify-start ${
        active ? "bg-accent text-white" : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
      }`}>
      <span className="flex-shrink-0">{item.icon}</span>
      {/* On the icon rail every pitch has the same glyph — number them. */}
      {badge !== undefined && (
        <span className={`md:hidden absolute top-1 right-1.5 text-[9px] font-bold leading-none ${active ? "text-white" : "text-text-primary"}`}>
          {badge}
        </span>
      )}
      <span className="hidden md:inline text-sm font-medium truncate">{item.label}</span>
    </Link>
  );
}

function NavSection({ title, first, children }: { title?: string; first?: boolean; children: React.ReactNode }) {
  return (
    <div className={first ? "" : "pt-4"}>
      {title
        ? <p className="hidden md:block px-3 pb-1.5 text-[11px] font-semibold text-text-secondary">{title}</p>
        : <div className="hidden md:block mx-3 mb-4 h-px bg-border" />}
      {/* The rail has no room for headings, so a rule marks each section. */}
      {!first && <div className="md:hidden mx-2 mb-4 h-px bg-border" />}
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export default function VenueLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const [initials, setInitials] = useState("?");
  const [profileOpen, setProfileOpen] = useState(false);
  const [pitches, setPitches] = useState<VenuePitch[] | null>(null);
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

  // Re-read on navigation so a pitch renamed or added in Settings shows up
  // without a reload. The old list stays on screen meanwhile — no flicker.
  useEffect(() => {
    if (!user) { setPitches(null); return; }
    loadVenuePitches(user.id).then(setPitches);
  }, [user, pathname]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="venue-shell min-h-screen bg-background">
      {/* ── Sidebar: icon rail on mobile, full on desktop ── */}
      {/* z-40: chrome, same floor as the player nav — venue sheets are z-50+ */}
      <aside className="fixed top-0 left-0 bottom-0 z-40 w-16 md:w-60 bg-surface border-r border-border flex flex-col">
        {/* Brand */}
        <div className="h-14 flex items-center gap-2.5 px-3 md:px-5 border-b border-border flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0 text-accent">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
          </div>
          <div className="hidden md:block min-w-0">
            <p className="text-sm font-bold leading-tight truncate">Venue Portal</p>
            <p className="text-[10px] text-text-secondary leading-tight">Powered by Uniter</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-2 md:px-3">
          <NavSection title="Calendar" first>
            {pitches === null ? (
              <div className="h-10 rounded-btn bg-surface-2 animate-pulse" />
            ) : pitches.length === 0 ? (
              <NavLink item={{ label: "Register a pitch", href: "/pitches/register", icon: ICONS.add }} active={false} />
            ) : (
              pitches.map((p, i) => {
                const href = `/venue/calendar/${p.id}`;
                return <NavLink key={p.id} item={{ label: p.name, href, icon: ICONS.pitch }} active={isActive(href)} badge={i + 1} />;
              })
            )}
          </NavSection>
          <NavSection title="Manage matches">
            {MATCH_NAV.map((item) => <NavLink key={item.href} item={item} active={isActive(item.href)} />)}
          </NavSection>
          <NavSection title="Manage venue">
            {VENUE_NAV.map((item) => <NavLink key={item.href} item={item} active={isActive(item.href)} />)}
          </NavSection>
          <NavSection>
            {OTHER_NAV.map((item) => <NavLink key={item.href} item={item} active={isActive(item.href)} />)}
          </NavSection>
        </nav>

        {/* Footer: profile + back to player app */}
        <div className="border-t border-border p-2 md:p-3 flex-shrink-0 space-y-1">
          {user && (
            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setProfileOpen((o) => !o)}
                title="Account"
                className="w-full flex items-center gap-3 rounded-btn px-3 py-2.5 transition-colors justify-center md:justify-start hover:bg-surface-2"
              >
                <span className="w-7 h-7 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-[11px] font-bold text-accent-ink">{initials}</span>
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
                  <button onClick={() => { setProfileOpen(false); signOut("/login"); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-600 hover:bg-surface-2 transition-colors border-t border-border">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          )}
          <Link href="/" title="Player app"
            className="flex items-center gap-3 rounded-btn px-3 py-2.5 text-text-secondary hover:text-accent-ink hover:bg-surface-2 transition-colors justify-center md:justify-start">
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
