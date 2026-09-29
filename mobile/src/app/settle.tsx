// Settle payments — the tournament half of the web's SettlePaymentsModal, for
// the captain and co-captains: after a tournament, ask each player who took
// part for their share of what the team paid to enter.
//
// Issuing, not chasing. The web splits the two on purpose (CLAUDE.md, "Settle
// Payments vs Payment Status"), and this screen keeps that split:
//   • issuing a request is ported — the same payment_collection_status rows and
//     the same payment-reminder DM the web writes, split the same way;
//   • marking someone as PAID is not. payment_collection_status.received is
//     written in exactly one place on purpose (markReceived in the web's
//     TeamCreditsBar, which also moves credited_pence and rolls the fixture's
//     fees_settled). A second writer here would break that. After issuing, the
//     screen shows who has paid, read-only — players' own payments mark
//     themselves off when they pay through "What you owe".
//
// What the team paid comes from the shared loadTournamentEntries (the debit
// actually written at entry, so any invitation discount is already in it).
// Who took part, and the split, are copies of the web panel's logic — keep them
// in step. Friendlies aren't here: there's no way to play one on mobile yet.

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { loadLeadership } from '@/lib/team-leadership';
import { fmtDate, loadTournamentEntries, parseOptionDate, type HistoryFixture } from '@/lib/settle-payments';
import { withFee } from '@/lib/uniter-fee';
import { fmtFee } from '@/lib/joining-fee';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';

type RosterPlayer = { player_id: string; name: string };
type CollectRow = { player_id: string; share_pence: number; received: boolean };

