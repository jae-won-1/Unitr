"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type PitchOption = {
  id: string;
  name: string;
  address: string;
  price: number;
  format: string;
  distance: string;
  time?: string;
};

type Post = {
  id: string;
  captain_id: string;
  team_name: string;
  match_date: string;
  match_time: string;
  pitch_options: PitchOption[];
  description: string | null;
  status: string;
};

function fmtPostDate(matchDate: string, matchTime: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(matchDate)) {
    const d = new Date(matchDate + "T12:00:00");
    return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · ${matchTime}`;
  }
  return `${matchDate} · ${matchTime}`;
}

export default function EditMatchPostPage({ params }: { params: { postId: string } }) {
  const router = useRouter();
  const { user } = useAuth();
  const [post, setPost] = useState<Post | null | undefined>(undefined);
  const [description, setDescription] = useState("");
  const [pitchOptions, setPitchOptions] = useState<PitchOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    supabase.from("match_posts").select("*").eq("id", params.postId).maybeSingle()
      .then(({ data }) => {
        setPost((data as Post) ?? null);
        if (data) {
          setDescription(data.description ?? "");
          setPitchOptions((data.pitch_options ?? []) as PitchOption[]);
        }
      });
  }, [params.postId]);

  const isOwner = post && user && post.captain_id === user.id;

  const removePitchOption = (id: string) => {
    setPitchOptions((prev) => prev.filter((p) => p.id !== id));
  };

  const handleSave = async () => {
    if (!post) return;
    if (pitchOptions.length === 0) { setError("Keep at least one pitch option."); return; }
    setSaving(true);
    setError(null);
    const { error: updateErr } = await supabase.from("match_posts")
      .update({ description: description.trim() || null, pitch_options: pitchOptions })
      .eq("id", post.id);
    setSaving(false);
    if (updateErr) { setError(updateErr.message); return; }
    setSaved(true);
  };

  if (post === undefined) {
    return <div className="flex items-center justify-center min-h-screen"><div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;
  }

  if (!post || !isOwner) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center gap-3">
        <p className="font-semibold">Post not found</p>
        <p className="text-sm text-text-secondary">This post doesn&apos;t exist or isn&apos;t yours to edit.</p>
        <a href="/play" className="px-6 py-3 rounded-xl bg-accent text-black font-bold text-sm mt-2">Back to Play</a>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen px-4 pt-12 pb-8">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.back()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Edit Match Post</h1>
          <p className="text-xs text-text-secondary mt-0.5">{post.team_name}</p>
        </div>
        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full flex-shrink-0 ${post.status === "matched" ? "bg-accent/10 text-accent border border-accent/30" : "bg-surface-2 border border-border text-text-secondary"}`}>
          {post.status === "matched" ? "Matched" : "Open"}
        </span>
      </div>

      <div className="flex flex-col gap-5">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        <section className="bg-surface-2 border border-border rounded-2xl p-4">
          <p className="text-sm font-semibold mb-2">Match Date</p>
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            {fmtPostDate(post.match_date, post.match_time)}
          </div>
          <p className="text-xs text-text-secondary mt-2">
            To change the date or time, take this post down and create a new one.
          </p>
        </section>

        <section className="bg-surface-2 border border-border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold">Pitch Options</p>
            <span className="text-xs text-text-secondary">{pitchOptions.length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {pitchOptions.map((p, i) => (
              <div key={p.id} className="flex items-center gap-3 bg-background border border-border rounded-xl px-3 py-2.5">
                <div className="w-7 h-7 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-bold text-accent">{i + 1}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{p.name}</p>
                  <p className="text-xs text-text-secondary">{p.format} · £{p.price}/hr</p>
                </div>
                {pitchOptions.length > 1 && (
                  <button onClick={() => removePitchOption(p.id)} className="text-xs text-red-400 flex-shrink-0 ml-1">✕</button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold">Description <span className="text-text-secondary font-normal">(optional)</span></label>
          <textarea rows={3} placeholder="Tell teams what to expect..."
            value={description} onChange={(e) => setDescription(e.target.value)}
            className="bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/50 resize-none" />
        </section>

        <div className="flex gap-3 pt-2">
          <button onClick={() => router.back()}
            className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold text-text-secondary">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-3 rounded-xl bg-accent text-black font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            {saving ? (
              <><svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Saving…</>
            ) : saved ? "Saved ✓" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
