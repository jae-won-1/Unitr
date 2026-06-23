"use client";

import VenueListingsView from "@/components/VenueListingsView";

export default function VenueTournamentsPage() {
  return (
    <VenueListingsView
      matchType="tournament"
      title="Tournaments"
      subtitle="Run multi-team events at your venue — teams enter from the Play feed."
      createLabel="Create Tournament"
      emptyText="No tournaments yet"
    />
  );
}
