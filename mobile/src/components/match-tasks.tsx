// The jobs around a fixture that aren't football — bring the kit, collect the
// ball, give Danny a lift. The port of MatchTasks in the web's
// app/my-team/match/[matchId]/page.tsx, same tables and same rules:
//
//   • a task with no assignee is for the whole squad, and completion is
//     per-player — "everyone bring £5" needs ten separate ticks, not one;
//   • un-ticking is a delete, not a flag flip — no row is the only "not done";
//   • a task aimed at someone else is information, not a to-do;
//   • only the captain (or a co-captain) adds and removes.
//
// A missing table (supabase_match_tasks.sql not run) disables the card with
// the reason, per the house rule that missing migrations degrade.

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { supabase } from '@/lib/supabase';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';

type TaskRow = { id: string; title: string; detail: string | null; assignee_id: string | null };

const TASKS_MISSING_MSG = "Match tasks aren't set up yet — run supabase_match_tasks.sql.";

export function MatchTasks({
  matchId,
  teamId,
  userId,
  isCaptain,
  squad,
}: {
  matchId: string;
  teamId: string;
  userId: string;
  isCaptain: boolean;
  squad: { player_id: string; full_name: string }[];
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [doneByTask, setDoneByTask] = useState<Record<string, Set<string>>>({});
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('match_tasks')
      .select('id, title, detail, assignee_id')
      .eq('match_id', matchId)
      .eq('team_id', teamId)
      .order('created_at', { ascending: true });
    if (error) {
      setUnavailable(true);
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as TaskRow[];
    const { data: done } = rows.length
      ? await supabase.from('match_task_done').select('task_id, player_id').in('task_id', rows.map((r) => r.id))
      : { data: [] as { task_id: string; player_id: string }[] };
    const map: Record<string, Set<string>> = {};
    for (const d of done ?? []) (map[d.task_id] ??= new Set()).add(d.player_id);
    setTasks(rows);
    setDoneByTask(map);
    setUnavailable(false);
    setLoading(false);
  }, [matchId, teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  const addTask = async () => {
    if (!title.trim()) return;
    setBusy(true);
    await supabase.from('match_tasks').insert({
      match_id: matchId,
      team_id: teamId,
      title: title.trim(),
      detail: detail.trim() || null,
      assignee_id: assignee,
      created_by: userId,
    });
    setTitle('');
    setDetail('');
    setAssignee(null);
    setAdding(false);
    setBusy(false);
    void load();
  };

  const removeTask = async (id: string) => {
    await supabase.from('match_tasks').delete().eq('id', id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const toggleDone = async (taskId: string) => {
    const mine = doneByTask[taskId]?.has(userId);
    setDoneByTask((prev) => {
      const set = new Set(prev[taskId] ?? []);
      if (mine) set.delete(userId);
      else set.add(userId);
      return { ...prev, [taskId]: set };
    });
    if (mine) {
      await supabase.from('match_task_done').delete().eq('task_id', taskId).eq('player_id', userId);
    } else {
      await supabase.from('match_task_done').upsert({ task_id: taskId, player_id: userId }, { onConflict: 'task_id,player_id' });
    }
  };

  if (loading) return null;
  const nameOf = (id: string) => squad.find((s) => s.player_id === id)?.full_name ?? 'Player';

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>Tasks</Text>
        <Pressable
          disabled={!isCaptain || unavailable}
          onPress={() => setAdding((v) => !v)}
          hitSlop={8}
          style={(!isCaptain || unavailable) && { opacity: 0.4 }}>
          <Text style={styles.add}>{adding ? 'Cancel' : '+ Add'}</Text>
        </Pressable>
      </View>

      {unavailable ? (
        <Text style={styles.muted}>{TASKS_MISSING_MSG}</Text>
      ) : (
        <>
          {adding && (
            <View style={styles.form}>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Bring the away kit"
                placeholderTextColor={theme.textSecondary}
                style={styles.input}
              />
              <TextInput
                value={detail}
                onChangeText={setDetail}
                placeholder="Any detail (optional)"
                placeholderTextColor={theme.textSecondary}
                style={styles.input}
              />
              <Pressable onPress={() => setAssigneeOpen(true)} style={[styles.input, styles.select]}>
                <Text style={styles.selectText}>{assignee ? nameOf(assignee) : 'Everyone'}</Text>
                <Ionicons name="chevron-down" size={16} color={theme.textSecondary} />
              </Pressable>
              <Pressable onPress={addTask} disabled={busy || !title.trim()} style={[styles.primary, (busy || !title.trim()) && { opacity: 0.5 }]}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Add task</Text>}
              </Pressable>
            </View>
          )}

          {tasks.length === 0 ? (
            <Text style={styles.muted}>
              {isCaptain ? 'Nothing to sort yet. Add what the squad needs to bring or do.' : "Your captain hasn't set any tasks."}
            </Text>
          ) : (
            <View style={{ gap: 10 }}>
              {tasks.map((t) => {
                const mineDone = doneByTask[t.id]?.has(userId) ?? false;
                const doneCount = doneByTask[t.id]?.size ?? 0;
                const isMine = !t.assignee_id || t.assignee_id === userId;
                return (
                  <View key={t.id} style={styles.task}>
                    <Pressable
                      disabled={!isMine}
                      onPress={() => toggleDone(t.id)}
                      hitSlop={6}
                      style={[styles.box, mineDone && styles.boxOn, !isMine && { opacity: 0.3 }]}>
                      {mineDone && <Ionicons name="checkmark" size={14} color="#fff" />}
                    </Pressable>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.taskTitle, mineDone && styles.taskDone]}>{t.title}</Text>
                      {!!t.detail && <Text style={styles.small}>{t.detail}</Text>}
                      <Text style={styles.small}>{t.assignee_id ? nameOf(t.assignee_id) : `Everyone · ${doneCount} done`}</Text>
                    </View>
                    {isCaptain && (
                      <Pressable onPress={() => removeTask(t.id)} hitSlop={8}>
                        <Text style={styles.small}>Remove</Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </>
      )}

      <Modal visible={assigneeOpen} transparent animationType="slide" onRequestClose={() => setAssigneeOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setAssigneeOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Who is it for?</Text>
            <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: 6 }}>
              {[{ player_id: '', full_name: 'Everyone' }, ...squad].map((s) => {
                const on = (assignee ?? '') === s.player_id;
                return (
                  <Pressable
                    key={s.player_id || 'everyone'}
                    onPress={() => {
                      setAssignee(s.player_id || null);
                      setAssigneeOpen(false);
                    }}
                    style={[styles.pick, on && styles.pickOn]}>
                    <Text style={styles.taskTitle}>{s.full_name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
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
    title: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.7 },
    add: { color: theme.accentInk, fontFamily: fonts.bold, fontSize: 13 },
    muted: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
    small: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 11 },
    form: { gap: 8, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: theme.border },
    input: {
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
    select: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    selectText: { color: theme.textPrimary, fontFamily: fonts.regular, fontSize: 14 },
    primary: { backgroundColor: theme.accent, borderRadius: radius.btn, paddingVertical: 11, alignItems: 'center' },
    primaryText: { color: '#fff', fontFamily: fonts.bold, fontSize: 14 },
    task: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    box: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 1,
    },
    boxOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    taskTitle: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 14 },
    taskDone: { textDecorationLine: 'line-through', color: theme.textSecondary },
    scrim: { flex: 1, backgroundColor: theme.scrim, justifyContent: 'flex-end' },
    sheet: { backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 34, gap: 8 },
    sheetTitle: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 16, marginBottom: 4 },
    pick: { borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11 },
    pickOn: { borderColor: theme.accent, backgroundColor: theme.successBg },
  });
