"use client";

import BookPitchPanel from "@/components/BookPitchPanel";

// Booking a pitch outright, with no opponent involved. The bookings themselves
// are no longer listed here — they're a filter on the Calendar, which is where
// every other commitment lives too.

export default function BookPage() {
  return (
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-24">
      <header className="mb-5">
        <h1 className="text-2xl font-extrabold mb-1">Book a Pitch</h1>
        <p className="text-text-secondary text-sm">Book a pitch directly — no opponent needed</p>
      </header>

      <div className="-mx-4">
        <BookPitchPanel />
      </div>
    </div>
  );
}
