// Answering the captain's availability poll — the poll half of the web's
// components/AvailabilityModal.tsx. (The fixture half — "am I playing this
// game?" — is already on Home as the per-game Available / Can't play buttons.)
//
// Same record and same rules as the web:
//   • the answer is one availability_responses row per player per poll,
//     upserted, and an EMPTY list is a real answer ("none of these") — distinct
//     from not having replied;
//   • owing the team money blocks picking dates (claiming a place), never
//     "unavailable for any of these" (claiming nothing) — lib/availability-gate;
//   • a blocked player can still UNpick a date they'd already picked, because
//     "none of these" is only reachable with nothing selected.

import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { supabase } from '@/lib/supabase';
import { owedSummary, useAvailabilityGate } from '@/lib/availability-gate';
import type { PollRequest } from '@/lib/availability-poll';
import { fonts, radius } from '~/theme';
import { useTheme } from '~/use-theme';

export function PollSheet({
  visible,
  request,
  myAnswer,
  teamId,
  userId,
  onClose,
  onPay,
}: {
  visible: boolean;
  request: PollRequest;
  /** null = hasn't replied; [] = "none of these". */
  myAnswer: string[] | null;
  teamId: string;
  userId: string;
  onClose: (answered: boolean) => void;
  /** Opens the pay sheet, for a player the gate is blocking. */
  onPay: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const gate = useAvailabilityGate(teamId, userId);
  const blocked = !gate.loading && gate.blocked;

  const [selected, setSelected] = useState<string[]>([]);
  const [noneWork, setNoneWork] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setSelected(myAnswer ?? []);
    setNoneWork(myAnswer !== null && myAnswer.length === 0);
    setError(null);
  }, [visible, myAnswer]);

  const blocksAnswer = blocked && !noneWork;
  const canSubmit = (selected.length > 0 || noneWork) && !submitting && !blocksAnswer;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    // The same upsert the web modal and the My Team tab write.
    const { error: err } = await supabase
      .from('availability_responses')
      .upsert(
        { request_id: request.id, player_id: userId, available_date_ids: noneWork ? [] : selected },
        { onConflict: 'request_id,player_id' },
      );
    setSubmitting(false);
    if (err) {
      setError("Couldn't save your availability. Try again.");
      return;
    }
    onClose(true);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => onClose(false)}>
      <Pressable style={styles.scrim} onPress={() => onClose(false)}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Proposed dates</Text>
            <Pressable onPress={() => onClose(false)} hitSlop={10}>
              <Ionicons name="close" size={22} color={theme.textSecondary} />
            </Pressable>
          </View>
          <Text style={styles.sub}>Pick every slot you could play. Your captain sees the totals, not who picked what.</Text>

          {blocked && (
            <View style={styles.owe}>
              <Text style={styles.oweText}>
                You still owe {owedSummary(gate)}. Pay it to put yourself forward — you can still tell your
                captain you&apos;re unavailable.{' '}
                <Text style={styles.link} onPress={onPay}>
                  Pay now
                </Text>
              </Text>
            </View>
          )}

          <ScrollView contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
            {request.date_options.map((opt) => {
              const picked = selected.includes(opt.id);
              const disabled = noneWork || (blocked && !picked);
              return (
                <Pressable
                  key={opt.id}
                  disabled={disabled}
                  onPress={() => setSelected((prev) => (prev.includes(opt.id) ? prev.filter((d) => d !== opt.id) : [...prev, opt.id]))}
                  style={[styles.option, picked && styles.optionOn, disabled && { opacity: 0.4 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.optTitle, picked && { color: theme.accentInk }]}>
                      {opt.dayName} · {opt.time}
                    </Text>
                    <Text style={styles.optSub}>
                      {opt.date}
                      {opt.location ? ` · ${opt.location}` : ''}
                    </Text>
                  </View>
                  <View style={[styles.tick, picked && styles.tickOn]}>
                    {picked && <Ionicons name="checkmark" size={13} color="#fff" />}
                  </View>
                </Pressable>
              );
            })}

            <Pressable
              disabled={selected.length > 0}
              onPress={() => setNoneWork((v) => !v)}
              style={[styles.option, noneWork && styles.optionNone, selected.length > 0 && { opacity: 0.4 }]}>
              <Text style={[styles.optTitle, { flex: 1, color: noneWork ? theme.danger : theme.textSecondary }]}>
                Unavailable for any of these dates
              </Text>
              <View style={[styles.tick, noneWork && { backgroundColor: theme.danger, borderColor: theme.danger }]}>
                {noneWork && <Ionicons name="checkmark" size={13} color="#fff" />}
              </View>
            </Pressable>
          </ScrollView>

          {!!error && <Text style={styles.error}>{error}</Text>}
          <Pressable onPress={submit} disabled={!canSubmit} style={[styles.primary, !canSubmit && { opacity: 0.4 }]}>
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryText}>{myAnswer !== null ? 'Update' : 'Submit'}</Text>
            )}
          </Pressable>
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
      maxHeight: '85%',
      gap: 10,
    },
    handle: { alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: theme.border, marginBottom: 4 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 18 },
    sub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
    owe: { backgroundColor: '#FDECEC', borderColor: '#F5C2C2', borderWidth: 1, borderRadius: 12, padding: 10 },
    oweText: { color: theme.danger, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 17 },
    link: { color: theme.accentInk, fontFamily: fonts.bold },
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
    optionNone: { backgroundColor: '#FDECEC', borderColor: theme.danger },
    optTitle: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14 },
    optSub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 11, marginTop: 1 },
    tick: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tickOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    error: { color: theme.danger, fontFamily: fonts.regular, fontSize: 12 },
    primary: { backgroundColor: theme.accent, borderRadius: radius.btn, paddingVertical: 14, alignItems: 'center' },
    primaryText: { color: '#fff', fontFamily: fonts.bold, fontSize: 15 },
  });
