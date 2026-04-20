"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export type MediaItem = {
  id: string;
  type: "image" | "video";
  label: string;
  matchId?: string; // if match-specific, else team tactics
};

export type TacticsData = {
  formation: string;
  style: string | null;
  pressing: string | null;
  notes: string;
  media: MediaItem[];
};

type TacticsContextType = {
  tactics: TacticsData;
  saveTactics: (data: Partial<TacticsData>) => void;
};

const defaults: TacticsData = {
  formation: "4-3-3",
  style: "High Press",
  pressing: "High",
  notes: "Press high from the front. Wingers track back when we lose possession. Set pieces — LW and RW attack near and far post on corners.",
  media: [
    { id: "m1", type: "image", label: "Corner routine — near post flick-on" },
    { id: "m2", type: "video", label: "High press trigger zones" },
    { id: "m3", type: "image", label: "Defensive shape out of possession" },
  ],
};

const TacticsContext = createContext<TacticsContextType>({
  tactics: defaults,
  saveTactics: () => {},
});

export function TacticsProvider({ children }: { children: ReactNode }) {
  const [tactics, setTactics] = useState<TacticsData>(defaults);

  useEffect(() => {
    const stored = localStorage.getItem("unitr_tactics");
    if (stored) {
      try { setTactics(JSON.parse(stored)); } catch {}
    }
  }, []);

  const saveTactics = (data: Partial<TacticsData>) => {
    setTactics((prev) => {
      const next = { ...prev, ...data };
      localStorage.setItem("unitr_tactics", JSON.stringify(next));
      return next;
    });
  };

  return (
    <TacticsContext.Provider value={{ tactics, saveTactics }}>
      {children}
    </TacticsContext.Provider>
  );
}

export function useTactics() {
  return useContext(TacticsContext);
}
