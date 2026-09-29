// What you owe your team, and paying it — the mobile port of the payable half
// of components/DuesTopUpModal.tsx.
//
// Worded around what the money is FOR — the joining fee, your share of a named
// game — never "top up" or "credit". Underneath nothing changes: every payment
// here still lands in team_credits exactly as it does on the web. The wording
// is the App Store point: a stored balance you add money to reads to a reviewer
// as a digital wallet (Apple's 30% payment system), while paying for a real
// pitch is exempt. That is also why the web's free-amount "top up" picker is
// deliberately not ported — it is the wallet-shaped part.
//
// Data is shared: useMyDues and applyTopUp (lib/dues.ts), useJoiningFee
// (lib/joining-fee.ts), waitForCredit (lib/credit-sync.ts). Two ways to pay,
// the same two routes the web modal calls:
//
//   saved card  → /api/settle-match charges it off-session and credits the team
//                 before it answers. Asked to confirm first, because nothing
//                 else stands between a tap and a charge.
//   no card     → /api/create-credits-intent, then Stripe's PaymentSheet. The
//                 webhook credits the team a moment later, so the sheet waits
//                 for the balance to move rather than assuming it has.

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStripe } from '@stripe/stripe-react-native';

import { supabase } from '@/lib/supabase';
import { authedPost } from '@/lib/authed-fetch';
import { applyTopUp, useMyDues, type MyDue, type SavedCard } from '@/lib/dues';
import { fmtFee, useJoiningFee } from '@/lib/joining-fee';
import { waitForCredit } from '@/lib/credit-sync';
import { toDateKey } from '@/lib/match-dates';
import { fonts, radius } from '~/theme';
import { useTheme } from '~/use-theme';
import { paymentIntentIdFrom, useSaveCardChoice } from '~/payments';

// What a single Pay button is paying for.
type Target = { kind: 'fee' } | { kind: 'due'; due: MyDue };

