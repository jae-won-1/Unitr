"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export type Role = "new_user" | "player" | "captain";

type RoleContextType = {
  role: Role;
  setRole: (role: Role) => void;
};

const RoleContext = createContext<RoleContextType>({
  role: "new_user",
  setRole: () => {},
});

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>("new_user");

  useEffect(() => {
    const stored = localStorage.getItem("unitr_role") as Role | null;
    if (stored) setRoleState(stored);
  }, []);

  const setRole = (r: Role) => {
    setRoleState(r);
    localStorage.setItem("unitr_role", r);
  };

  return (
    <RoleContext.Provider value={{ role, setRole }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  return useContext(RoleContext);
}
