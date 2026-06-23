"use client";

const programmes = [
  { name: "Junior Academy (U8–U10)", schedule: "Sat · 09:00–10:30", coach: "Coach Daniel", price: "£8 / session", spots: "4 spots left", level: "Beginner" },
  { name: "Junior Academy (U11–U14)", schedule: "Sat · 10:30–12:00", coach: "Coach Daniel", price: "£10 / session", spots: "Full", level: "Development" },
  { name: "Goalkeeper Clinic", schedule: "Wed · 18:00–19:00", coach: "Coach Maria", price: "£12 / session", spots: "6 spots left", level: "All levels" },
  { name: "Adult Skills & Fitness", schedule: "Tue & Thu · 19:00–20:00", coach: "Coach Leo", price: "£10 / session", spots: "9 spots left", level: "Casual" },
];

export default function VenueAcademyPage() {
  return (
    <div className="px-4 md:px-8 pt-6 pb-10 max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Academy</h1>
          <p className="text-xs text-text-secondary mt-0.5">Run coaching programmes and camps at your venue.</p>
        </div>
        <button className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-black text-xs font-bold opacity-60 cursor-not-allowed">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          Add programme
        </button>
      </div>

      <div className="bg-accent/5 border border-accent/20 rounded-xl px-4 py-3">
        <p className="text-xs text-text-secondary"><span className="font-semibold text-accent">Preview.</span> Programme enrolment and payments are coming soon — the layout below shows how it will work.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {programmes.map((p) => (
          <div key={p.name} className="bg-surface-2 border border-border rounded-2xl p-4">
            <div className="flex items-start justify-between gap-2 mb-2">
              <p className="text-sm font-bold">{p.name}</p>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-surface text-text-secondary border border-border flex-shrink-0">{p.level}</span>
            </div>
            <div className="space-y-1.5 text-xs text-text-secondary">
              <div className="flex items-center gap-2">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                {p.schedule}
              </div>
              <div className="flex items-center gap-2">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                {p.coach}
              </div>
            </div>
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
              <span className="text-sm font-bold text-accent">{p.price}</span>
              <span className={`text-xs font-medium ${p.spots === "Full" ? "text-text-secondary" : "text-accent"}`}>{p.spots}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
