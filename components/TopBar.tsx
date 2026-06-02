"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

const HIDDEN_PATHS = ["/login", "/register", "/forgot-password", "/reset-password"];

type Notification = {
  id: string;
  title: string;
  body: string;
  href: string;
  time: string;
  read: boolean;
};

const DUMMY_NOTIFICATIONS: Notification[] = [
  { id: "n3", title: "Match confirmed", body: "Your match vs Dalston Athletic is confirmed.", href: "/my-team", time: "2h ago", read: false },
  { id: "n4", title: "New team member", body: "Jordan Ellis has been approved to your squad.", href: "/my-team", time: "5h ago", read: true },
  { id: "n5", title: "Payment received", body: "£12.50 pitch payment collected.", href: "/my-team", time: "1d ago", read: true },
];

export default function TopBar() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const [initials, setInitials] = useState("?");
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  // Pinned notification counts (dummy — replace with real Supabase queries)
  const [friendRequests, setFriendRequests] = useState(2);
  const [pendingPosts, setPendingPosts] = useState(1);
  const [notifications, setNotifications] = useState<Notification[]>(DUMMY_NOTIFICATIONS);

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
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (pathname.startsWith("/venue")) return null;
  if (HIDDEN_PATHS.some((p) => pathname.startsWith(p))) return null;

  const unreadCount = notifications.filter((n) => !n.read).length + (friendRequests > 0 ? 1 : 0) + (pendingPosts > 0 ? 1 : 0);

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setFriendRequests(0);
    setPendingPosts(0);
  };

  return (
    <div className="fixed top-3 right-4 z-50 flex items-center gap-2">

      {/* ── Notification bell ── */}
      <div className="relative" ref={notifRef}>
        <button
          onClick={() => { setNotifOpen((o) => !o); setProfileOpen(false); }}
          className="w-9 h-9 rounded-full bg-surface border border-border flex items-center justify-center relative"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-accent border-2 border-background" />
          )}
        </button>

        {notifOpen && (
          <div className="absolute right-0 top-11 w-80 bg-surface border border-border rounded-2xl shadow-xl overflow-hidden z-50">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <p className="text-sm font-bold">Notifications</p>
              <button onClick={markAllRead} className="text-[11px] text-accent font-medium">Mark all read</button>
            </div>

            {/* Pinned: Friend Requests */}
            <a href="/my-team/transfer" onClick={() => setNotifOpen(false)}
              className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2 transition-colors border-b border-border">
              <div className="w-8 h-8 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                  <line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold">Friend Requests</p>
                  {friendRequests > 0 && (
                    <span className="text-[10px] font-bold bg-accent text-black px-1.5 py-0.5 rounded-full">{friendRequests}</span>
                  )}
                </div>
                <p className="text-[11px] text-text-secondary mt-0.5">
                  {friendRequests > 0 ? `${friendRequests} pending friend request${friendRequests > 1 ? "s" : ""}` : "No pending requests"}
                </p>
              </div>
            </a>

            {/* Pinned: Pending Match Posts */}
            <a href="/play" onClick={() => setNotifOpen(false)}
              className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2 transition-colors border-b border-border">
              <div className="w-8 h-8 rounded-full bg-yellow-500/10 border border-yellow-500/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EAB308" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                  <path d="M2 12h20"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold">Pending Match Post</p>
                  {pendingPosts > 0 && (
                    <span className="text-[10px] font-bold bg-yellow-500 text-black px-1.5 py-0.5 rounded-full">{pendingPosts}</span>
                  )}
                </div>
                <p className="text-[11px] text-text-secondary mt-0.5">
                  {pendingPosts > 0 ? `${pendingPosts} match post awaiting opponent` : "No pending posts"}
                </p>
              </div>
            </a>

            {/* Other notifications */}
            <div className="max-h-64 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="text-xs text-text-secondary text-center py-6">No other notifications</p>
              ) : (
                notifications.map((n) => (
                  <a key={n.id} href={n.href} onClick={() => { setNotifOpen(false); setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, read: true } : x)); }}
                    className={`flex items-start gap-3 px-4 py-3 hover:bg-surface-2 transition-colors border-b border-border last:border-b-0 ${!n.read ? "bg-accent/5" : ""}`}>
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${!n.read ? "bg-accent" : "bg-transparent"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold">{n.title}</p>
                      <p className="text-[11px] text-text-secondary mt-0.5 leading-relaxed">{n.body}</p>
                    </div>
                    <span className="text-[10px] text-text-secondary flex-shrink-0">{n.time}</span>
                  </a>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Profile avatar ── */}
      {user ? (
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => { setProfileOpen((o) => !o); setNotifOpen(false); }}
            className="w-9 h-9 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center"
          >
            <span className="text-xs font-bold text-accent">{initials}</span>
          </button>

          {profileOpen && (
            <div className="absolute right-0 top-11 w-44 bg-surface border border-border rounded-2xl shadow-lg overflow-hidden z-50">
              <a href="/profile" onClick={() => setProfileOpen(false)}
                className="flex items-center gap-3 px-4 py-3 text-sm text-text-primary hover:bg-surface-2 transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                Profile
              </a>
              <a href="/settings" onClick={() => setProfileOpen(false)}
                className="flex items-center gap-3 px-4 py-3 text-sm text-text-primary hover:bg-surface-2 transition-colors border-t border-border">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                Settings
              </a>
              <button onClick={() => { setProfileOpen(false); signOut(); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-400 hover:bg-surface-2 transition-colors border-t border-border">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                Sign Out
              </button>
            </div>
          )}
        </div>
      ) : (
        <a href="/profile" className="w-9 h-9 rounded-full bg-surface-2 border border-border flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </a>
      )}
    </div>
  );
}
