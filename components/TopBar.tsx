"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

const HIDDEN_PATHS = ["/login", "/register", "/forgot-password", "/reset-password"];

export default function TopBar() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const [initials, setInitials] = useState("?");
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  // Pinned notification counts — real Supabase queries
  const [joinRequests, setJoinRequests] = useState(0);
  const [openPosts, setOpenPosts] = useState(0);
  const [matchDues, setMatchDues] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);

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
    if (!user) { setJoinRequests(0); setOpenPosts(0); return; }

    supabase.from("teams").select("id").eq("captain_id", user.id).maybeSingle()
      .then(async ({ data: team }) => {
        if (!team) { setJoinRequests(0); return; }
        const { count } = await supabase.from("team_members")
          .select("id", { count: "exact", head: true })
          .eq("team_id", team.id).eq("status", "pending");
        setJoinRequests(count ?? 0);
      });

    supabase.from("match_posts")
      .select("id", { count: "exact", head: true })
      .eq("captain_id", user.id).eq("status", "open")
      .then(({ count }) => setOpenPosts(count ?? 0));
  }, [user]);

  // Outstanding share dues: matches the user played (already done) where their
  // share hasn't been settled yet → nudge them to the Team Credits → Dues tab.
  useEffect(() => {
    if (!user) { setMatchDues(0); return; }
    async function loadDues() {
      const today = new Date().toISOString().split("T")[0];
      const { data: confs } = await supabase.from("match_confirmations")
        .select("match_id").eq("player_id", user!.id).eq("status", "confirmed");
      const matchIds = Array.from(new Set((confs ?? []).map((c) => c.match_id)));
      if (matchIds.length === 0) { setMatchDues(0); return; }

      const { data: ms } = await supabase.from("matches")
        .select("id, post_id").in("id", matchIds).lte("match_date", today);
      if (!ms || ms.length === 0) { setMatchDues(0); return; }

      const postIds = ms.map((m) => m.post_id).filter(Boolean);
      const { data: bks } = await supabase.from("pitch_bookings").select("id, post_id").in("post_id", postIds);
      const bookingByPost = new Map((bks ?? []).map((b) => [b.post_id, b.id as string]));
      const bookingIds = (bks ?? []).map((b) => b.id);

      const { data: pays } = bookingIds.length
        ? await supabase.from("player_payments")
            .select("booking_id").eq("player_id", user!.id).eq("purpose", "replenish").eq("status", "paid")
            .in("booking_id", bookingIds)
        : { data: [] as { booking_id: string }[] };
      const paidBookings = new Set((pays ?? []).map((p) => p.booking_id));

      const outstanding = ms.filter((m) => {
        const bId = bookingByPost.get(m.post_id);
        return bId && !paidBookings.has(bId);
      }).length;
      setMatchDues(outstanding);
    }
    loadDues();
  }, [user]);

  // Unread direct messages — includes captain-sent payment reminders.
  useEffect(() => {
    if (!user) { setUnreadMessages(0); return; }
    supabase.from("messages")
      .select("id", { count: "exact", head: true }).eq("receiver_id", user.id).eq("read", false)
      .then(({ count }) => setUnreadMessages(count ?? 0));
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

  const unreadCount = (joinRequests > 0 ? 1 : 0) + (openPosts > 0 ? 1 : 0) + (matchDues > 0 ? 1 : 0);

  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-16 w-full bg-background flex items-center justify-between gap-2 px-4">

      {/* ── Logo ── */}
      <a href="/" className="text-xl font-bold tracking-tight flex-shrink-0">
        Unitr<span className="text-accent">.</span>
      </a>

      <div className="flex items-center gap-2">

      {/* ── Notification bell ── */}
      {user && (
      <div className="relative" ref={notifRef}>
        <button
          onClick={() => { setNotifOpen((o) => !o); setProfileOpen(false); }}
          className="w-9 h-9 flex items-center justify-center relative"
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
          <div className="absolute right-0 top-14 w-80 bg-surface border border-border rounded-2xl shadow-xl overflow-hidden z-50">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <p className="text-sm font-bold">Notifications</p>
            </div>

            {/* Pay your share: outstanding dues for matches already played */}
            {matchDues > 0 && (
              <a href="/my-team" onClick={() => setNotifOpen(false)}
                className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2 transition-colors border-b border-border">
                <div className="w-8 h-8 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold">Pay Your Share</p>
                    <span className="text-[10px] font-bold bg-accent text-black px-1.5 py-0.5 rounded-full">{matchDues}</span>
                  </div>
                  <p className="text-[11px] text-text-secondary mt-0.5">
                    {matchDues} played {matchDues > 1 ? "matches" : "match"} awaiting your share · settle in Team Credits → Dues
                  </p>
                </div>
              </a>
            )}

            {/* Pinned: Join Requests (captain only — 0 if no pending requests) */}
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
                  <p className="text-xs font-bold">Join Requests</p>
                  {joinRequests > 0 && (
                    <span className="text-[10px] font-bold bg-accent text-black px-1.5 py-0.5 rounded-full">{joinRequests}</span>
                  )}
                </div>
                <p className="text-[11px] text-text-secondary mt-0.5">
                  {joinRequests > 0 ? `${joinRequests} pending join request${joinRequests > 1 ? "s" : ""}` : "No pending requests"}
                </p>
              </div>
            </a>

            {/* Pinned: Open Match Posts */}
            <a href="/play" onClick={() => setNotifOpen(false)}
              className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2 transition-colors">
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
                  {openPosts > 0 && (
                    <span className="text-[10px] font-bold bg-yellow-500 text-black px-1.5 py-0.5 rounded-full">{openPosts}</span>
                  )}
                </div>
                <p className="text-[11px] text-text-secondary mt-0.5">
                  {openPosts > 0 ? `${openPosts} match post awaiting opponent` : "No pending posts"}
                </p>
              </div>
            </a>
          </div>
        )}
      </div>
      )}

      {/* ── Messages ── */}
      {user && (
        <a href="/messages" aria-label="Messages"
          className="w-9 h-9 flex items-center justify-center relative">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {unreadMessages > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-accent border-2 border-background" />
          )}
        </a>
      )}

      {/* ── Profile avatar ── */}
      {user ? (
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => { setProfileOpen((o) => !o); setNotifOpen(false); }}
            className="w-12 h-12 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center"
          >
            <span className="text-base font-bold text-accent">{initials}</span>
          </button>

          {profileOpen && (
            <div className="absolute right-0 top-14 w-44 bg-surface border border-border rounded-2xl shadow-lg overflow-hidden z-50">
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
        <a href="/login" className="px-4 py-2 rounded-full bg-accent text-black text-sm font-bold">
          Sign In
        </a>
      )}
      </div>
    </div>
  );
}
