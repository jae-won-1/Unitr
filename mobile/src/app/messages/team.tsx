// Team group chat — the mobile port of app/messages/team/page.tsx.
//
// Everything that touches the database is lib/team-chat.ts, unchanged, so the
// rules the web chat follows are the same here: membership is derived (captain
// + approved squad), muting only silences the badge, leaving freezes the
// history at left_at and the database refuses a leaver's posts, and rejoining
// is theirs to do. New messages arrive by polling every 5s while the app is in
// the foreground (usePoll — AppState in place of the web's document.hidden).

import { useCallback, useEffect, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { loadLeadership } from '@/lib/team-leadership';
import {
  CHAT_MIGRATION_HINT,
  leaveChat,
  loadMessages,
  loadSettings,
  markRead,
  rejoinChat,
  sendMessage,
  setMuted,
  type ChatMessage,
  type ChatSettings,
} from '@/lib/team-chat';
import { fonts, radius } from '~/theme';
import { useTheme } from '~/use-theme';
import { usePoll } from '~/use-poll';
import { ChatScreen, Composer } from '~/components/chat';

export default function TeamChat() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { user } = useAuth();
  const [teamId, setTeamId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState('Team chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [settings, setSettings] = useState<ChatSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const hasLeft = Boolean(settings?.leftAt);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const led = await loadLeadership(user.id);
      if (!led) {
        setLoading(false);
        return;
      }
      setTeamId(led.teamId);
      const { data: team } = await supabase.from('teams').select('name').eq('id', led.teamId).maybeSingle();
      if (team?.name) setTeamName(team.name as string);

      const s = await loadSettings(led.teamId, user.id);
      if (!s) {
        setError(CHAT_MIGRATION_HINT);
        setLoading(false);
        return;
      }
      setSettings(s);
      const rows = await loadMessages(led.teamId, { before: s.leftAt });
      if (rows === null) {
        setError(CHAT_MIGRATION_HINT);
        setLoading(false);
        return;
      }
      setMessages(rows);
      setLoading(false);
      if (!s.leftAt) await markRead(led.teamId, user.id);
    })();
  }, [user]);

  // Only ever appends what isn't already on screen — a poll and a send can
  // both fetch the same row.
  const append = useCallback((rows: ChatMessage[]) => {
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const fresh = rows.filter((r) => !seen.has(r.id));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
  }, []);

  const newest = messages[messages.length - 1]?.createdAt ?? null;

  const poll = useCallback(async () => {
    if (!user || !teamId || hasLeft) return;
    const rows = await loadMessages(teamId, { after: newest });
    if (!rows || rows.length === 0) return;
    append(rows);
    await markRead(teamId, user.id);
  }, [user, teamId, hasLeft, newest, append]);

  usePoll(poll, 5000, !!teamId && !hasLeft);

  const send = async (body: string): Promise<boolean> => {
    if (!user || !teamId) return false;
    setSending(true);
    const res = await sendMessage(teamId, user.id, body);
    if (!res.ok) {
      setError(res.error ?? "Couldn't send that.");
      setSending(false);
      return false;
    }
    setError(null);
    const rows = await loadMessages(teamId, { after: newest });
    if (rows?.length) append(rows);
    await markRead(teamId, user.id);
    setSending(false);
    return true;
  };

  const toggleMute = async () => {
    if (!user || !teamId || !settings) return;
    const next = !settings.muted;
    setSettings({ ...settings, muted: next });
    if (!(await setMuted(teamId, user.id, next))) setSettings({ ...settings, muted: !next });
  };

  const leave = () =>
    Alert.alert('Leave the team chat?', "You'll keep what was said up to now, and see nothing new until you rejoin.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          if (!user || !teamId) return;
          const now = new Date().toISOString();
          if (await leaveChat(teamId, user.id)) {
            setSettings((s) => ({ muted: s?.muted ?? false, leftAt: now, lastReadAt: s?.lastReadAt ?? null }));
            setMessages((prev) => prev.filter((m) => m.createdAt <= now));
          }
        },
      },
    ]);

  const rejoin = async () => {
    if (!user || !teamId) return;
    if (await rejoinChat(teamId, user.id)) {
      setSettings((s) => ({ muted: s?.muted ?? false, leftAt: null, lastReadAt: new Date().toISOString() }));
      const rows = await loadMessages(teamId);
      if (rows) setMessages(rows);
    }
  };

  // The web's ⋯ menu, as the platform's own sheet.
  const openMenu = () => {
    if (!settings) return;
    const muteLabel = settings.muted ? 'Turn notifications on' : 'Turn notifications off';
    const leaveLabel = hasLeft ? 'Rejoin chat' : 'Leave chat';
    const pick = (i: number) => {
      if (i === 0) void toggleMute();
      if (i === 1) {
        if (hasLeft) void rejoin();
        else leave();
      }
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [muteLabel, leaveLabel, 'Cancel'], cancelButtonIndex: 2, destructiveButtonIndex: hasLeft ? undefined : 1 },
        pick,
      );
    } else {
      Alert.alert('Team chat', undefined, [
        { text: muteLabel, onPress: () => pick(0) },
        { text: leaveLabel, style: hasLeft ? 'default' : 'destructive', onPress: () => pick(1) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  return (
    <ChatScreen
      title={teamName}
      subtitle={`Team chat · everyone in the squad${settings?.muted && !hasLeft ? ' · muted' : ''}`}
      headerRight={
        teamId && settings ? (
          <Pressable onPress={openMenu} hitSlop={10} accessibilityLabel="Chat options">
            <Ionicons name="ellipsis-vertical" size={20} color={theme.textSecondary} />
          </Pressable>
        ) : null
      }
      banner={error}
      loading={loading}
      empty={
        teamId
          ? 'No messages yet — everyone in the squad is here.'
          : "The team chat opens once you're in a squad."
      }
      messages={messages.map((m) => ({ ...m }))}
      myId={user?.id}
      group
      footer={
        !teamId || loading ? null : hasLeft ? (
          <View style={styles.left}>
            <View style={{ flex: 1 }}>
              <Text style={styles.leftTitle}>You left this chat</Text>
              <Text style={styles.leftSub}>You&apos;ll see what was said up to then, and nothing new.</Text>
            </View>
            <Pressable onPress={rejoin} style={styles.rejoin}>
              <Text style={styles.rejoinText}>Rejoin</Text>
            </Pressable>
          </View>
        ) : (
          <Composer placeholder="Message your team..." sending={sending} onSend={send} />
        )
      }
    />
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    left: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginHorizontal: 14,
      marginTop: 10,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      borderRadius: radius.card,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    leftTitle: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 13 },
    leftSub: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 11 },
    rejoin: { backgroundColor: theme.accent, borderRadius: radius.btn, paddingHorizontal: 16, paddingVertical: 9 },
    rejoinText: { color: '#fff', fontFamily: fonts.bold, fontSize: 13 },
  });
