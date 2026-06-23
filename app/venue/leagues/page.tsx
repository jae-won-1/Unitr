"use client";

import VenueListingsView from "@/components/VenueListingsView";

export default function VenueLeaguesPage() {
  return (
    <VenueListingsView
      matchType="league"
      title="Leagues"
      subtitle="Set up a recurring league — teams register from the Play feed and pay an entry fee."
      createLabel="Create League"
      emptyText="No leagues yet"
    />
  );
}
