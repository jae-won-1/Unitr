// Tactics — the mobile port of components/my-team/TacticsTab.tsx: the team's
// library of saved setups (team_tactics). Captains author, players read.
//
// Reads go through the shared loadTeamTactics / loadSquadOptions
// (lib/team-tactics.ts); the save and delete are copies of the web editor's two
// writes — keep them in step. Carried-over rules:
//   • a setup can name players, resolved against the CURRENT squad when shown,
//     so someone who has left is an empty slot, never a ghost name — and
//     saving drops them;
//   • changing a setup's match size clears its lineup outright, because a slot
//     index means a different position on a different board;
//   • (team_id, title) is unique, so a duplicate name gets a plain sentence.

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { loadLeadership } from '@/lib/team-leadership';
import { loadSquadOptions, loadTeamTactics, type SquadOption, type TeamTactic } from '@/lib/team-tactics';
import {
  PLAY_STYLES,
  PRESSING_LEVELS,
  TACTIC_SITUATIONS,
  TEAM_SIZES,
  defaultFormationFor,
  formatLabelForSize,
  formationKeysFor,
  sizeOfFormation,
  slotsFor,
  teamSizeFromFormat,
  type TeamSize,
} from '@/lib/formations';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';
import { PitchBoard } from '~/components/pitch-board';

