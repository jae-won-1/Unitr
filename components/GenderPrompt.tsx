"use client";

// Asks, once, a player who has never told us their gender. Players registered
// before the question existed have none on file, and it now decides which
// games and teams they see by default (lib/viewer-gender.ts). Mounted
// app-wide beside ProfileGate.
//
// "Prefer not to say" is a full answer, not a skip: it is saved, the sheet
// never comes back, and that player simply sees everything by default. There
// is no "later" — the sheet would return on every page, and an answer is one
// tap. Edit Profile changes it afterwards.

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/contexts/RoleContext";
import { GENDERS } from "@/lib/profile-options";
import { loadViewerGender, saveOwnGender } from "@/lib/viewer-gender";

// Sign-up screens ask the question themselves (and /welcome is where a
// profile-less account belongs) — never stack a second sheet on top.
const SKIP_ROUTES = [
  "/welcome", "/auth/callback", "/login", "/register",
  "/forgot-password", "/reset-password", "/join",
];

export default function GenderPrompt() {
  const { user } = useAuth();
  const { role, roleLoading, profileMissing } = useRole();
  const pathname = usePathname();
  const [ask, setAsk] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const skip = SKIP_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
  const eligible = Boolean(user) && !roleLoading && !profileMissing
    && role !== "venue_manager" && role !== "admin" && !skip;

  useEffect(() => {
    if (!eligible || !user) { setAsk(false); return; }
    let cancelled = false;
    loadViewerGender(user.id).then((v) => { if (!cancelled) setAsk(v.unanswered); });
    return () => { cancelled = true; };
  }, [eligible, user]);

  if (!ask || !user) return null;

  const answer = async (value: string) => {
    setSaving(value);
    setError(null);
    const err = await saveOwnGender(user.id, value);
    if (err) { setSaving(null); setError("Couldn't save that. Please try again."); return; }
    // Every feed on screen picked its default before we knew — start them again.
    window.location.reload();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-scrim">
      <div className="w-full max-w-md bg-surface border-t border-border rounded-t-2xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <p className="font-bold text-lg mb-1">One quick question</p>
        <p className="text-sm text-text-secondary mb-4">
          Uniter now has men&rsquo;s and women&rsquo;s games. Your answer decides which games, teams
          and players you see first — you can always switch to see everyone, and change your answer
          in Edit Profile.
        </p>
        <div className="flex flex-col gap-2">
          {GENDERS.map((g) => (
            <button key={g.value} type="button" disabled={saving !== null} onClick={() => answer(g.value)}
              className="w-full py-3 rounded-btn border border-border bg-surface-2 text-sm font-semibold text-text-primary disabled:opacity-50">
              {saving === g.value ? "Saving…" : g.label}
            </button>
          ))}
        </div>
        {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
      </div>
    </div>
  );
}
