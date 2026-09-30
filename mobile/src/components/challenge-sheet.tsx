// Challenge a match post — the mobile port of components/ChallengePanel.tsx,
// for the captain or a co-captain.
//
// The accept itself is the same server call the web makes:
// /api/challenges/accept claims the post, reads the teams, fee and mode from
// the database, writes the challenge, match, booking and "are you playing?"
// rows, and takes each team's half of the pitch fee from its account — or
// rolls back and says why. This sheet picks the pitch option and reports.
//
// Where it differs from the web is the shortfall, as in
// enter-tournament-sheet.tsx: instead of a free-amount top-up, the captain is
// offered exactly the gap, named — "£3 towards your half of the pitch vs
// Ballers United" — and the challenge goes through automatically once it has
// landed. Same money path underneath (/api/create-credits-intent, credited by
// the Stripe webhook); no screen presents a balance to add money to. Once a
// shortfall has been paid, a refusal for want of funds means the payment
// hasn't landed yet — never a second offer to pay.

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStripe } from '@stripe/stripe-react-native';

import { supabase } from '@/lib/supabase';
import { authedPost } from '@/lib/authed-fetch';
import { waitForCredit } from '@/lib/credit-sync';
import { fmtFee } from '@/lib/joining-fee';
import { fmtKickoff } from '@/lib/match-dates';
import type { MatchPost } from '@/lib/game-feed';
import { fonts, radius } from '~/theme';
import { useTheme } from '~/use-theme';
import { paymentIntentIdFrom, useSaveCardChoice } from '~/payments';
import { TopUpSheet } from '~/components/top-up-sheet';
import { TEST_TOP_UP } from '~/store-review';

type Stage =
  | { kind: 'pick' }
  | { kind: 'short'; shortPence: number; halfPence: number }
  | { kind: 'waiting' } // paid, waiting for it to land before accepting
  | { kind: 'taken' }
  | { kind: 'done' };

// /api/create-credits-intent's minimum.
const MIN_PAYMENT_PENCE = 100;

type AcceptResult = {
  code?: string;
  error?: string;
  shortfallPence?: number;
  halfPence?: number;
  matchId?: string;
  pitchBookingId?: string | null;
  feePence?: number;
  pitchId?: string | null;
};

