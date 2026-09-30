// Enter a tournament — the mobile port of components/EnterTournamentPanel.tsx,
// for the captain or a co-captain.
//
// The entry itself is the same server call the web makes: /api/tournaments/join
// checks the caller leads the team, re-applies any invitation discount, takes
// the buy-in from the team's account, enters the team and asks every squad
// member whether they can play. This sheet only confirms and reports.
//
// Where it differs from the web is the shortfall. The web offers a free-amount
// top-up of team credit; the phone offers to pay exactly the difference,
// named as what it is for — "£6 towards the £40 buy-in for Winter Cup" — and
// then enters automatically. It is the same money path underneath (a payment
// into the team's account via /api/create-credits-intent, credited by the
// Stripe webhook, then the buy-in taken from it), but no screen on the phone
// presents a balance to add money to, which is what an App Store reviewer
// reads as a digital wallet. See mobile/PORTED.md, Phase 3.

import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStripe } from '@stripe/stripe-react-native';

import { supabase } from '@/lib/supabase';
import { authedPost } from '@/lib/authed-fetch';
import { waitForCredit } from '@/lib/credit-sync';
import { fmtFee } from '@/lib/joining-fee';
import { fmtKickoff } from '@/lib/match-dates';
import type { Tournament } from '@/lib/game-feed';
import { fonts, radius } from '~/theme';
import { useTheme } from '~/use-theme';
import { paymentIntentIdFrom, useSaveCardChoice } from '~/payments';
import { TopUpSheet } from '~/components/top-up-sheet';
import { TEST_TOP_UP } from '~/store-review';

type Stage =
  | { kind: 'confirm' }
  | { kind: 'short'; availablePence: number; shortPence: number }
  | { kind: 'waiting' } // paid, waiting for the payment to land before entering
  | { kind: 'done' };

// /api/create-credits-intent's minimum.
const MIN_PAYMENT_PENCE = 100;

