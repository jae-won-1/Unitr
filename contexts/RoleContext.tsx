"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

export type Role = "new_user" | "player" | "captain" | "venue_manager" | "admin";

type RoleContextType = {
  role: Role;
  roleLoading: boolean;
};

const RoleContext = createContext<RoleContextType>({
  role: "new_user",
  roleLoading: true,
});

export function RoleProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [role, setRole] = useState<Role>("new_user");
  const [roleLoading, setRoleLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setRole("new_user");
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
      .then(({ data: profile }) => {
        if (profile?.account_type === "venue_manager") {
          setRole("venue_manager");
          setRoleLoading(false);
          return;
        }

        // Unitr staff (set by hand in the Supabase dashboard). Admin wins even
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
              setRoleLoading(false);
              return;
            }
            // Check approved team membership
            supabase
              .from("team_members")
              .select("id")
              .eq("player_id", user.id)
              .eq("status", "approved")
              .maybeSingle()
              .then(({ data: membership }) => {
                setRole(membership ? "player" : "new_user");
                setRoleLoading(false);
              });
          });
      });
  }, [user, authLoading]);

  return (
    <RoleContext.Provider value={{ role, roleLoading }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  return useContext(RoleContext);
}
