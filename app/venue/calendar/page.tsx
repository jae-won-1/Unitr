"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { loadVenuePitches } from "@/lib/venue-pitches";

// Every pitch has its own calendar (/venue/calendar/[pitchId]). This address
// is still where login, the invite page and the player app send a venue
// manager, so it opens the first pitch's calendar — the top one in the sidebar.
export default function VenueCalendarIndex() {
  const { user } = useAuth();
  const router = useRouter();
  const [noPitches, setNoPitches] = useState(false);

  useEffect(() => {
    if (!user) return;
    loadVenuePitches(user.id).then((ps) => {
      if (ps[0]) router.replace(`/venue/calendar/${ps[0].id}`);
      else setNoPitches(true);
    });
  }, [user, router]);

  if (noPitches) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center gap-4">
      <p className="font-bold text-lg">No pitches registered</p>
      <p className="text-sm text-text-secondary max-w-xs">Each pitch you register gets its own calendar.</p>
      <a href="/pitches/register" className="px-6 py-3 bg-accent text-white rounded-btn font-bold text-sm">Register a Pitch</a>
    </div>
  );

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  );
}