export function ChallengeSheet({
  post,
  teamId,
  userId,
  onClose,
  onMatched,
}: {
  post: MatchPost;
  teamId: string;
  userId: string;
  onClose: () => void;
  onMatched: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const saveCard = useSaveCardChoice(userId);

  const [stage, setStage] = useState<Stage>({ kind: 'pick' });
  const [selected, setSelected] = useState<string | null>(post.pitchOptions.length === 1 ? post.pitchOptions[0].id : null);
  const [avail, setAvail] = useState<Record<string, boolean> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paid = useRef(false);
  // Testing builds pay a shortfall the web's way — the Top Up sheet, pre-filled
  // with the gap — then retry by themselves (TEST_TOP_UP, src/store-review.ts).
  // Store builds keep the named payment below.
  const [topUpOpen, setTopUpOpen] = useState(false);
  const afterTopUp = async (didPay: boolean) => {
    setTopUpOpen(false);
    if (!didPay) return;
    paid.current = true;
    setBusy(true);
    setError(null);
    try {
      await tryAccept();
    } catch {
      setError("Couldn't reach Uniter. Try again.");
    } finally {
      setBusy(false);
    }
  };

  // Which pitch options are still free at this slot — the web's check. A
  // secured post already owns its booking, which is the pitch both teams play on.
  useEffect(() => {
    if (post.pitchSecured) {
      setAvail(Object.fromEntries(post.pitchOptions.map((p) => [p.id, true])));
      return;
    }
    void Promise.all(
      post.pitchOptions.map(async (p) => {
        const { data } = await supabase
          .from('pitch_bookings')
          .select('id')
          .eq('pitch_id', p.id)
          .eq('match_date', post.match_date)
          .eq('start_time', p.time ?? post.match_time)
          .neq('status', 'cancelled')
          .maybeSingle();
        return [p.id, !data] as const;
      }),
    ).then((rows) => setAvail(Object.fromEntries(rows)));
  }, [post]);

  const pitch = post.pitchOptions.find((p) => p.id === selected) ?? null;
  const feePence = pitch ? Math.round(pitch.price * 100) : 0;
  const halfPence = feePence - Math.ceil(feePence / 2); // the poster absorbs the odd penny

  // One attempt. Returns true when the match is confirmed.
  const tryAccept = async (): Promise<boolean> => {
    if (!selected) return false;
    const res = await authedPost('/api/challenges/accept', { postId: post.id, pitchOptionId: selected, teamId });
    const data: AcceptResult = await res.json().catch(() => ({}));
    if (data.matchId) {
      // The route pays the venue itself.
      setStage({ kind: 'done' });
      onMatched();
      return true;
    }
    if (data.code === 'TAKEN') {
      setStage({ kind: 'taken' });
      return false;
    }
    if (data.code === 'SLOT_TAKEN') {
      setAvail((prev) => ({ ...(prev ?? {}), [selected]: false }));
      setSelected(null);
      setStage({ kind: 'pick' });
    }
    if (data.code === 'SHORTFALL') {
      if (paid.current) {
        setStage({ kind: 'waiting' });
        setError('Your payment hasn’t arrived yet — try again in a minute.');
        return false;
      }
      setStage({ kind: 'short', shortPence: data.shortfallPence ?? halfPence, halfPence: data.halfPence ?? halfPence });
      return false;
    }
    setError(data.error ?? "Couldn't accept this match. Nothing was charged.");
    return false;
  };

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await tryAccept();
    } catch {
      setError("Couldn't reach Uniter. Nothing was charged — try again.");
    } finally {
      setBusy(false);
    }
  };

  const payShortfallAndAccept = async (shortPence: number) => {
    setBusy(true);
    setError(null);
    try {
      const amount = Math.max(shortPence, MIN_PAYMENT_PENCE);
      const { data: before } = await supabase.from('team_credits').select('balance_pence').eq('team_id', teamId).maybeSingle();
      const res = await authedPost('/api/create-credits-intent', { amountPence: amount, teamId });
      const data = await res.json();
      if (!data.clientSecret) {
        setError(data.error ?? 'Could not start the payment.');
        return;
      }
      const init = await initPaymentSheet({ merchantDisplayName: 'Uniter', paymentIntentClientSecret: data.clientSecret });
      if (init.error) {
        setError(init.error.message);
        return;
      }
      const present = await presentPaymentSheet();
      if (present.error) {
        if (present.error.code !== 'Canceled') setError(present.error.message);
        return;
      }
      paid.current = true;
      await saveCard.commit(paymentIntentIdFrom(data.clientSecret));
      // Charged. The webhook records it a moment later; accept once it has,
      // and never report a failure from here on — the money has moved.
      setStage({ kind: 'waiting' });
      const landed = await waitForCredit(teamId, before?.balance_pence ?? 0);
      if (landed === null) return; // still on its way — the button below retries
      await tryAccept();
    } catch {
      setError("Couldn't reach the payment service.");
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (!busy) onClose();
  };

  return (
    <>
    <Modal visible={!topUpOpen} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.scrim} onPress={close}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>
              {stage.kind === 'done' ? 'Match confirmed!' : stage.kind === 'taken' ? 'Already taken' : `Challenge ${post.team}`}
            </Text>
            <Pressable onPress={close} disabled={busy} hitSlop={10}>
              <Ionicons name="close" size={22} color={theme.textSecondary} />
            </Pressable>
          </View>
          <Text style={styles.sub}>
            {fmtKickoff(post.match_date, post.match_time)}
            {post.location ? ` · ${post.location}` : ''}
          </Text>

          {stage.kind === 'pick' && (
            <>
              <Text style={styles.label}>{post.pitchOptions.length > 1 ? 'Pick a pitch' : 'Pitch'}</Text>
              {avail === null ? (
                <ActivityIndicator color={theme.accent} />
              ) : (
                <ScrollView style={{ maxHeight: 260 }} contentContainerStyle={{ gap: 8 }}>
                  {post.pitchOptions.map((p) => {
                    const free = avail[p.id] !== false;
                    const on = selected === p.id;
                    return (
                      <Pressable
                        key={p.id}
                        disabled={!free}
                        onPress={() => setSelected(p.id)}
                        style={[styles.option, on && styles.optionOn, !free && { opacity: 0.4 }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.optionTitle}>{p.name}</Text>
                          <Text style={styles.optionSub}>
                            {p.time ?? post.match_time}
                            {free ? '' : ' · just booked by another team'}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.optionPrice}>{fmtFee(Math.round(p.price * 100))}</Text>
                          <Text style={styles.optionSub}>pitch</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
              {avail && post.pitchOptions.every((p) => avail[p.id] === false) && (
                <Text style={styles.error}>Every pitch option for this match has been booked. The posting team needs to update it first.</Text>
              )}
              {pitch && (
                <View style={styles.box}>
                  <Row label="Pitch fee" value={fmtFee(feePence)} styles={styles} />
                  <Row label="Your team's half" value={fmtFee(halfPence)} styles={styles} accent />
                  <Text style={styles.small}>
                    {post.pitchSecured
                      ? `${post.team} has already paid for the pitch — your half goes to them.`
                      : 'Each team pays its own half from its account. Your players pay their share after the game.'}
                  </Text>
                </View>
              )}
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Pressable onPress={accept} disabled={!pitch || busy} style={[styles.primary, (!pitch || busy) && { opacity: 0.5 }]}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{pitch ? `Accept for ${fmtFee(halfPence)}` : 'Pick a pitch'}</Text>}
              </Pressable>
            </>
          )}

          {stage.kind === 'short' && (
            <>
              <Text style={styles.body}>
                Your half of the pitch vs {post.team} is {fmtFee(stage.halfPence)}, and your squad&apos;s payments don&apos;t
                cover all of it yet. Pay the remaining {fmtFee(Math.max(stage.shortPence, MIN_PAYMENT_PENCE))} now and the
                match is confirmed straight after. Your squad can pay you back through their shares.
              </Text>
              {saveCard.offer && (
                <Pressable onPress={() => saveCard.setChecked(!saveCard.checked)} style={styles.saveRow}>
                  <Ionicons name={saveCard.checked ? 'checkbox' : 'square-outline'} size={20} color={saveCard.checked ? theme.accent : theme.textSecondary} />
                  <Text style={styles.saveText}>Save this card for future payments</Text>
                </Pressable>
              )}
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Pressable onPress={() => (TEST_TOP_UP ? setTopUpOpen(true) : payShortfallAndAccept(stage.shortPence))} disabled={busy} style={[styles.primary, busy && { opacity: 0.6 }]}>
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryText}>
                    {TEST_TOP_UP ? 'Top up team credit' : `Pay ${fmtFee(Math.max(stage.shortPence, MIN_PAYMENT_PENCE))} towards your half of the pitch`}
                  </Text>
                )}
              </Pressable>
            </>
          )}

          {stage.kind === 'waiting' && (
            <>
              <Text style={styles.body}>
                {busy
                  ? 'Payment taken — confirming the match…'
                  : 'Your payment went through, but it hasn’t shown up yet. Give it a minute, then try again — you won’t be charged twice.'}
              </Text>
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Pressable onPress={accept} disabled={busy} style={[styles.primary, busy && { opacity: 0.6 }]}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Try confirming again</Text>}
              </Pressable>
            </>
          )}

          {stage.kind === 'taken' && (
            <>
              <Text style={styles.body}>
                {paid.current
                  ? 'Another team took this match just before you. Your payment is safe in your team’s account and counts towards your next game.'
                  : 'Another team challenged this post just before you. Nothing was charged.'}
              </Text>
              <Pressable onPress={onClose} style={styles.primary}>
                <Text style={styles.primaryText}>Back to games</Text>
              </Pressable>
            </>
          )}

          {stage.kind === 'done' && (
            <>
              <Text style={styles.body}>
                You&apos;re playing {post.team} on {fmtKickoff(post.match_date, pitch?.time ?? post.match_time)}
                {pitch ? ` at ${pitch.name}` : ''}. Both squads have been asked whether they can play, and it&apos;s on
                the Calendar — open it there to set the lineup.
              </Text>
              <Pressable onPress={onClose} style={styles.primary}>
                <Text style={styles.primaryText}>Done</Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
    {TEST_TOP_UP && (
      <TopUpSheet
        visible={topUpOpen}
        teamId={teamId}
        userId={userId}
        suggestedPence={stage.kind === 'short' ? stage.shortPence : undefined}
        onClose={(didPay) => void afterTopUp(didPay)}
      />
    )}
    </>
  );
}

function Row({ label, value, accent, styles }: { label: string; value: string; accent?: boolean; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, accent && styles.accentText]}>{label}</Text>
      <Text style={[styles.rowValue, accent && styles.accentText]}>{value}</Text>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    scrim: { flex: 1, backgroundColor: theme.scrim, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 20,
      paddingBottom: 34,
      gap: 12,
      maxHeight: '90%',
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 18, flexShrink: 1 },
    sub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, marginTop: -6 },
    label: { color: theme.textSecondary, fontFamily: fonts.bold, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface2,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 11,
    },
    optionOn: { backgroundColor: theme.successBg, borderColor: theme.accent },
    optionTitle: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14 },
    optionSub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 11 },
    optionPrice: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
    box: { borderWidth: 1, borderColor: theme.border, borderRadius: radius.btn, padding: 14, gap: 6 },
    row: { flexDirection: 'row', justifyContent: 'space-between' },
    rowLabel: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
    rowValue: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 13 },
    accentText: { color: theme.accentInk },
    small: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 2 },
    body: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
    saveRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    saveText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 13 },
    error: { color: theme.danger, fontFamily: fonts.regular, fontSize: 12 },
    primary: { backgroundColor: theme.accent, borderRadius: radius.btn, paddingVertical: 14, alignItems: 'center' },
    primaryText: { color: '#fff', fontFamily: fonts.bold, fontSize: 15, textAlign: 'center' },
  });