export default function Settle() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { user } = useAuth();
  const [teamId, setTeamId] = useState<string | null | undefined>(undefined);
  const [fixtures, setFixtures] = useState<HistoryFixture[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const led = await loadLeadership(user.id);
      if (!led?.canManage) {
        setTeamId(null);
        return;
      }
      setTeamId(led.teamId);
      const entries = await loadTournamentEntries(led.teamId);
      // Newest first; a fully settled entry has nothing left to issue, as on
      // the web, so it drops out.
      setFixtures(entries.filter((f) => !f.settled).sort((a, b) => b.date.localeCompare(a.date)));
    })();
  }, [user]);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
        <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      <Text style={styles.heading}>Settle payments</Text>
      <Text style={styles.sub}>Ask the players who took part for their share of each tournament entry.</Text>

      {teamId === undefined ? (
        <ActivityIndicator color={theme.accent} style={{ marginTop: 30 }} />
      ) : teamId === null ? (
        <Text style={styles.muted}>Only the team captain or a co-captain can settle payments.</Text>
      ) : fixtures.length === 0 ? (
        <Text style={styles.muted}>No tournament entries waiting to be settled.</Text>
      ) : (
        fixtures.map((f) => (
          <View key={f.key} style={styles.card}>
            <Pressable onPress={() => setOpen(open === f.key ? null : f.key)} style={styles.cardHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{f.label}</Text>
                <Text style={styles.small}>
                  {fmtDate(f.date)}
                  {f.time ? ` · ${f.time}` : ''} · entry {fmtFee(f.teamPoolPence)}
                </Text>
              </View>
              <Ionicons name={open === f.key ? 'chevron-up' : 'chevron-down'} size={18} color={theme.textSecondary} />
            </Pressable>
            {open === f.key && teamId && f.openMatchId && (
              <CollectPanel teamId={teamId} openMatchId={f.openMatchId} fixture={f} styles={styles} theme={theme} />
            )}
          </View>
        ))
      )}
    </ScrollView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function CollectPanel({
  teamId,
  openMatchId,
  fixture,
  styles,
  theme,
}: {
  teamId: string;
  openMatchId: string;
  fixture: HistoryFixture;
  styles: Styles;
  theme: ReturnType<typeof useTheme>;
}) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [participants, setParticipants] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<CollectRow[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = withFee(fixture.teamPoolPence);

  // Who took part — the web panel's order of evidence: the tournament's own
  // availability answers; failing that, the poll for that date; failing that
  // (a tournament is bought by the team as a whole), the whole squad.
  const load = useCallback(async () => {
    const [{ data: members }, { data: team }, { data: confs }, { data: statusRows }, { data: polls }] = await Promise.all([
      supabase.from('team_members').select('player_id, profiles(full_name)').eq('team_id', teamId).eq('status', 'approved'),
      supabase.from('teams').select('captain_id').eq('id', teamId).maybeSingle(),
      supabase.from('match_confirmations').select('player_id, status').eq('open_match_id', openMatchId).eq('team_id', teamId),
      supabase.from('payment_collection_status').select('player_id, share_pence, received').eq('open_match_id', openMatchId).eq('team_id', teamId),
      supabase.from('availability_requests').select('id, date_options').eq('team_id', teamId),
    ]);
    const { data: captainProfile } = team?.captain_id
      ? await supabase.from('profiles').select('full_name').eq('id', team.captain_id).maybeSingle()
      : { data: null };
    const list: RosterPlayer[] = [
      ...(members ?? []).map((m) => ({
        player_id: m.player_id as string,
        name: (m.profiles as unknown as { full_name: string } | null)?.full_name ?? 'Player',
      })),
      ...(team?.captain_id ? [{ player_id: team.captain_id as string, name: (captainProfile?.full_name as string) ?? 'Captain' }] : []),
    ].filter((p, i, arr) => arr.findIndex((x) => x.player_id === p.player_id) === i);
    setRoster(list);
    setRows((statusRows ?? []) as CollectRow[]);

    const played = new Set<string>();
    for (const c of (confs ?? []).filter((c) => c.status === 'confirmed')) played.add(c.player_id as string);
    if (played.size === 0) {
      type Opt = { id: string; date: string };
      for (const poll of (polls ?? []) as { id: string; date_options: Opt[] }[]) {
        const optionIds = (poll.date_options ?? []).filter((o) => parseOptionDate(o.date) === fixture.date).map((o) => o.id);
        if (optionIds.length === 0) continue;
        const { data: resps } = await supabase.from('availability_responses').select('player_id, available_date_ids').eq('request_id', poll.id);
        for (const r of resps ?? []) {
          if (((r.available_date_ids as string[]) ?? []).some((id) => optionIds.includes(id))) played.add(r.player_id as string);
        }
        break;
      }
    }
    if (played.size === 0) for (const p of list) played.add(p.player_id);
    const inRoster = new Set(list.filter((p) => played.has(p.player_id)).map((p) => p.player_id));
    setParticipants(inRoster);
    if (!statusRows || statusRows.length === 0) setChecked(new Set(inRoster));
    setLoading(false);
  }, [teamId, openMatchId, fixture.date]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // The same split and the same two writes as the web panel: the total shared
  // equally, the odd pennies going to the first few, one bookkeeping row and
  // one reminder DM per player.
  const send = async () => {
    if (!user || checked.size === 0) return;
    setSending(true);
    setError(null);
    const ids = Array.from(checked);
    const n = ids.length;
    const base = Math.floor(total / n);
    const remainder = total - base * n;
    const newRows: CollectRow[] = ids.map((id, i) => ({ player_id: id, share_pence: base + (i < remainder ? 1 : 0), received: false }));

    const { error: insErr } = await supabase.from('payment_collection_status').insert(
      newRows.map((r) => ({
        open_match_id: openMatchId,
        team_id: teamId,
        player_id: r.player_id,
        included: true,
        share_pence: r.share_pence,
        received: false,
      })),
    );
    if (insErr) {
      setSending(false);
      setError("Couldn't send the requests. Please try again.");
      return;
    }
    await supabase.from('messages').insert(
      newRows.map((r) => ({
        sender_id: user.id,
        receiver_id: r.player_id,
        type: 'payment_reminder',
        open_match_id: openMatchId,
        body: `You owe £${(r.share_pence / 100).toFixed(2)} for entering ${fixture.label} (${fmtDate(fixture.date)}). Please pay your captain.`,
      })),
    );
    setRows(newRows);
    setSending(false);
  };

  if (loading) return <ActivityIndicator color={theme.accent} style={{ marginVertical: 12 }} />;

  const nameOf = (p: RosterPlayer) => (p.player_id === user?.id ? 'You' : p.name);

  if (rows.length > 0) {
    const paid = rows.filter((r) => r.received).length;
    return (
      <View style={{ gap: 6, marginTop: 8 }}>
        <Text style={styles.small}>
          Requested from {rows.length} player{rows.length === 1 ? '' : 's'} · {fmtFee(rows.reduce((s, r) => s + r.share_pence, 0))} total ·{' '}
          {paid}/{rows.length} paid
        </Text>
        {roster.map((p) => {
          const row = rows.find((r) => r.player_id === p.player_id);
          return (
            <View key={p.player_id} style={styles.personRow}>
              <Text style={styles.personName} numberOfLines={1}>{nameOf(p)}</Text>
              {row ? (
                <>
                  <Text style={styles.small}>{fmtFee(row.share_pence)}</Text>
                  <View style={[styles.pill, row.received ? styles.pillPaid : styles.pillUnpaid]}>
                    <Text style={[styles.pillText, { color: row.received ? theme.accentInk : theme.danger }]}>
                      {row.received ? 'Paid ✓' : 'Unpaid'}
                    </Text>
                  </View>
                </>
              ) : (
                <Text style={styles.small}>Not charged</Text>
              )}
            </View>
          );
        })}
        <Text style={styles.small}>
          Players who pay through the app are marked off automatically. To mark a cash payment or remind someone, use
          Payment Status on the web app.
        </Text>
      </View>
    );
  }

  const playedList = roster.filter((p) => participants.has(p.player_id));
  const others = roster.filter((p) => !participants.has(p.player_id));
  const row = (p: RosterPlayer) => {
    const on = checked.has(p.player_id);
    return (
      <Pressable key={p.player_id} onPress={() => toggle(p.player_id)} style={styles.personRow}>
        <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={on ? theme.accent : theme.textSecondary} />
        <Text style={styles.personName} numberOfLines={1}>{nameOf(p)}</Text>
      </Pressable>
    );
  };

  return (
    <View style={{ gap: 6, marginTop: 8 }}>
      <Text style={styles.small}>
        Total to share: <Text style={{ color: theme.textPrimary, fontFamily: fonts.semibold }}>{fmtFee(total)}</Text>
        {checked.size > 0 ? ` · ${fmtFee(Math.ceil(total / checked.size))} each` : ''}
      </Text>
      <Text style={styles.groupLabel}>Played</Text>
      {playedList.length > 0 ? playedList.map(row) : <Text style={styles.small}>Nobody said they could play — add players below.</Text>}
      {others.length > 0 && (
        <>
          <Text style={[styles.groupLabel, { color: theme.textSecondary }]}>Add from squad</Text>
          {others.map(row)}
        </>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Pressable onPress={send} disabled={checked.size === 0 || sending} style={[styles.primary, (checked.size === 0 || sending) && { opacity: 0.4 }]}>
        {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Send payment request ({checked.size})</Text>}
      </Pressable>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.background },
    content: { padding: 20, paddingTop: 56, paddingBottom: 48, gap: 12 },
    back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
    backText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 15 },
    heading: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 24 },
    sub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, marginTop: -6 },
    muted: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
    small: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      padding: 14,
      ...cardShadow,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    cardTitle: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 15 },
    groupLabel: {
      color: theme.accentInk,
      fontFamily: fonts.bold,
      fontSize: 10,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 6,
    },
    personRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: theme.surface2,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 9,
    },
    personName: { flex: 1, color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 13 },
    pill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
    pillPaid: { backgroundColor: theme.successBg, borderColor: theme.successBorder },
    pillUnpaid: { backgroundColor: '#FDECEC', borderColor: '#F5C2C2' },
    pillText: { fontFamily: fonts.bold, fontSize: 10 },
    error: { color: theme.danger, fontFamily: fonts.regular, fontSize: 12 },
    primary: { backgroundColor: theme.accent, borderRadius: radius.btn, paddingVertical: 13, alignItems: 'center', marginTop: 6 },
    primaryText: { color: '#fff', fontFamily: fonts.bold, fontSize: 14 },
  });
