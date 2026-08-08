"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type AuthContextType = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  // Clears the session and navigates. Signing out without going anywhere left
  // the viewer on a page they're no longer entitled to — most visibly in the
  // venue portal, which has no signed-out state and just sat there empty.
  signOut: (redirectTo?: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for sign-in / sign-out events
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // A full page load rather than a router push: it drops every bit of
  // user-scoped state the app is holding (role, team, cached queries) instead
  // of leaving it for the next person to sign in on this device. If Supabase
  // errors we still leave — the local session is gone either way.
  const signOut = async (redirectTo = "/") => {
    try {
      await supabase.auth.signOut();
    } finally {
      window.location.assign(redirectTo);
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
