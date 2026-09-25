"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmtFee } from "@/lib/joining-fee";

// The joining fee splits the same way every other charge on this platform
// does, so it lives in the same two places:
//
//   Settle Payments → JoiningFeeAmountPanel — issuing the charge: what each
//                     new member is asked for. Changeable at any time.
//   Payment Status  → JoiningFeeStatusPanel — who has covered the fee already
//                     charged to them, and a nudge for who hasn't.
//
// They used to be one panel inside Settle Payments, which put a tracking view
// on the issuing surface and left the captain with nowhere to change the fee
// short of Team Settings.

// ── Setting the fee (Settle Payments) ─────────────────────────────────────
// Writes teams.joining_fee_pence, the same column Team Settings and team
// registration write. Carrying it onto each member is the database's job
// (supabase_joining_fee_current.sql): the fee is the team's fee, so saving a
// new number here restandardises the whole squad — and the captain — onto it,
// leaving what everyone has already paid where it is.
export function JoiningFeeAmountPanel({ teamId }: { teamId: string }) {
  const [fee, setFee] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [savedPence, setSavedPence] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // select("*") rather than the named column so the panel still loads on a
      // database without the joining-fees migration.
      const { data } = await supabase.from("teams").select("*").eq("id", teamId).maybeSingle();
      const pence = (data?.joining_fee_pence as number | null) ?? 0;
      setSavedPence(pence);
      setFee(pence > 0 ? (pence / 100).toFixed(2).replace(/\.00$/, "") : "");
      setLoaded(true);
    })();
  }, [teamId]);

  const pence = fee ? Math.round(parseFloat(fee) * 100) : 0;
  const valid = Number.isFinite(pence) && pence >= 0;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    const { error: saveErr } = await supabase.from("teams")
      .update({ joining_fee_pence: pence }).eq("id", teamId);
    setSaving(false);
    if (saveErr) {
      setError(/joining_fee_pence/.test(saveErr.message)
        ? "Run supabase_joining_fees.sql in Supabase first — the fee column isn't there yet."
        : "Couldn't save the joining fee. Please try again.");
      return;
    }
    setSavedPence(pence);
    setSaved(true);
  };

  if (!loaded) {
    return <div className="py-8 text-center"><div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" /></div>;
  }

  return (
    <div className="bg-surface border border-border shadow-card rounded-card p-4">
      <p className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-1">Joining fee</p>
      <p className="text-[11px] text-text-secondary mb-3">
        Currently {savedPence > 0
          ? <span className="font-semibold text-text-primary">{fmtFee(savedPence)} per player</span>
          : "no joining fee"}.
      </p>

      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-text-secondary">£</span>
        <input
          type="number" min={0} step={1} inputMode="decimal"
          value={fee}
          onChange={(e) => { setFee(e.target.value); setSaved(false); }}
          placeholder="0 — no joining fee"
          className="w-full bg-background border border-border rounded-btn pl-8 pr-4 py-3 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/60"
        />
      </div>
      <p className="text-[11px] text-text-secondary mt-2">
        Paid once by every player, into your team&rsquo;s credit balance for pitch and
        tournament fees. Changing it changes what the whole squad owes — the players you
        already have move onto the new fee too, keeping whatever they&rsquo;ve paid. Who has
        paid theirs is in Payment Status.
      </p>

      {error && (
        <p className="text-[11px] text-red-600 bg-red-500/10 border border-red-500/30 rounded-btn px-3 py-2 mt-3">{error}</p>
      )}

      <button onClick={save} disabled={saving || !valid || (saved && pence === savedPence)}
        className="w-full py-2.5 rounded-btn bg-accent text-white font-bold text-sm mt-3 disabled:opacity-50 disabled:cursor-not-allowed">
        {saving ? "Saving…" : saved ? "Saved ✓" : "Save joining fee"}
      </button>
    </div>
  );
}

// ── Tracking the fee (Payment Status) ─────────────────────────────────────
// Who has covered their one-off joining fee. The paid amounts are advanced
// only by the server when a verified payment lands (supabase_joining_fees.sql)
// — the captain reads them here and can nudge, not tick. Cash handed over in
// person goes through Record Cash / record_cash_credit like any other credit.
type FeeRow = {
  playerId: string;
  name: string;
  duePence: number;
  paidPence: number;
};

