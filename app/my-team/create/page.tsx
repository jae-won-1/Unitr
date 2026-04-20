"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

const levels = ["Casual", "Competitive", "Semi-Pro"];
const formats = ["5-a-side", "7-a-side", "11-a-side"];

export default function CreateTeamPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [level, setLevel] = useState("");
  const [format, setFormat] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name || !location || !level || !format) {
      setError("Please fill in all required fields.");
      return;
    }
    if (!user) {
      setError("You must be signed in to create a team.");
      return;
    }

    setLoading(true);

    const { error: insertError } = await supabase.from("teams").insert({
      name,
      location,
      level,
      format,
      description,
      captain_id: user.id,
    });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    setLoading(false);
    router.push("/my-team");
  };

  return (
    <div className="flex flex-col min-h-screen px-4 pt-12 pb-8">
      <header className="flex items-center gap-3 mb-8">
        <a href="/my-team" className="w-9 h-9 rounded-full bg-surface-2 border border-border flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </a>
        <div>
          <h1 className="text-xl font-bold">Register Your Team</h1>
          <p className="text-xs text-text-secondary mt-0.5">Set up your team profile on Unitr</p>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-secondary">Team Name <span className="text-red-400">*</span></label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Hackney United"
            className="bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-secondary">Location <span className="text-red-400">*</span></label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Hackney, London"
            className="bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-secondary">Level <span className="text-red-400">*</span></label>
          <div className="flex gap-2 flex-wrap">
            {levels.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLevel(l)}
                className={`px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                  level === l ? "bg-accent text-black border-accent" : "bg-surface-2 border-border text-text-secondary"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-secondary">Format <span className="text-red-400">*</span></label>
          <div className="flex gap-2 flex-wrap">
            {formats.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFormat(f)}
                className={`px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                  format === f ? "bg-accent text-black border-accent" : "bg-surface-2 border-border text-text-secondary"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-secondary">Description <span className="text-text-secondary font-normal">(optional)</span></label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Tell players what your team is about..."
            className="bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60 resize-none"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3.5 rounded-xl bg-accent text-black font-bold text-sm mt-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              Creating team…
            </>
          ) : "Register Team"}
        </button>
      </form>
    </div>
  );
}
