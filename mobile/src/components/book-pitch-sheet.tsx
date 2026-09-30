// Confirm & pay for one hour of a pitch — the mobile port of
// BookingPaymentModal in components/BookPitchPanel.tsx.
//
// Everything that decides anything happens in /api/book/pitch, the same route
// the web uses: it reads the price from `pitches`, checks the hour is still
// free, takes the money and writes the booking (and, from Post a Match's
// "Lock in a pitch first", the secured match post). This sheet only says how
// to pay:
//
//   • from the team's account — captains and co-captains;
//   • the saved card — charged off-session by the route; if the bank wants the
//     payer present it falls back to PaymentSheet;
//   • a card — the route mints a PaymentIntent tied to this pitch and hour,
//     PaymentSheet confirms it, and the route verifies it before booking.
//
// Once a card payment has gone through, a failure to book never offers a
// second payment — the finalise step is idempotent on the intent, so "Finish
// booking" just asks again. A slot lost while the card sheet was open is
// refunded by the route.
//
// A short team account is paid the web's way only in testing builds
// (TEST_TOP_UP, src/store-review.ts); store builds point at the card instead.

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStripe } from '@stripe/stripe-react-native';

import { supabase } from '@/lib/supabase';
import { authedPost } from '@/lib/authed-fetch';
import { waitForCredit } from '@/lib/credit-sync';
import { fmtFee } from '@/lib/joining-fee';
import { feeOn, UNITER_FEE_ENABLED, UNITER_FEE_LABEL } from '@/lib/uniter-fee';
import { bookingEndTime } from '@/lib/pitch-day';
import { STRIPE_TEST_MODE } from '@/lib/stripe-mode';
import { fonts, radius } from '~/theme';
import { useTheme } from '~/use-theme';
import { paymentIntentIdFrom, useSaveCardChoice } from '~/payments';
import { TopUpSheet } from '~/components/top-up-sheet';
import { TEST_TOP_UP } from '~/store-review';

export type BookablePitch = { id: string; name: string; address: string | null; price_per_hour: number };
export type BookingTeam = { id: string; name: string };

type SavedCard = { brand: string | null; last4: string | null };
type Result = { posted: boolean };
type RouteReply = {
  ok?: boolean;
  code?: string;
  error?: string;
  posted?: boolean;
  newBalancePence?: number | null;
  clientSecret?: string;
};

const fmtDay = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