export function JoiningFeeStatusPanel({ teamId, viewerId }: { teamId: string; viewerId: string }) {
  const [rows, setRows] = useState<FeeRow[] | null>(null);
  const [remindedIds, setRemindedIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from("team_members")
        .select("player_id, joining_fee_due_pence, joining_fee_paid_pence, profiles(full_name)")
        .eq("team_id", teamId)
        .eq("status", "approved");
      if (error) { setRows([]); return; }   // joining-fees migration not run

      // The captain owes the fee they set, like everyone else, and their copy
      // of it is on `teams` rather than team_members
      // (supabase_captain_joining_fee.sql). Read with select("*") so the row
      // still comes back before that migration is run.
      const { data: team } = await supabase
        .from("teams").select("*").eq("id", teamId).maybeSingle();
      const capDue = (team?.captain_joining_fee_due_pence as number | null) ?? 0;
      const captainRow: FeeRow[] = capDue > 0 && team?.captain_id
        ? [{
            playerId: team.captain_id as string,
            name: "Captain",
            duePence: capDue,
            paidPence: (team.captain_joining_fee_paid_pence as number | null) ?? 0,
          }]
        : [];

      setRows(
        [
          ...captainRow,
          ...(data ?? [])
            .filter((m) => (m.joining_fee_due_pence ?? 0) > 0)
            .map((m) => ({
              playerId: m.player_id as string,
              name: (m.profiles as unknown as { full_name: string } | null)?.full_name ?? "Unknown player",
              duePence: (m.joining_fee_due_pence as number) ?? 0,
              paidPence: (m.joining_fee_paid_pence as number) ?? 0,
            })),
        ]
          .sort((a, b) => {
            const aOwes = a.paidPence < a.duePence ? 0 : 1;
            const bOwes = b.paidPence < b.duePence ? 0 : 1;
            return aOwes - bOwes || a.name.localeCompare(b.name);
          })
      );
    }
    load();
  }, [teamId, viewerId]);

  const remind = async (row: FeeRow) => {
    setBusyId(row.playerId);
    await supabase.from("messages").insert({
      sender_id: viewerId,
      receiver_id: row.playerId,
      type: "payment_reminder",
      body: `Reminder: your ${fmtFee(row.duePence - row.paidPence)} joining fee is still due. Pay it via the Top Up button on Home — it goes into the team's credits for pitch and tournament fees. Until then you can't join or vote available for games.`,
    });
    setRemindedIds((prev) => new Set(prev).add(row.playerId));
    setBusyId(null);
  };

  if (rows === null) {
    return <div className="py-8 text-center"><div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" /></div>;
  }

  // An empty list is a real answer here rather than a reason to hide: this is
  // a tab the captain opened on purpose, so it says why it's empty.
  if (rows.length === 0) {
    return (
      <p className="text-xs text-text-secondary text-center py-10">
        Nobody has a joining fee charged to them. Set one in Settle Payments &rarr; Joining fee
        and it applies to the whole squad, you included.
      </p>
    );
  }

  const outstanding = rows.filter((r) => r.paidPence < r.duePence).length;

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-text-secondary">
        {outstanding === 0
          ? "Everyone has paid their joining fee."
          : `${outstanding} of ${rows.length} still to pay.`}
      </p>
      {rows.map((row) => {
        const paid = row.paidPence >= row.duePence;
        return (
          <div key={row.playerId} className="flex items-center gap-2 bg-panel border border-border rounded-btn px-3.5 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{row.playerId === viewerId ? "You" : row.name}</p>
              <p className="text-[10px] text-text-secondary">
                {paid
                  // Lowering the fee can leave someone above it. They aren't
                  // refunded — it's team credit either way — so say what they
                  // actually put in rather than the smaller figure now asked.
                  ? `${fmtFee(Math.max(row.paidPence, row.duePence))} paid`
                  : row.paidPence > 0
                  ? `${fmtFee(row.paidPence)} of ${fmtFee(row.duePence)} paid`
                  : `${fmtFee(row.duePence)} due`}
              </p>
            </div>
            {paid ? (
              <span className="text-[11px] font-bold bg-success-bg text-accent-ink px-3 py-1 rounded-full flex-shrink-0">Paid</span>
            ) : row.playerId === viewerId ? (
              // The viewer's own row: nobody to remind but themselves, so it
              // says where to pay instead of offering a self-DM.
              <span className="text-[11px] font-bold text-red-600 bg-red-500/10 border border-red-500/30 px-3 py-1 rounded-full flex-shrink-0">Top up on Home</span>
            ) : (
              <button onClick={() => remind(row)}
                disabled={busyId === row.playerId || remindedIds.has(row.playerId)}
                className="text-[11px] font-bold bg-[#FDECEC] text-danger px-3 py-1 rounded-full flex-shrink-0 disabled:opacity-60">
                {remindedIds.has(row.playerId) ? "Reminded ✓" : busyId === row.playerId ? "Sending…" : "Remind"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
