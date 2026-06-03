"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function VenueAvailabilityRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/venue/settings"); }, [router]);
  return null;
}
