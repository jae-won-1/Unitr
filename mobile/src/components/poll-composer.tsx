// Proposing poll dates — the port of the web's components/AvailabilityPollForm.tsx,
// laid out the same way: "Date n", Date and Time side by side, then an optional
// location. One composer, used by the captain's sheet on Home and by the full
// poll page (app/poll.tsx), for the same reason the web shares its form: the
// create step carries the one-live-poll-per-team rule (createAvailabilityPoll
// deletes the previous poll first), and two copies would drift.

import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { createAvailabilityPoll, type PollRow } from '@/lib/availability-poll';
import { fonts, radius } from '~/theme';
import { useTheme } from '~/use-theme';
import { DatePicker, TimePicker } from '~/components/date-time-pickers';

// The phone's local calendar date; toISOString() is UTC and can name the wrong day near midnight.
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const emptyRow = (): PollRow & { location: string } => ({ date: '', time: '', location: '' });

export function PollComposer({
  teamId,
  captainId,
  onSent,
  onCancel,
  intro,
}: {
  teamId: string;
  /** The TEAM'S captain — a poll is filed under them even when a co-captain sends it. */
  captainId: string;
  onSent: () => void;
  onCancel?: () => void;
  /** Shown above the first date; the Home sheet puts this in its header instead. */
  intro?: string;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [rows, setRows] = useState([emptyRow()]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (i: number, patch: Partial<ReturnType<typeof emptyRow>>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const filled = rows.filter((r) => r.date && r.time);

  const send = async () => {
    if (filled.length === 0) {
      setError('Add at least one date and time.');
      return;
    }
    setSending(true);
    setError(null);
    const res = await createAvailabilityPoll(teamId, captainId, filled);
    setSending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onSent();
  };

  return (
    <View style={{ gap: 12 }}>
      {!!intro && <Text style={styles.muted}>{intro}</Text>}
      {rows.map((row, i) => (
        <View key={i} style={styles.slot}>
          <Text style={styles.slotTitle}>Date {i + 1}</Text>
          <View style={styles.slotRow}>
            <View style={styles.slotCol}>
              <Text style={styles.fieldLabel}>Date</Text>
              <DatePicker
                value={row.date}
                onChange={(d) =>
                  // A kick-off hour already gone on the newly picked day is dropped, not kept.
                  update(i, { date: d, time: d === todayIso() && row.time && Number(row.time.slice(0, 2)) <= new Date().getHours() ? '' : row.time })
                }
              />
            </View>
            <View style={styles.slotCol}>
              <Text style={styles.fieldLabel}>Time</Text>
              <TimePicker value={row.time} selectedDate={row.date} onChange={(t) => update(i, { time: t })} />
            </View>
            {rows.length > 1 && (
              <Pressable onPress={() => setRows((p) => p.filter((_, idx) => idx !== i))} hitSlop={8} style={styles.trash}>
                <Ionicons name="trash-outline" size={16} color={theme.danger} />
              </Pressable>
            )}
          </View>
          <Text style={styles.fieldLabel}>
            Location <Text style={{ opacity: 0.6 }}>(optional)</Text>
          </Text>
          <TextInput
            value={row.location}
            onChangeText={(v) => update(i, { location: v })}
            placeholder="Where you'd play this slot"
            placeholderTextColor={theme.textSecondary}
            style={styles.input}
          />
        </View>
      ))}
      {rows.length < 5 && (
        <Pressable onPress={() => setRows((p) => [...p, emptyRow()])} style={styles.addRow}>
          <Ionicons name="add" size={18} color={theme.accentInk} />
          <Text style={styles.addRowText}>Add date option</Text>
        </Pressable>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        onPress={send}
        disabled={sending || filled.length === 0}
        style={[styles.primary, (sending || filled.length === 0) && { opacity: 0.5 }]}>
        {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Send to Squad</Text>}
      </Pressable>
      {onCancel && (
        <Pressable onPress={onCancel} style={styles.textBtn}>
          <Text style={styles.textBtnText}>Keep the current poll</Text>
        </Pressable>
      )}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    muted: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
    slot: { gap: 6, paddingTop: 4 },
    slotTitle: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 13 },
    slotRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
    slotCol: { flex: 1, gap: 4 },
    fieldLabel: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
    trash: {
      width: 36,
      height: 36,
      marginBottom: 4,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.danger + '55',
      backgroundColor: theme.danger + '14',
      alignItems: 'center',
      justifyContent: 'center',
    },
    input: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: radius.btn,
      paddingHorizontal: 14,
      paddingVertical: 10,
      color: theme.textPrimary,
      fontFamily: fonts.regular,
      fontSize: 14,
      backgroundColor: theme.surface2,
    },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
    addRowText: { color: theme.accentInk, fontFamily: fonts.semibold, fontSize: 14 },
    error: { color: theme.danger, fontFamily: fonts.regular, fontSize: 12 },
    primary: { backgroundColor: theme.accent, borderRadius: radius.btn, paddingVertical: 14, alignItems: 'center' },
    primaryText: { color: '#fff', fontFamily: fonts.bold, fontSize: 15 },
    textBtn: { alignItems: 'center', paddingVertical: 8 },
    textBtnText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 13 },
  });
