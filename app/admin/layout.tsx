"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

// Gate + slim tab strip for the Unitr staff area. Admins keep the normal
// player chrome (TopBar/BottomNav) — this is a section inside the app, not a
// separate portal like /venue. Also guards the previously-open /admin/finance.

const TABS = [
  { label: "Hub", href: "/admin" },
  { label: "Host an event", href: "/admin/create" },
  { label: "Posts", href: "/admin/posts" },
  { label: "Finance", href: "/admin/finance" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace("/"); return; }
    supabase.from("profiles").select("account_type").eq("id", user.id).maybeSingle()
      .then(({ data }) => {
        if (data?.account_type === "admin") setAllowed(true);
        else router.replace("/");
      });
  }, [user, authLoading, router]);

  if (allowed !== true) {
    return <div className="flex items-center justify-center min-h-screen"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;
  }

  return (
    <div className="px-4 pt-16 pb-24 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold">Unitr Admin</h1>
        <span className="text-[10px] font-semibold bg-accent/10 text-accent border border-accent/30 px-2 py-0.5 rounded-full">staff</span>
      </div>
      <div className="flex gap-2 overflow-x-auto py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((t) => {
          const active = pathname === t.href;
          return (
            <Link key={t.href} href={t.href}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border ${
                active ? "bg-accent/10 border-accent/40 text-accent" : "border-border text-text-secondary"
              }`}>
              {t.label}
            </Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}
