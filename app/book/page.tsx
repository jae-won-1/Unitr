"use client";

import { useState } from "react";
import BookPitchPanel from "@/components/BookPitchPanel";
import MyBookingsPanel from "@/components/MyBookingsPanel";

type BookView = "book" | "mybookings";

export default function BookPage() {
  const [view, setView] = useState<BookView>("book");

  return (
    <div className="flex flex-col min-h-screen px-4 pt-16 pb-24">
      <header className="mb-5">
        <h1 className="text-2xl font-bold mb-1">Play</h1>
        <p className="text-text-secondary text-sm">
          {view === "book" ? "Book a pitch directly — no opponent needed" : "Manage pitches you've booked directly"}
        </p>
      </header>

      <div className="flex bg-surface-2 border border-border rounded-xl p-1 mb-5">
        {([{ key: "book", label: "Book" }, { key: "mybookings", label: "My Bookings" }] as { key: BookView; label: string }[]).map((v) => (
          <button key={v.key} onClick={() => setView(v.key)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${view === v.key ? "bg-accent text-black" : "text-text-secondary"}`}>
            {v.label}
          </button>
        ))}
      </div>

      {view === "book" ? (
        <div className="-mx-4">
          <BookPitchPanel />
        </div>
      ) : (
        <MyBookingsPanel />
      )}
    </div>
  );
}