export default function Tactics() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { user } = useAuth();
  const [teamId, setTeamId] = useState<string | null | undefined>(undefined);
  const [canManage, setCanManage] = useState(false);
  const [presets, setPresets] = useState<TeamTactic[] | null>([]);
  const [squad, setSquad] = useState<SquadOption[]>([]);
  const [teamSize, setTeamSize] = useState<TeamSize>(teamSizeFromFormat(null));
  const [editing, setEditing] = useState<TeamTactic | null | undefined>(undefined); // undefined = closed

  const load = useCallback(async (tid: string) => {
    setPresets(await loadTeamTactics(tid));
  }, []);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const led = await loadLeadership(user.id);
      if (!led) {
        setTeamId(null);
        return;
      }
      setTeamId(led.teamId);
      setCanManage(led.canManage);
      const [{ data: t }, sq] = await Promise.all([
        supabase.from('teams').select('format').eq('id', led.teamId).maybeSingle(),
        loadSquadOptions(led.teamId),
      ]);
      setTeamSize(teamSizeFromFormat((t as { format?: string } | null)?.format));
      setSquad(sq);
      await load(led.teamId);
    })();
  }, [user, load]);

  const nameById = new Map(squad.map((p) => [p.id, p.name]));

  const remove = (t: TeamTactic) =>
    Alert.alert(`Delete "${t.title}"?`, 'The squad will no longer see it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('team_tactics').delete().eq('id', t.id);
          setPresets((prev) => (prev ?? []).filter((x) => x.id !== t.id));
        },
      },
    ]);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
        <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      <Text style={styles.heading}>Tactics</Text>
      <Text style={styles.sub}>
        {canManage ? 'Build a setup once, then load it into any tournament game.' : 'How your captain wants the team to play.'}
      </Text>

      {teamId === undefined ? (
        <ActivityIndicator color={theme.accent} style={{ marginTop: 30 }} />
      ) : teamId === null ? (
        <Text style={styles.muted}>Join a team to see its tactics.</Text>
      ) : presets === null ? (
        <Text style={styles.muted}>Saved tactics aren&apos;t set up on this database yet.</Text>
      ) : (
        <>
          {canManage && (
            <Pressable onPress={() => setEditing(null)} style={styles.primary}>
              <Text style={styles.primaryText}>New setup</Text>
            </Pressable>
          )}
          {presets.length === 0 && <Text style={styles.muted}>No saved setups yet.</Text>}
          {presets.map((t) => {
            const size = sizeOfFormation(t.formation);
            return (
              <View key={t.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{t.title}</Text>
                    <Text style={styles.small}>
                      {[formatLabelForSize(size), t.formation, t.situation, t.style, t.pressing ? `${t.pressing} press` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                  {canManage && (
                    <View style={{ flexDirection: 'row', gap: 14 }}>
                      <Pressable onPress={() => setEditing(t)} hitSlop={8}>
                        <Ionicons name="create-outline" size={20} color={theme.textSecondary} />
                      </Pressable>
                      <Pressable onPress={() => remove(t)} hitSlop={8}>
                        <Ionicons name="trash-outline" size={20} color={theme.danger} />
                      </Pressable>
                    </View>
                  )}
                </View>
                <PitchBoard slots={slotsFor(t.formation, size)} lineup={t.lineup} nameById={nameById} />
                {!!t.notes && <Text style={styles.notesText}>{t.notes}</Text>}
              </View>
            );
          })}
        </>
      )}

      {editing !== undefined && teamId && user && (
        <Editor
          teamId={teamId}
          userId={user.id}
          existing={editing}
          teamSize={teamSize}
          squad={squad}
          onCancel={() => setEditing(undefined)}
          onDone={() => {
            setEditing(undefined);
            void load(teamId);
          }}
        />
      )}
    </ScrollView>
  );
}

function Editor({
  teamId,
  userId,
  existing,
  teamSize,
  squad,
  onCancel,
  onDone,
}: {
  teamId: string;
  userId: string;
  existing: TeamTactic | null;
  teamSize: TeamSize;
  squad: SquadOption[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [situation, setSituation] = useState(existing?.situation ?? '');
  const [size, setSize] = useState<TeamSize>(existing ? sizeOfFormation(existing.formation) : teamSize);
  const [formation, setFormation] = useState(existing?.formation ?? defaultFormationFor(teamSize));
  const [style, setStyle] = useState<string | null>(existing?.style ?? null);
  const [pressing, setPressing] = useState<string | null>(existing?.pressing ?? null);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [lineup, setLineup] = useState<Record<number, string>>(existing?.lineup ?? {});
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slots = slotsFor(formation, size);
  const nameById = new Map(squad.map((p) => [p.id, p.name]));
  // What the captain is looking at is what gets written: slots on this board,
  // players still in the squad.
  const visibleLineup = Object.fromEntries(
    Object.entries(lineup).filter(([i, pid]) => Number(i) < slots.length && nameById.has(pid)),
  ) as Record<number, string>;

  const changeSize = (s: TeamSize) => {
    if (s === size) return;
    setSize(s);
    setFormation(defaultFormationFor(s));
    // A slot index names a different position on a different board.
    setLineup({});
  };

  const assign = (slot: number, pid: string | null) => {
    const next = { ...lineup };
    for (const [k, v] of Object.entries(next)) if (v === pid) delete next[Number(k)];
    if (pid) next[slot] = pid;
    else delete next[slot];
    setLineup(next);
    setPickerSlot(null);
  };

  // The web editor's two writes.
  const save = async () => {
    if (!title.trim()) return setError('Give this setup a name so you can find it later.');
    setBusy(true);
    setError(null);
    const payload = {
      team_id: teamId,
      title: title.trim(),
      situation: situation || null,
      formation,
      style,
      pressing,
      notes: notes.trim() || null,
      // A squad that failed to load would otherwise wipe a lineup the captain
      // never touched, so the pruned version is only trusted when there is one.
      lineup: squad.length > 0 ? visibleLineup : lineup,
      updated_at: new Date().toISOString(),
    };
    const { error: err } = existing
      ? await supabase.from('team_tactics').update(payload).eq('id', existing.id)
      : await supabase.from('team_tactics').insert({ ...payload, created_by: userId });
    setBusy(false);
    if (err) return setError(err.code === '23505' ? 'You already have a setup with that name.' : err.message);
    onDone();
  };

  const chipRow = (options: string[], value: string | null, onPick: (v: string | null) => void, allowClear = true) => (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable key={o} onPress={() => onPick(on && allowClear ? null : o)} style={[styles.chip, on && styles.chipOn]}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{o}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.editorHead}>
          <Pressable onPress={onCancel} hitSlop={10}>
            <Text style={styles.backText}>Cancel</Text>
          </Pressable>
          <Text style={styles.editorTitle}>{existing ? 'Edit setup' : 'New setup'}</Text>
          <View style={{ width: 50 }} />
        </View>

        <Text style={styles.label}>Name</Text>
        <TextInput value={title} onChangeText={setTitle} placeholder="e.g. High press vs weak keeper" placeholderTextColor={theme.textSecondary} style={styles.input} />

        <Text style={styles.label}>Situation</Text>
        {chipRow(TACTIC_SITUATIONS, situation || null, (v) => setSituation(v ?? ''))}

        <Text style={styles.label}>Match size</Text>
        {chipRow(TEAM_SIZES.map((s) => formatLabelForSize(s)), formatLabelForSize(size), (v) => {
          const s = TEAM_SIZES.find((x) => formatLabelForSize(x) === v);
          if (s) changeSize(s);
        }, false)}

        <Text style={styles.label}>Formation</Text>
        {chipRow(formationKeysFor(size), formation, (v) => v && setFormation(v), false)}

        <PitchBoard slots={slots} lineup={visibleLineup} nameById={nameById} onSlotPress={(i) => setPickerSlot(i)} />
        <Text style={styles.small}>Tap a position to put a player in it — optional.</Text>

        <Text style={styles.label}>Style</Text>
        {chipRow(PLAY_STYLES, style, setStyle)}
        <Text style={styles.label}>Pressing</Text>
        {chipRow(PRESSING_LEVELS, pressing, setPressing)}

        <Text style={styles.label}>Notes</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          multiline
          placeholder="Set pieces, marking, anything the squad should know"
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]}
        />

        {!!error && <Text style={styles.error}>{error}</Text>}
        <Pressable onPress={save} disabled={busy} style={[styles.primary, busy && { opacity: 0.6 }]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Save setup</Text>}
        </Pressable>
      </ScrollView>

      <Modal visible={pickerSlot !== null} transparent animationType="slide" onRequestClose={() => setPickerSlot(null)}>
        <Pressable style={styles.scrim} onPress={() => setPickerSlot(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.cardTitle}>{pickerSlot !== null ? `Who plays ${slots[pickerSlot]?.position}?` : ''}</Text>
            <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: 6 }}>
              {squad.map((p) => (
                <Pressable key={p.id} onPress={() => pickerSlot !== null && assign(pickerSlot, p.id)} style={styles.pick}>
                  <Text style={styles.pickName}>{p.name}</Text>
                  {!!p.position && <Text style={styles.small}>{p.position}</Text>}
                </Pressable>
              ))}
            </ScrollView>
            {pickerSlot !== null && visibleLineup[pickerSlot] && (
              <Pressable onPress={() => assign(pickerSlot, null)} style={{ alignItems: 'center', paddingVertical: 8 }}>
                <Text style={[styles.small, { color: theme.danger, fontFamily: fonts.semibold }]}>Clear this position</Text>
              </Pressable>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </Modal>
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
      gap: 10,
      ...cardShadow,
    },
    cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    cardTitle: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 15 },
    notesText: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
    editorHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    editorTitle: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 17 },
    label: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 13, marginTop: 4 },
    input: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: radius.btn,
      paddingHorizontal: 14,
      paddingVertical: 11,
      color: theme.textPrimary,
      fontFamily: fonts.regular,
      fontSize: 14,
      backgroundColor: theme.surface,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1, borderColor: theme.border, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: theme.surface },
    chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    chipText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 12 },
    chipTextOn: { color: '#fff' },
    error: { color: theme.danger, fontFamily: fonts.regular, fontSize: 12 },
    primary: { backgroundColor: theme.accent, borderRadius: radius.btn, paddingVertical: 14, alignItems: 'center' },
    primaryText: { color: '#fff', fontFamily: fonts.bold, fontSize: 15 },
    scrim: { flex: 1, backgroundColor: theme.scrim, justifyContent: 'flex-end' },
    sheet: { backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 34, gap: 8 },
    pick: { borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
    pickName: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 14 },
  });
