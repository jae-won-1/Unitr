"use client";

import VenueListingsView from "@/components/VenueListingsView";

export default function VenueMatchesPage() {
  return (
    <VenueListingsView
      matchType="match"
      title="Open Matches"
      subtitle="Host games teams can buy into — fill empty slots and boost revenue."
      createLabel="Create Match"
      emptyText="No open matches yet"
    />
  );
}
