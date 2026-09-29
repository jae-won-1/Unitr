"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

export type Role = "new_user" | "player" | "captain" | "venue_manager" | "admin";

type RoleContextType = {
  role: Role;
  roleLoading: boolean;
  /**
   * True when this user reaches the `captain` role by being a co-captain
   * rather than the captain. They get the captain's screens; the one thing
   * they don't get is appointing other co-captains, which is the only place
   * that needs to tell the two apart.
   */
  isCoCaptain: boolean;
  /**
   * Signed in, but there is no `profiles` row. Google sign-in creates the
   * account before anybody has answered a single question, so this is the
   * state between the callback and /welcome — components/ProfileGate is what
   * acts on it. False while signed out, and false on a failed lookup: a query
   * that errored is not an account without a profile.
   */
  profileMissing: boolean;
};

const RoleContext = createContext<RoleContextType>({
  role: "new_user",
  roleLoading: true,
  isCoCaptain: false,
  profileMissing: false,
});

export function RoleProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [role, setRole] = useState<Role>("new_user");
  const [roleLoading, setRoleLoading] = useState(true);
  const [isCoCaptain, setIsCoCaptain] = useState(false);
  const [profileMissing, setProfileMissing] = useState(false);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setRole("new_user");
      setIsCoCaptain(false);
      setProfileMissing(false);
      setRoleLoading(false);
      return;
    }

    setRoleLoading(true);

    // Check account_type first — venue managers skip player role logic
    supabase
      .from("profiles")
      .select("account_type")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data: profile, error: profileError }) => {
        setProfileMissing(!profileError && !profile);

        if (profile?.account_type === "venue_manager") {
          setRole("venue_manager");
          setRoleLoading(false);
          return;
        }

        // Uniter staff (set by hand in the Supabase dashboard). Admin wins even
        // if the account also captains a team — they get the admin Home.
        if (profile?.account_type === "admin") {
          setRole("admin");
          setRoleLoading(false);
          return;
        }

        // Captain check (takes priority over player)
        supabase
          .from("teams")
          .select("id")
          .eq("captain_id", user.id)
          .maybeSingle()
          .then(({ data: team }) => {
            if (team) {
              setRole("captain");
              setIsCoCaptain(false);
              setRoleLoading(false);
              return;
            }
            // Check approved team membership. A member the captain promoted
            // (is_co_captain) gets the captain's role and so the captain's
            // screens — that IS the feature. `select("*")` rather than named
            // columns so the page still resolves a role when
            // supabase_co_captains.sql hasn't been run.
            supabase
              .from("team_members")
              .select("*")
              .eq("player_id", user.id)
              .eq("status", "approved")
              .maybeSingle()
              .then(({ data: membership }) => {
                const co = Boolean(membership?.is_co_captain);
                setIsCoCaptain(co);
                setRole(membership ? (co ? "captain" : "player") : "new_user");
                setRoleLoading(false);
              });
          });
      });
  }, [user, authLoading]);

  return (
    <RoleContext.Provider value={{ role, roleLoading, isCoCaptain, profileMissing }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  return useContext(RoleContext);
}
