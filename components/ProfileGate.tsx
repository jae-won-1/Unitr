"use client";

// An account with a session but no `profiles` row belongs on /welcome, and
// nowhere else. Google sign-in is what creates one: the account exists the
// moment consent is given, so somebody who closes the tab half way through
// setting up comes back signed in and profile-less. Without this they'd land
// on Home as a new_user, with no name, no position, and no way back to the
// questions.
//
// It costs no query: RoleContext already reads the profile to resolve a role,
// and reports the row's absence (never a failed lookup) as profileMissing.
// Renders nothing.

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/contexts/RoleContext";

// The screens that are part of getting an account in the first place. /welcome
// itself is obviously one; redirecting away from the auth pages would also
// take somebody mid-sign-in off the form they were filling in.
const SETUP_ROUTES = [
  "/welcome", "/auth/callback", "/login", "/register",
  "/forgot-password", "/reset-password",
];

export default function ProfileGate() {
  const { loading: authLoading } = useAuth();
  const { profileMissing, roleLoading } = useRole();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (authLoading || roleLoading || !profileMissing) return;
    if (SETUP_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))) return;
    router.replace("/welcome");
  }, [authLoading, roleLoading, profileMissing, pathname, router]);

  return null;
}
