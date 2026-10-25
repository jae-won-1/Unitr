"use client";

import { useAuth } from "@/contexts/AuthContext";
import { OFF_REASON, type Feature } from "@/lib/launch-scope";

// What a page belonging to a switched-off feature (lib/launch-scope.ts) shows
// instead of itself, for anyone who reaches it by its URL — an old link, a
// bookmark. Nothing in the app links here while the feature is off.
//
// A venue account has nowhere else in the app to go (every player route sends
// it back to /venue), so it is offered Sign out rather than Home.
export default function SwitchedOff({ feature }: { feature: Feature }) {
  const { signOut } = useAuth();
  const venue = feature === "venues";

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-surface border border-border shadow-card rounded-card p-6 text-center">
        <p className="font-bold">Not in this version</p>
        <p className="text-sm text-text-secondary mt-2">{OFF_REASON[feature]}</p>
        {venue ? (
          <button type="button" onClick={() => signOut("/login")}
            className="mt-5 w-full py-3 rounded-btn bg-accent text-white text-sm font-bold">
            Sign out
          </button>
        ) : (
          <a href="/" className="mt-5 block w-full py-3 rounded-btn bg-accent text-white text-sm font-bold">
            Back to Home
          </a>
        )}
      </div>
    </div>
  );
}