export function EnterTournamentSheet({
  tournament: t,
  teamId,
  teamName,
  userId,
  onClose,
  onEntered,
}: {
  tournament: Tournament;
  teamId: string;
  teamName: string | null;
  userId: string;
  onClose: () => void;
  onEntered: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const saveCard = useSaveCardChoice(userId);
  const [stage, setStage] = useState<Stage>({ kind: 'confirm' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once a shortfall payment has gone through. From then on a refusal for
  // want of funds means the payment hasn't landed yet — never an invitation
  // to pay again, which is how someone tapping twice would be charged twice.
  // A ref, not state: it's read in the same call that sets it.
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
      await tryEnter();
    } catch {
      setError("Couldn't reach Uniter. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const buyIn = Math.max(0, t.pricePerTeamPence - t.inviteDiscountPence);
  const organiser = t.organiserAdminName ?? t.organiserTeamName ?? t.pitchName;

  // One attempt at entering. Returns true when entered.
  const tryEnter = async (): Promise<boolean> => {
    const res = await authedPost('/api/tournaments/join', { openMatchId: t.id, teamId, teamName });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setStage({ kind: 'done' });
      onEntered();
      return true;
    }
    // A team that has never had money paid in has no account row yet — the
    // same position as having nothing available.
    if (data.error === 'INSUFFICIENT_CREDIT' || data.error === 'No credit account for this team.') {
      if (paid.current) {
        setStage({ kind: 'waiting' });
        setError('Your payment hasn’t arrived yet — try again in a minute.');
        return false;
      }
      const available = typeof data.available === 'number' ? Math.max(0, data.available) : 0;
      setStage({ kind: 'short', availablePence: available, shortPence: Math.max(0, buyIn - available) });
      return false;
    }
    setError(data.error ?? "Couldn't enter the tournament. Please try again.");
    return false;
  };

  const enter = async () => {
    setBusy(true);
    setError(null);
    try {
      await tryEnter();
    } catch {
      setError("Couldn't reach Uniter. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const payShortfallAndEnter = async (shortPence: number) => {
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

      // Charged. The Stripe webhook records it a moment later; enter once it
      // has, and never report a failure from here on — the money has moved.
      setStage({ kind: 'waiting' });
      const landed = await waitForCredit(teamId, before?.balance_pence ?? 0);
      if (landed === null) {
        // Still on its way. The entry can be retried with the button below.
        return;
      }
      await tryEnter();
    } catch {
      Alert.alert('Something went wrong', "Couldn't reach the payment service.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <Modal visible={!topUpOpen} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={busy ? undefined : onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>{stage.kind === 'done' ? "You're in!" : 'Enter tournament'}</Text>
            <Pressable onPress={onClose} disabled={busy} hitSlop={10}>
              <Ionicons name="close" size={22} color={theme.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.box}>
            <Text style={styles.event}>{t.title}</Text>
            <Text style={styles.sub}>
              {t.pitchName} · {fmtKickoff(t.matchDate, t.startTime)}
            </Text>
            <View style={styles.divider} />
            <Row label="Buy-in (per team)" value={fmtFee(buyIn)} styles={styles} strike={t.inviteDiscountPence > 0 ? fmtFee(t.pricePerTeamPence) : undefined} />
            {t.inviteDiscountPence > 0 && <Row label="Invitation discount" value={`−${fmtFee(t.inviteDiscountPence)}`} styles={styles} accent />}
            <Row label="Teams entered" value={`${t.joinedCount}/${t.maxTeams}`} styles={styles} />
          </View>

          {stage.kind === 'confirm' && (
            <>
              <Text style={styles.body}>
                The buy-in is paid to {organiser}. Your squad&apos;s joining fees and match payments cover it first; if
                they don&apos;t cover all of it, you&apos;ll be asked to pay the rest. Your players each pay their share
                afterwards.
              </Text>
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Pressable onPress={enter} disabled={busy} style={[styles.primary, busy && { opacity: 0.6 }]}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{buyIn > 0 ? `Enter for ${fmtFee(buyIn)}` : 'Enter'}</Text>}
              </Pressable>
            </>
          )}

          {stage.kind === 'short' && (
            <>
              <Text style={styles.body}>
                {stage.availablePence > 0
                  ? `Your squad's payments cover ${fmtFee(stage.availablePence)} of the ${fmtFee(buyIn)} buy-in.`
                  : `Nothing has been paid into ${teamName ?? 'your team'} yet to cover the ${fmtFee(buyIn)} buy-in.`}{' '}
                Pay the remaining {fmtFee(Math.max(stage.shortPence, MIN_PAYMENT_PENCE))} now and the team is entered
                straight after. Your squad can pay you back through their shares.
              </Text>
              {saveCard.offer && (
                <Pressable onPress={() => saveCard.setChecked(!saveCard.checked)} style={styles.saveRow}>
                  <Ionicons name={saveCard.checked ? 'checkbox' : 'square-outline'} size={20} color={saveCard.checked ? theme.accent : theme.textSecondary} />
                  <Text style={styles.saveText}>Save this card for future payments</Text>
                </Pressable>
              )}
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Pressable onPress={() => (TEST_TOP_UP ? setTopUpOpen(true) : payShortfallAndEnter(stage.shortPence))} disabled={busy} style={[styles.primary, busy && { opacity: 0.6 }]}>
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryText}>
                    {TEST_TOP_UP ? 'Top up team credit' : `Pay ${fmtFee(Math.max(stage.shortPence, MIN_PAYMENT_PENCE))} towards the buy-in`}
                  </Text>
                )}
              </Pressable>
            </>
          )}

          {stage.kind === 'waiting' && (
            <>
              <Text style={styles.body}>
                {busy
                  ? 'Payment taken — entering your team…'
                  : 'Your payment went through, but it hasn’t shown up yet. Give it a minute, then try entering again — you won’t be charged twice.'}
              </Text>
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Pressable onPress={enter} disabled={busy} style={[styles.primary, busy && { opacity: 0.6 }]}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Try entering again</Text>}
              </Pressable>
            </>
          )}

          {stage.kind === 'done' && (
            <>
              <Text style={styles.body}>
                {teamName ?? 'Your team'} has entered {t.title}. Everyone in the squad has been asked whether they can
                play, and each pays their share afterwards. Your games appear on the Calendar once the organiser draws
                up the schedule.
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

function Row({
  label,
  value,
  strike,
  accent,
  styles,
}: {
  label: string;
  value: string;
  strike?: string;
  accent?: boolean;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, accent && styles.accentText]}>{label}</Text>
      <Text style={[styles.rowValue, accent && styles.accentText]}>
        {strike && <Text style={styles.strike}>{strike} </Text>}
        {value}
      </Text>
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
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 18 },
    box: { borderWidth: 1, borderColor: theme.border, borderRadius: radius.btn, padding: 14, gap: 6 },
    event: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 15 },
    sub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
    divider: { height: 1, backgroundColor: theme.border, marginVertical: 4 },
    row: { flexDirection: 'row', justifyContent: 'space-between' },
    rowLabel: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
    rowValue: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 13 },
    accentText: { color: theme.accentInk },
    strike: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 11, textDecorationLine: 'line-through' },
    body: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
    saveRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    saveText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 13 },
    error: { color: theme.danger, fontFamily: fonts.regular, fontSize: 12 },
    primary: { backgroundColor: theme.accent, borderRadius: radius.btn, paddingVertical: 14, alignItems: 'center' },
    primaryText: { color: '#fff', fontFamily: fonts.bold, fontSize: 15 },
  });
