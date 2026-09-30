// "Need a ringer?" — the captain's half of ringers, the port of
// RingerRequestPanel in the web's app/my-team/match/[matchId]/page.tsx.
//
// Short of bodies for a friendly? Post the positions you need and the spots
// show up in every player's Fill In feed (already on the phone's Home). Guests
// pay Uniter a flat fee to join — nothing about the team's own money or pitch
// split changes, so posting a request moves no money at all. One request per
// match per team (upsert on match_id,team_id), exactly as the web writes it.

import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { supabase } from '@/lib/supabase';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';

const RINGER_POSITIONS = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST'];
const RINGER_FEE_PENCE = 500;

type RequestRow = { id: string; positions: string[]; spots: number; notes: string | null; status: string };
type Signup = { player_id: string; name: string; position: string | null };

export function RingerRequestPanel({ matchId, teamId, userId }: { matchId: string; teamId: string; userId: string }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [request, setRequest] = useState<RequestRow | null | undefined>(undefined);
  const [signups, setSignups] = useState<Signup[]>([]);
  const [positions, setPositions] = useState<string[]>([]);
  const [spots, setSpots] = useState(1);
  const [notes, setNotes] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data, error: reqErr } = await supabase
        .from('ringer_requests')
        .select('id, positions, spots, notes, status')
        .eq('match_id', matchId)
        .eq('team_id', teamId)
        .maybeSingle();
      if (reqErr) {
        setError("Ringer requests aren't set up yet — run supabase_ringers.sql.");
        setRequest(null);
        return;
      }
      setRequest((data as RequestRow | null) ?? null);
      if (!data) return;
      setPositions(data.positions ?? []);
      setSpots(data.spots ?? 1);
      setNotes(data.notes ?? '');
      const { data: su } = await supabase.from('ringer_signups').select('player_id, position').eq('request_id', data.id);
      const ids = (su ?? []).map((s) => s.player_id as string);
      const { data: profs } = ids.length
        ? await supabase.from('profiles').select('id, full_name').in('id', ids)
        : { data: [] as { id: string; full_name: string }[] };
      const nameById = new Map((profs ?? []).map((p) => [p.id as string, p.full_name as string]));
      setSignups(
        (su ?? []).map((s) => ({ player_id: s.player_id as string, name: nameById.get(s.player_id as string) ?? 'Player', position: s.position as string | null })),
      );
    })();
  }, [matchId, teamId]);

  const toggle = (p: string) => setPositions((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const save = async () => {
    setBusy(true);
    setError(null);
    const { data, error: saveErr } = await supabase
      .from('ringer_requests')
      .upsert(
        {
          match_id: matchId,
          team_id: teamId,
          posted_by: userId,
          positions,
          spots,
          notes: notes.trim() || null,
          price_pence: RINGER_FEE_PENCE,
          status: 'open',
        },
        { onConflict: 'match_id,team_id' },
      )
      .select('id, positions, spots, notes, status')
      .maybeSingle();
    if (saveErr || !data) setError(saveErr?.message ?? "Couldn't post the request.");
    else {
      setRequest(data as RequestRow);
      setExpanded(false);
    }
    setBusy(false);
  };

  const close = async () => {
    if (!request) return;
    setBusy(true);
    await supabase.from('ringer_requests').update({ status: 'cancelled' }).eq('id', request.id);
    setRequest({ ...request, status: 'cancelled' });
    setBusy(false);
  };

  const isLive = request?.status === 'open';
  const spotsLeft = request ? Math.max(0, request.spots - signups.length) : 0;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>Need a ringer?</Text>
        {isLive && (
          <View style={styles.pill}>
            <Text style={styles.pillText}>
              {spotsLeft} spot{spotsLeft === 1 ? '' : 's'} left
            </Text>
          </View>
        )}
      </View>
      <Text style={styles.muted}>
        Post the positions you&apos;re short and players can buy in for £{(RINGER_FEE_PENCE / 100).toFixed(2)}. Ringers join
        your squad but aren&apos;t part of your team&apos;s payment split.
      </Text>

      {signups.length > 0 && (
        <View style={styles.joined}>
          <Text style={styles.label}>Joined</Text>
          {signups.map((s) => (
            <View key={s.player_id} style={styles.joinedRow}>
              <Text style={styles.name} numberOfLines={1}>
                {s.name}
                {s.position ? ` · ${s.position}` : ''}
              </Text>
              <View style={styles.paid}>
                <Text style={styles.paidText}>Paid</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {request === undefined ? (
        <ActivityIndicator color={theme.accent} />
      ) : expanded || !request || request.status !== 'open' ? (
        <View style={{ gap: 10 }}>
          <Text style={styles.label}>Positions needed</Text>
          <View style={styles.chips}>
            {RINGER_POSITIONS.map((p) => {
              const on = positions.includes(p);
              return (
                <Pressable key={p} onPress={() => toggle(p)} style={[styles.chip, on && styles.chipOn]}>
                  <Text style={[styles.chipText, on && { color: '#fff' }]}>{p}</Text>
                </Pressable>
              );
            })}
          </View>
          {positions.length === 0 && <Text style={styles.small}>None selected — the post will say &quot;any position&quot;.</Text>}

          <View style={styles.spotsRow}>
            <Text style={[styles.muted, { flex: 1 }]}>Players needed</Text>
            <Pressable onPress={() => setSpots((s) => Math.max(1, s - 1))} style={styles.step}>
              <Text style={styles.stepText}>−</Text>
            </Pressable>
            <Text style={styles.spots}>{spots}</Text>
            <Pressable onPress={() => setSpots((s) => Math.min(11, s + 1))} style={styles.step}>
              <Text style={styles.stepText}>+</Text>
            </Pressable>
          </View>

          <TextInput
            value={notes}
            onChangeText={setNotes}
            multiline
            placeholder="Anything they should know? (e.g. bring dark shirt)"
            placeholderTextColor={theme.textSecondary}
            style={styles.input}
          />
          {!!error && <Text style={styles.error}>{error}</Text>}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {request?.status === 'open' && (
              <Pressable onPress={() => setExpanded(false)} disabled={busy} style={[styles.outline, { flex: 1 }]}>
                <Text style={styles.outlineText}>Cancel</Text>
              </Pressable>
            )}
            <Pressable
              onPress={save}
              disabled={busy || (!!error && request === null)}
              style={[styles.primary, { flex: 2 }, (busy || (!!error && request === null)) && { opacity: 0.5 }]}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{request ? 'Update Request' : 'Post Ringer Request'}</Text>}
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Text style={styles.muted}>
            Live · {request.positions.length === 0 ? 'Any position' : request.positions.join(', ')} · {request.spots} needed
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={() => setExpanded(true)} style={[styles.outline, { flex: 1 }]}>
              <Text style={styles.outlineText}>Edit</Text>
            </Pressable>
            <Pressable onPress={close} disabled={busy} style={[styles.outline, styles.danger, { flex: 1 }, busy && { opacity: 0.5 }]}>
              <Text style={[styles.outlineText, { color: theme.danger }]}>{busy ? '…' : 'Close Request'}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      padding: 14,
      gap: 10,
      ...cardShadow,
    },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14 },
    pill: { backgroundColor: theme.successBg, borderColor: theme.successBorder, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
    pillText: { color: theme.accentInk, fontFamily: fonts.semibold, fontSize: 10 },
    muted: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
    small: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 11 },
    label: { color: theme.textSecondary, fontFamily: fonts.bold, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 },
    joined: { backgroundColor: theme.background, borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 10, gap: 6 },
    joinedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    name: { flex: 1, color: theme.textPrimary, fontFamily: fonts.regular, fontSize: 14 },
    paid: { backgroundColor: '#EAF0FF', borderColor: '#C6D4FF', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
    paidText: { color: '#335FFF', fontFamily: fonts.semibold, fontSize: 10 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { borderWidth: 1, borderColor: theme.border, borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 5, backgroundColor: theme.background },
    chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    chipText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 12 },
    spotsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    step: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
    stepText: { color: theme.textSecondary, fontFamily: fonts.bold, fontSize: 16 },
    spots: { width: 24, textAlign: 'center', color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
    input: {
      minHeight: 60,
      textAlignVertical: 'top',
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 9,
      color: theme.textPrimary,
      fontFamily: fonts.regular,
      fontSize: 14,
      backgroundColor: theme.background,
    },
    error: { color: theme.danger, fontFamily: fonts.regular, fontSize: 12 },
    primary: { backgroundColor: theme.accent, borderRadius: radius.btn, paddingVertical: 12, alignItems: 'center' },
    primaryText: { color: '#fff', fontFamily: fonts.bold, fontSize: 14 },
    outline: { borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
    outlineText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 14 },
    danger: { borderColor: theme.danger + '55' },
  });
