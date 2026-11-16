"use client";

import { useCallback, useEffect, useState } from "react";
import { LINKED_FINANCE } from "@/lib/finance-mode";
import { loadOwed, NOTHING_OWED, type Owed } from "@/lib/team-finance";

// What the signed-in player owes a team in payment requests, for the Home
// tiles. Asks nothing at all while the app is still on team credit, so it can
// be called unconditionally beside the credit hooks it replaces.
export function useOwed(teamId: string | null | undefined) {
  const [owed, setOwed] = useState<Owed>(NOTHING_OWED);
  const [loading, setLoading] = useState(LINKED_FINANCE);

  const reload = useCallback(async () => {
    if (!LINKED_FINANCE) return;
    setOwed(await loadOwed(teamId));
    setLoading(false);
  }, [teamId]);

  useEffect(() => { reload(); }, [reload]);

  return { ...owed, loading, reload };
}