export function BookPitchSheet({
  pitch,
  date,
  time,
  team,
  userId,
  autoPost,
  onClose,
  onSlotTaken,
  onBooked,
}: {
  pitch: BookablePitch;
  date: string;
  time: string;
  /** The team the viewer runs, if any — unlocks paying from its account. */
  team: BookingTeam | null;
  userId: string;
  /** "Lock in a pitch first": the booking becomes a secured match post. */
  autoPost: boolean;
  onClose: () => void;
  onSlotTaken: () => void;
  onBooked: (result: Result) => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const saveCard = useSaveCardChoice(userId);

  const pitchFeePence = Math.round(pitch.price_per_hour * 100);
  const uniterFeePence = feeOn(pitchFeePence);
  const totalPence = pitchFeePence + uniterFeePence;

  const [availablePence, setAvailablePence] = useState<number | null>(null);
  const [savedCard, setSavedCard] = useState<SavedCard | null>(null);
  const [method, setMethod] = useState<'account' | 'card'>(team ? 'account' : 'card');
  const [skipSavedCard, setSkipSavedCard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  const [topUpOpen, setTopUpOpen] = useState(false);
  // A card payment that has gone through but not yet been booked.
  const paidIntent = useRef<string | null>(null);
  const [needsFinish, setNeedsFinish] = useState(false);

  const loadBalance = async () => {
    if (!team) return;
    const { data } = await supabase.from('team_credits').select('balance_pence, reserved_pence').eq('team_id', team.id).maybeSingle();
    setAvailablePence(data ? data.balance_pence - (data.reserved_pence ?? 0) : 0);
  };

  useEffect(() => {
    void loadBalance();
    // Never in Stripe test mode: the saved card is a live one a test key can't
    // charge (lib/stripe-mode.ts).
    if (STRIPE_TEST_MODE) return;
    void supabase
      .from('profiles')
      .select('stripe_customer_id, stripe_payment_method_id, card_brand, card_last4')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.stripe_customer_id && data?.stripe_payment_method_id) {
          setSavedCard({ brand: (data.card_brand as string | null) ?? null, last4: (data.card_last4 as string | null) ?? null });
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id, userId]);

  // Default to the card when the account can't cover it — once, on load.
  const defaulted = useRef(false);
  useEffect(() => {
    if (defaulted.current || availablePence === null) return;
    defaulted.current = true;
    if (availablePence < totalPence) setMethod('card');
  }, [availablePence, totalPence]);

  const book = async (body: Record<string, unknown>): Promise<RouteReply> => {
    const res = await authedPost('/api/book/pitch', {
      pitchId: pitch.id,
      date,
      time,
      teamId: team?.id ?? null,
      autoPost: autoPost && !!team,
      ...body,
    });
    return res.json().catch(() => ({}));
  };

  // Common handling of a booking reply. Returns true when it's booked.
  const settle = (d: RouteReply): boolean => {
    if (d.ok) {
      paidIntent.current = null;
      setNeedsFinish(false);
      if (typeof d.newBalancePence === 'number') setAvailablePence(d.newBalancePence);
      setDone({ posted: !!d.posted });
      return true;
    }
    if (d.code === 'SLOT_TAKEN') {
      onSlotTaken();
      setError(d.error ?? 'That hour has just been booked.');
      return false;
    }
    if (d.code === 'SHORTFALL') {
      void loadBalance();
      setError("The team's account doesn't cover this booking.");
      return false;
    }
    setError(d.error ?? "Couldn't complete the booking.");
    return false;
  };

  const payFromAccount = async () => {
    setBusy(true);
    setError(null);
    try {
      settle(await book({ method: 'credit' }));
    } catch {
      setError("Couldn't reach Uniter. Nothing was charged.");
    } finally {
      setBusy(false);
    }
  };

  const finishCardBooking = async () => {
    const intentId = paidIntent.current;
    if (!intentId) return;
    setBusy(true);
    setError(null);
    try {
      const ok = settle(await book({ method: 'card', paymentIntentId: intentId }));
      if (ok) await saveCard.commit(intentId);
    } catch {
      setNeedsFinish(true);
      setError("Your payment went through, but Uniter couldn't be reached to finish the booking. Try again — you won't be charged twice.");
    } finally {
      setBusy(false);
    }
  };

  const payByCardSheet = async () => {
    const d = await book({ method: 'intent' });
    if (!d.clientSecret) {
      settle(d);
      return;
    }
    const init = await initPaymentSheet({ merchantDisplayName: 'Uniter', paymentIntentClientSecret: d.clientSecret });
    if (init.error) {
      setError(init.error.message);
      return;
    }
    const present = await presentPaymentSheet();
    if (present.error) {
      if (present.error.code !== 'Canceled') setError(present.error.message);
      return;
    }
    paidIntent.current = paymentIntentIdFrom(d.clientSecret);
    setNeedsFinish(true);
    await finishCardBooking();
  };

  const payByCard = async () => {
    setBusy(true);
    setError(null);
    try {
      if (savedCard && !skipSavedCard) {
        const d = await book({ method: 'saved_card' });
        if (d.code === 'REQUIRES_ACTION') {
          // The bank wants the payer — take it through PaymentSheet instead.
          setSkipSavedCard(true);
          await payByCardSheet();
          return;
        }
        settle(d);
        return;
      }
      await payByCardSheet();
    } catch {
      setError("Couldn't reach the payment service.");
    } finally {
      setBusy(false);
    }
  };

  const afterTopUp = async (didPay: boolean) => {
    setTopUpOpen(false);
    if (!didPay || !team) return;
    setBusy(true);
    const { data: before } = await supabase.from('team_credits').select('balance_pence').eq('team_id', team.id).maybeSingle();
    await waitForCredit(team.id, before?.balance_pence ?? 0);
    await loadBalance();
    setBusy(false);
  };

  const close = () => {
    if (busy) return;
    if (done) onBooked(done);
    else onClose();
  };

  const accountShort = availablePence !== null && availablePence < totalPence;
  const shortPence = Math.max(0, totalPence - (availablePence ?? 0));

  return (
    <>
      <Modal visible={!topUpOpen} transparent animationType="slide" onRequestClose={close}>
        <Pressable style={styles.scrim} onPress={close}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.header}>
              <Text style={styles.title}>{done ? (done.posted ? 'Pitch booked & posted!' : 'Pitch booked!') : 'Confirm & pay'}</Text>
              <Pressable onPress={close} disabled={busy} hitSlop={10}>
                <Ionicons name="close" size={22} color={theme.textSecondary} />
              </Pressable>
            </View>
            <View>
              <Text style={styles.pitchName}>{pitch.name}</Text>
              {!!pitch.address && <Text style={styles.sub}>{pitch.address}</Text>}
            </View>

            <View style={styles.box}>
              <Row label="When" value={`${fmtDay(date)} · ${time}–${bookingEndTime(time)}`} styles={styles} />
              <Row label="Pitch hire (1hr)" value={fmtFee(pitchFeePence)} styles={styles} />
              {UNITER_FEE_ENABLED && <Row label={`Uniter fee (${UNITER_FEE_LABEL})`} value={fmtFee(uniterFeePence)} styles={styles} />}
              <View style={styles.divider} />
              <Row label="Total" value={fmtFee(totalPence)} styles={styles} accent />
            </View>

            {done ? (
              <>
                <Text style={styles.body}>
                  {done.posted
                    ? 'Your pitch is secured and the match is live in the feed — any team can take it straight away. It’s on your Calendar.'
                    : 'The slot is reserved for you and the venue can see it. It’s on your Calendar under Pitch bookings.'}
                </Text>
                <Pressable onPress={() => onBooked(done)} style={styles.primary}>
                  <Text style={styles.primaryText}>Done</Text>
                </Pressable>
              </>
            ) : needsFinish ? (
              <>
                {!!error && <Text style={styles.error}>{error}</Text>}
                <Pressable onPress={finishCardBooking} disabled={busy} style={[styles.primary, busy && { opacity: 0.6 }]}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Finish booking</Text>}
                </Pressable>
              </>
            ) : (
              <>
                {team ? (
                  <View style={{ gap: 8 }}>
                    <Text style={styles.label}>Pay with</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Pressable onPress={() => setMethod('account')} style={[styles.method, method === 'account' && styles.methodOn]}>
                        <Text style={styles.methodTitle}>Team account</Text>
                        <Text style={styles.methodSub}>{availablePence === null ? '—' : `${fmtFee(Math.max(0, availablePence))} available`}</Text>
                        {accountShort && <Text style={[styles.methodSub, { color: theme.danger }]}>{fmtFee(shortPence)} short</Text>}
                      </Pressable>
                      <Pressable onPress={() => setMethod('card')} style={[styles.method, method === 'card' && styles.methodOn]}>
                        <Text style={styles.methodTitle}>Card</Text>
                        <Text style={styles.methodSub}>Pay by debit/credit card</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View style={styles.box}>
                    <Text style={styles.methodTitle}>Paying by card</Text>
                    <Text style={styles.methodSub}>Paying from a team&apos;s account is for its captain.</Text>
                  </View>
                )}

                {autoPost && team && (
                  <Text style={styles.small}>Once it&apos;s booked, this becomes a match post any team can take straight away.</Text>
                )}

                {!!error && <Text style={styles.error}>{error}</Text>}

                {method === 'account' && accountShort ? (
                  <View style={{ gap: 8 }}>
                    <View style={styles.warn}>
                      <Text style={styles.warnText}>
                        This booking is {fmtFee(totalPence)} and the team&apos;s account has {fmtFee(Math.max(0, availablePence ?? 0))}.
                      </Text>
                    </View>
                    <Pressable onPress={() => setMethod('card')} style={TEST_TOP_UP ? styles.secondary : styles.primary}>
                      <Text style={TEST_TOP_UP ? styles.secondaryText : styles.primaryText}>Pay by card instead</Text>
                    </Pressable>
                    {TEST_TOP_UP && (
                      <Pressable onPress={() => setTopUpOpen(true)} disabled={busy} style={[styles.primary, busy && { opacity: 0.6 }]}>
                        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Top up {fmtFee(shortPence)}</Text>}
                      </Pressable>
                    )}
                  </View>
                ) : method === 'account' ? (
                  <Pressable onPress={payFromAccount} disabled={busy || availablePence === null} style={[styles.primary, busy && { opacity: 0.6 }]}>
                    {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Pay {fmtFee(totalPence)} from the team&apos;s account</Text>}
                  </Pressable>
                ) : (
                  <View style={{ gap: 8 }}>
                    {savedCard && !skipSavedCard ? (
                      <View style={styles.cardRow}>
                        <Ionicons name="card-outline" size={18} color={theme.accentInk} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.methodTitle}>
                            {savedCard.brand ? savedCard.brand[0].toUpperCase() + savedCard.brand.slice(1) : 'Card'} •••• {savedCard.last4 ?? '????'}
                          </Text>
                          <Text style={styles.methodSub}>Saved card</Text>
                        </View>
                        <Pressable onPress={() => setSkipSavedCard(true)} disabled={busy} hitSlop={8}>
                          <Text style={styles.link}>Change</Text>
                        </Pressable>
                      </View>
                    ) : (
                      saveCard.offer && (
                        <Pressable onPress={() => saveCard.setChecked(!saveCard.checked)} style={styles.saveRow}>
                          <Ionicons name={saveCard.checked ? 'checkbox' : 'square-outline'} size={20} color={saveCard.checked ? theme.accent : theme.textSecondary} />
                          <Text style={styles.saveText}>Save this card for future payments</Text>
                        </Pressable>
                      )
                    )}
                    <Pressable onPress={payByCard} disabled={busy} style={[styles.primary, busy && { opacity: 0.6 }]}>
                      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Pay {fmtFee(totalPence)}</Text>}
                    </Pressable>
                  </View>
                )}
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
      {TEST_TOP_UP && team && (
        <TopUpSheet
          visible={topUpOpen}
          teamId={team.id}
          userId={userId}
          availablePence={availablePence ?? undefined}
          suggestedPence={shortPence}
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
    pitchName: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14 },
    sub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
    label: { color: theme.textSecondary, fontFamily: fonts.bold, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 },
    box: { borderWidth: 1, borderColor: theme.border, borderRadius: radius.btn, padding: 14, gap: 6 },
    divider: { height: 1, backgroundColor: theme.border, marginVertical: 2 },
    row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    rowLabel: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
    rowValue: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 13, flexShrink: 1, textAlign: 'right' },
    accentText: { color: theme.accentInk },
    method: { flex: 1, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface2, borderRadius: 12, padding: 12, gap: 2 },
    methodOn: { borderColor: theme.accent, backgroundColor: theme.successBg },
    methodTitle: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14 },
    methodSub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 11 },
    cardRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: radius.btn,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    link: { color: theme.accentInk, fontFamily: fonts.semibold, fontSize: 13 },
    small: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
    body: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
    warn: { backgroundColor: '#FFF6E3', borderColor: '#F5DCA6', borderWidth: 1, borderRadius: 12, padding: 10 },
    warnText: { color: '#B07400', fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
    saveRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    saveText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 13 },
    error: { color: theme.danger, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
    primary: { backgroundColor: theme.accent, borderRadius: radius.btn, paddingVertical: 14, alignItems: 'center' },
    primaryText: { color: '#fff', fontFamily: fonts.bold, fontSize: 15, textAlign: 'center' },
    secondary: { borderWidth: 1, borderColor: theme.border, borderRadius: radius.btn, paddingVertical: 13, alignItems: 'center' },
    secondaryText: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14 },
  });