function fmtDay(raw: string): string {
  const key = toDateKey(raw);
  if (!key) return raw;
  return new Date(`${key}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function dueTitle(due: MyDue): string {
  return due.kind === 'tournament' ? due.opponent : `vs ${due.opponent}`;
}

export function PaySheet({
  visible,
  teamId,
  userId,
  onClose,
}: {
  visible: boolean;
  teamId: string;
  userId: string;
  /** Called after the sheet closes, so the caller can re-read what's owed. */
  onClose: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const { dues, reload: reloadDues } = useMyDues(teamId, userId);
  const { owedPence: feeOwed, duePence: feeDue, reload: reloadFee } = useJoiningFee(teamId, userId);
  const [savedCard, setSavedCard] = useState<SavedCard | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const saveCard = useSaveCardChoice(userId);

  useEffect(() => {
    if (!visible) return;
    setNotice(null);
    void reloadDues();
    void reloadFee();
    void supabase
      .from('profiles')
      .select('stripe_customer_id, stripe_payment_method_id, card_last4')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        setSavedCard(
          data?.stripe_customer_id && data?.stripe_payment_method_id
            ? {
                customerId: data.stripe_customer_id,
                paymentMethodId: data.stripe_payment_method_id,
                last4: data.card_last4 ?? null,
              }
            : null,
        );
      });
  }, [visible, userId, reloadDues, reloadFee]);

  const amountOf = (t: Target) => (t.kind === 'fee' ? feeOwed : t.due.remainingPence);
  const keyOf = (t: Target) => (t.kind === 'fee' ? 'fee' : t.due.pcsId);
  const labelOf = (t: Target) =>
    t.kind === 'fee' ? 'your joining fee' : `your share for ${dueTitle(t.due)}`;

  const refresh = async () => {
    await Promise.all([reloadDues(), reloadFee()]);
  };

  // Saved card: the same /api/settle-match item shapes DuesTopUpModal sends.
  const payWithSavedCard = async (t: Target) => {
    const amountPence = amountOf(t);
    const item =
      t.kind === 'fee'
        ? { amountPence, sharePence: amountPence, feePence: 0, purpose: 'joining_fee', teamId }
        : {
            // pcsId lets the route read the amount off the due row and check
            // it's the caller's, rather than trusting either from here.
            pcsId: t.due.pcsId,
            amountPence,
            sharePence: amountPence,
            feePence: 0,
            purpose: t.due.kind === 'tournament' ? 'tournament_fees' : 'match_fees',
            teamId,
            matchId: t.due.kind === 'match' ? t.due.matchId : undefined,
            openMatchId: t.due.kind === 'tournament' ? t.due.matchId : undefined,
          };
    const res = await authedPost('/api/settle-match', { items: [item] });
    const data = await res.json();
    const r = data.results?.[0];
    if (!r?.ok) {
      Alert.alert('Payment failed', r?.error ?? data.error ?? 'Your card was declined.');
      return;
    }
    // A joining-fee deposit is applied to the fee server-side; only a match
    // share has a due row to tick off here — same split as the web modal.
    if (t.kind === 'due') await applyTopUp(userId, amountPence, t.due.pcsId);
    await refresh();
    setNotice(`Paid ${fmtFee(amountPence)} — thanks.`);
  };

  // No saved card: open an intent for exactly this amount and confirm it in
  // Stripe's PaymentSheet (3D Secure included).
  const payWithNewCard = async (t: Target) => {
    const amountPence = amountOf(t);
    const { data: before } = await supabase
      .from('team_credits')
      .select('balance_pence')
      .eq('team_id', teamId)
      .maybeSingle();

    const res = await authedPost('/api/create-credits-intent', { amountPence, teamId });
    const data = await res.json();
    if (!data.clientSecret) {
      Alert.alert('Could not start payment', data.error ?? 'Try again in a moment.');
      return;
    }
    const init = await initPaymentSheet({
      merchantDisplayName: 'Uniter',
      paymentIntentClientSecret: data.clientSecret,
    });
    if (init.error) {
      Alert.alert('Could not start payment', init.error.message);
      return;
    }
    const present = await presentPaymentSheet();
    if (present.error) {
      if (present.error.code !== 'Canceled') Alert.alert('Payment failed', present.error.message);
      return;
    }

    // Charged. From here nothing may read as a failure — the money has moved.
    if (t.kind === 'due') await applyTopUp(userId, amountPence, t.due.pcsId);
    await saveCard.commit(paymentIntentIdFrom(data.clientSecret));
    const landed = await waitForCredit(teamId, before?.balance_pence ?? 0);
    await refresh();
    setNotice(
      landed !== null
        ? `Paid ${fmtFee(amountPence)} — thanks.`
        : `Paid ${fmtFee(amountPence)}. It can take a minute to show against what you owe.`,
    );
  };

  const pay = (t: Target) => {
    const run = async () => {
      setBusyKey(keyOf(t));
      setNotice(null);
      try {
        await (savedCard ? payWithSavedCard(t) : payWithNewCard(t));
      } catch {
        Alert.alert('Something went wrong', "Couldn't reach the payment service. Please try again.");
      } finally {
        setBusyKey(null);
      }
    };
    if (savedCard) {
      Alert.alert(
        `Pay ${fmtFee(amountOf(t))}?`,
        `For ${labelOf(t)}, charged to your card ending ${savedCard.last4 ?? '••••'}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Pay', onPress: () => void run() },
        ],
      );
    } else {
      void run();
    }
  };

  const nothingOwed = feeOwed <= 0 && dues.length === 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={busyKey ? undefined : onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>What you owe</Text>
            <Pressable onPress={onClose} disabled={!!busyKey} hitSlop={10}>
              <Ionicons name="close" size={22} color={theme.textSecondary} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ gap: 10 }}>
            {notice && (
              <View style={styles.notice}>
                <Ionicons name="checkmark-circle" size={16} color={theme.accentInk} />
                <Text style={styles.noticeText}>{notice}</Text>
              </View>
            )}

            {nothingOwed ? (
              <Text style={styles.muted}>You&apos;re all paid up.</Text>
            ) : (
              <>
                {feeOwed > 0 && (
                  <Row
                    title="Joining fee"
                    sub={
                      feeDue !== feeOwed
                        ? `${fmtFee(feeOwed)} of ${fmtFee(feeDue)} left to pay`
                        : 'Paid once, when you join the squad'
                    }
                    amount={feeOwed}
                    busy={busyKey === 'fee'}
                    disabled={!!busyKey}
                    onPay={() => pay({ kind: 'fee' })}
                    styles={styles}
                  />
                )}
                {/* Only for a first card — with one saved, payments go
                    through it and there is nothing to save. */}
                {!savedCard && saveCard.offer && (
                  <View style={styles.saveRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>Save this card</Text>
                      <Text style={styles.rowSub}>
                        Pay in one tap next time, and let Uniter charge your share of match fees
                        automatically. Remove it any time from your profile.
                      </Text>
                    </View>
                    <Switch
                      value={saveCard.checked}
                      onValueChange={saveCard.setChecked}
                      trackColor={{ true: theme.accent, false: theme.border }}
                    />
                  </View>
                )}
                {dues.map((due) => (
                  <Row
                    key={due.pcsId}
                    title={dueTitle(due)}
                    sub={`Your share of the pitch${due.date ? ` · ${fmtDay(due.date)}` : ''}`}
                    amount={due.remainingPence}
                    busy={busyKey === due.pcsId}
                    disabled={!!busyKey}
                    onPay={() => pay({ kind: 'due', due })}
                    styles={styles}
                  />
                ))}
                <Text style={styles.footnote}>
                  {savedCard
                    ? `Charged to your saved card ending ${savedCard.last4 ?? '••••'} — you'll be asked to confirm.`
                    : 'You can pay by card or with your phone.'}
                  {feeOwed > 0 || dues.length > 0
                    ? ' Until these are paid you can still say you can’t play, but not that you’re available.'
                    : ''}
                </Text>
              </>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Row({
  title,
  sub,
  amount,
  busy,
  disabled,
  onPay,
  styles,
}: {
  title: string;
  sub: string;
  amount: number;
  busy: boolean;
  disabled: boolean;
  onPay: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      <Pressable
        onPress={disabled ? undefined : onPay}
        disabled={disabled}
        style={({ pressed }) => [styles.payBtn, (pressed || (disabled && !busy)) && { opacity: 0.6 }]}>
        {busy ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.payBtnText}>Pay {fmtFee(amount)}</Text>
        )}
      </Pressable>
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
      paddingHorizontal: 20,
      paddingTop: 10,
      paddingBottom: 34,
      maxHeight: '85%',
    },
    handle: {
      alignSelf: 'center',
      width: 44,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.border,
      marginBottom: 14,
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    title: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 18 },
    notice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: theme.successBg,
      borderColor: theme.successBorder,
      borderWidth: 1,
      borderRadius: radius.btn,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    noticeText: { color: theme.accentInk, fontFamily: fonts.semibold, fontSize: 12, flex: 1 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.btn,
      paddingHorizontal: 12,
      paddingVertical: 11,
    },
    rowTitle: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14 },
    rowSub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 11, marginTop: 1 },
    payBtn: {
      backgroundColor: theme.accent,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 9,
      minWidth: 84,
      alignItems: 'center',
    },
    payBtnText: { color: '#fff', fontFamily: fonts.bold, fontSize: 13 },
    saveRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: theme.surface2,
      borderRadius: radius.btn,
      paddingHorizontal: 12,
      paddingVertical: 11,
    },
    muted: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, paddingVertical: 8 },
    footnote: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 4 },
  });
