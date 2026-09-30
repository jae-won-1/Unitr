// "+ Top Up" — the port of the web's components/TopUpModal.tsx: pick an amount
// (or type one), pay by card, and it lands in the team's credit.
//
// TESTING ONLY. Shown only while TEST_TOP_UP (src/store-review.ts) is on, which
// is never in a store build — see that file for why a free-amount top-up is
// kept away from App Store and Play Store review.
//
// Same route as every other phone payment: /api/create-credits-intent, then
// Stripe's PaymentSheet. The webhook credits the team off the intent, so the
// balance moves a moment after the charge — waitForCredit polls for it and a
// slow webhook is reported as "on its way", never as a failure.

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStripe } from '@stripe/stripe-react-native';

import { supabase } from '@/lib/supabase';
import { authedPost } from '@/lib/authed-fetch';
import { waitForCredit } from '@/lib/credit-sync';
import { fmtFee } from '@/lib/joining-fee';
import { paymentIntentIdFrom, useSaveCardChoice } from '~/payments';
import { fonts, radius } from '~/theme';
import { useTheme } from '~/use-theme';

const PRESETS_POUNDS = [10, 20, 50, 100];

export function TopUpSheet({
  visible,
  teamId,
  userId,
  availablePence,
  onClose,
}: {
  visible: boolean;
  teamId: string;
  userId: string;
  availablePence: number;
  /** `paid` — something was charged, so the caller should re-read the balance. */
  onClose: (paid: boolean) => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const saveCard = useSaveCardChoice(userId);

  const [preset, setPreset] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setPreset(null);
    setCustom('');
    setError(null);
    setDone(null);
  }, [visible]);

  const pounds = custom ? Number(custom.replace(',', '.')) : preset;
  const amountPence = pounds && Number.isFinite(pounds) ? Math.round(pounds * 100) : 0;
  const valid = amountPence >= 100; // the route's minimum

  const pay = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data: before } = await supabase.from('team_credits').select('balance_pence').eq('team_id', teamId).maybeSingle();
      const res = await authedPost('/api/create-credits-intent', { amountPence, teamId });
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
      // Charged. From here nothing may read as a failure — the money has moved.
      await saveCard.commit(paymentIntentIdFrom(data.clientSecret));
      const landed = await waitForCredit(teamId, before?.balance_pence ?? 0);
      setDone(
        landed !== null
          ? `${fmtFee(amountPence)} added to your team balance.`
          : `${fmtFee(amountPence)} taken. Your balance updates in a moment — you can close this.`,
      );
    } catch {
      setError("Couldn't reach the payment service.");
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (!busy) onClose(done !== null);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.scrim} onPress={close}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          {done ? (
            <View style={{ alignItems: 'center', gap: 10 }}>
              <View style={styles.tick}>
                <Ionicons name="checkmark" size={28} color={theme.accentInk} />
              </View>
              <Text style={styles.title}>Top up complete</Text>
              <Text style={[styles.sub, { textAlign: 'center' }]}>{done}</Text>
              <Pressable onPress={close} style={[styles.primary, { alignSelf: 'stretch' }]}>
                <Text style={styles.primaryText}>Continue</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.header}>
                <Text style={styles.title}>Top up team credit</Text>
                <Pressable onPress={close} hitSlop={10}>
                  <Ionicons name="close" size={22} color={theme.textSecondary} />
                </Pressable>
              </View>
              <Text style={styles.sub}>Add funds to your team&apos;s balance.</Text>
              <View style={styles.testNote}>
                <Text style={styles.testNoteText}>Testing only — hidden in App Store and Play Store builds.</Text>
              </View>

              <View style={styles.presets}>
                {PRESETS_POUNDS.map((p) => {
                  const on = preset === p && !custom;
                  return (
                    <Pressable
                      key={p}
                      onPress={() => {
                        setPreset(p);
                        setCustom('');
                      }}
                      style={[styles.preset, on && styles.presetOn]}>
                      <Text style={[styles.presetText, on && { color: '#fff' }]}>£{p}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                value={custom}
                onChangeText={(v) => {
                  setCustom(v.replace(/[^0-9.,]/g, ''));
                  setPreset(null);
                }}
                keyboardType="decimal-pad"
                placeholder="Custom amount (£)"
                placeholderTextColor={theme.textSecondary}
                style={styles.input}
              />

              {valid && (
                <View style={styles.summary}>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Adding</Text>
                    <Text style={styles.summaryValue}>{fmtFee(amountPence)}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>New balance</Text>
                    <Text style={[styles.summaryValue, { color: theme.accentInk }]}>{fmtFee(Math.max(0, availablePence) + amountPence)}</Text>
                  </View>
                </View>
              )}

              {saveCard.offer && (
                <View style={styles.saveRow}>
                  <Text style={styles.saveText}>Save this card for future payments</Text>
                  <Switch value={saveCard.checked} onValueChange={saveCard.setChecked} />
                </View>
              )}

              {!!error && <Text style={styles.error}>{error}</Text>}
              <Pressable onPress={pay} disabled={!valid || busy} style={[styles.primary, (!valid || busy) && { opacity: 0.5 }]}>
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryText}>{valid ? `Pay ${fmtFee(amountPence)}` : 'Enter an amount'}</Text>
                )}
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
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
      gap: 12,
    },
    handle: { alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: theme.border },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 18 },
    sub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
    testNote: { backgroundColor: '#FFF7ED', borderColor: '#FED7AA', borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
    testNoteText: { color: '#B45309', fontFamily: fonts.semibold, fontSize: 11 },
    presets: { flexDirection: 'row', gap: 8 },
    preset: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface2,
    },
    presetOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    presetText: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
    input: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      color: theme.textPrimary,
      fontFamily: fonts.regular,
      fontSize: 14,
      backgroundColor: theme.background,
    },
    summary: { borderWidth: 1, borderColor: theme.border, borderRadius: radius.btn, padding: 12, gap: 4 },
    summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
    summaryLabel: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
    summaryValue: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 12 },
    saveRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    saveText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 13 },
    error: { color: theme.danger, fontFamily: fonts.regular, fontSize: 12 },
    primary: { backgroundColor: theme.accent, borderRadius: radius.btn, paddingVertical: 14, alignItems: 'center' },
    primaryText: { color: '#fff', fontFamily: fonts.bold, fontSize: 15 },
    tick: {
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: theme.successBg,
      borderWidth: 1,
      borderColor: theme.successBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
