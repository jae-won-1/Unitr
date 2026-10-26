"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { accountDeletionBlock, deleteOwnAccount } from "@/lib/delete-account";
import { hardNavigate } from "@/lib/hard-navigate";

// The foot of /profile: delete this account (lib/delete-account.ts). Asks a
// second time, like Leave team, and says plainly what goes and what stays.
//
// A captain sees the button greyed with the reason — they hand the team to a
// co-captain first — per the house convention, so the way out is visible.
export default function DeleteAccountPanel() {
  const { user } = useAuth();
  const [block, setBlock] = useState<string | null | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    accountDeletionBlock(user.id).then(setBlock);
  }, [user]);

  if (!user) return null;

  async function confirm() {
    setBusy(true);
    setError(null);
    const res = await deleteOwnAccount();
    if ("error" in res) { setBusy(false); setError(res.error); return; }
    hardNavigate("/");
  }

  return (
    <div className="pt-2">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={block !== null}
        className="w-full py-3 rounded-xl text-red-600 font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Delete account
      </button>
      {block && <p className="text-xs text-text-secondary text-center mt-1">{block}</p>}

      {confirming && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center px-4 pb-4"
          onClick={() => !busy && setConfirming(false)}>
          <div className="w-full max-w-sm bg-surface border border-border rounded-card p-5" onClick={(e) => e.stopPropagation()}>
            <p className="font-bold">Delete your account?</p>
            <p className="text-sm text-text-secondary mt-2">
              You leave your squad, your saved card is removed and your profile is erased. This
              can&rsquo;t be undone.
            </p>
            <p className="text-sm text-text-secondary mt-2">
              Payment records stay, because Uniter has to keep them — and anything you still owe
              your team stays owed. Team credit isn&rsquo;t refunded.
            </p>
            {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
            <div className="flex gap-2 mt-5">
              <button type="button" onClick={() => setConfirming(false)} disabled={busy}
                className="flex-1 py-3 rounded-btn border border-border text-sm font-semibold disabled:opacity-50">
                Cancel
              </button>
              <button type="button" onClick={confirm} disabled={busy}
                className="flex-1 py-3 rounded-btn bg-red-600 text-white text-sm font-bold disabled:opacity-50">
                {busy ? "Deleting…" : "Delete account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
