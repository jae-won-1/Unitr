// The pieces the team chat and a one-to-one thread share: header, the message
// list with day separators and runs, and the composer. Same rules as the web's
// app/messages/team/page.tsx:
//
//   • consecutive messages from one person are captioned once (name + initials
//     disc) — a group chat is unreadable with a name over every bubble;
//   • the list only follows new messages down while the reader is at the live
//     end, so a poll can't yank someone out of the history they're reading, and
//     a "New messages" pill brings them back;
//   • the first paint jumps to the latest message; later arrivals animate.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fonts, radius } from '~/theme';
import { useTheme } from '~/use-theme';

export type Bubble = {
  id: string;
  senderId: string;
  /** Shown on incoming runs in a group chat; omit in a one-to-one thread. */
  senderName?: string;
  body: string;
  createdAt: string;
};

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function fmtDay(iso: string): string {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return 'Today';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function ChatScreen({
  title,
  subtitle,
  headerRight,
  banner,
  loading,
  empty,
  messages,
  myId,
  group,
  footer,
}: {
  title: string;
  subtitle?: string;
  headerRight?: ReactNode;
  /** Error or notice shown above the list. */
  banner?: string | null;
  loading: boolean;
  empty: string;
  messages: Bubble[];
  myId: string | undefined;
  /** Group chat: caption incoming runs with name and initials. */
  group: boolean;
  /** The composer, or whatever replaces it (e.g. "You left this chat"). */
  footer: ReactNode;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const list = useRef<FlatList<Bubble>>(null);
  const atBottom = useRef(true);
  const settled = useRef(false);
  const [showJump, setShowJump] = useState(false);

  const scrollToLatest = useCallback((animated: boolean) => {
    list.current?.scrollToEnd({ animated });
    atBottom.current = true;
    setShowJump(false);
  }, []);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const near = contentSize.height - contentOffset.y - layoutMeasurement.height < 80;
    atBottom.current = near;
    if (near) setShowJump(false);
  }, []);

  // New content: follow it if the reader is at the live end, otherwise offer
  // the pill. Runs on size change so it happens after layout.
  const onContentSizeChange = useCallback(() => {
    if (loading) return;
    if (atBottom.current) {
      list.current?.scrollToEnd({ animated: settled.current });
      settled.current = true;
    } else {
      setShowJump(true);
    }
  }, [loading]);

  useEffect(() => {
    if (!loading && messages.length === 0) settled.current = true;
  }, [loading, messages.length]);

  return (
    <KeyboardAvoidingView
      style={styles.page}
      behavior="padding"
      keyboardVerticalOffset={0}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={theme.textPrimary} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {!!subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
        </View>
        {headerRight}
      </View>

      {!!banner && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{banner}</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : (
        <FlatList
          ref={list}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.listContent}
          onScroll={onScroll}
          scrollEventThrottle={100}
          onContentSizeChange={onContentSizeChange}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={styles.empty}>{empty}</Text>}
          renderItem={({ item: m, index: i }) => {
            const mine = m.senderId === myId;
            const prev = messages[i - 1];
            const newDay = !prev || fmtDay(prev.createdAt) !== fmtDay(m.createdAt);
            const startsRun = group && !mine && (!prev || prev.senderId !== m.senderId || newDay);
            return (
              <View>
                {newDay && <Text style={styles.day}>{fmtDay(m.createdAt)}</Text>}
                <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
                  {group && !mine && (
                    <View style={styles.gutter}>
                      {startsRun && (
                        <View style={styles.disc}>
                          <Text style={styles.discText}>{initialsOf(m.senderName ?? '')}</Text>
                        </View>
                      )}
                    </View>
                  )}
                  <View style={{ maxWidth: '78%' }}>
                    {startsRun && <Text style={styles.sender}>{m.senderName}</Text>}
                    <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                      <Text style={[styles.body, mine && styles.bodyMine]}>{m.body}</Text>
                      <Text style={[styles.time, mine && styles.timeMine]}>{fmtTime(m.createdAt)}</Text>
                    </View>
                  </View>
                </View>
              </View>
            );
          }}
        />
      )}

      {showJump && (
        <Pressable onPress={() => scrollToLatest(true)} style={styles.jump}>
          <Text style={styles.jumpText}>New messages</Text>
          <Ionicons name="arrow-down" size={13} color="#fff" />
        </Pressable>
      )}

      <View style={{ paddingBottom: Math.max(insets.bottom, 10) }}>{footer}</View>
    </KeyboardAvoidingView>
  );
}

export function Composer({
  placeholder,
  sending,
  onSend,
}: {
  placeholder: string;
  sending: boolean;
  /** Resolves true when sent; false puts the text back for another try. */
  onSend: (body: string) => Promise<boolean>;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [draft, setDraft] = useState('');

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setDraft('');
    if (!(await onSend(body))) setDraft(body);
  };

  return (
    <View style={styles.composer}>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        style={styles.input}
        multiline
        maxLength={2000}
      />
      <Pressable
        onPress={send}
        disabled={sending || !draft.trim()}
        accessibilityLabel="Send"
        style={[styles.send, (sending || !draft.trim()) && { opacity: 0.4 }]}>
        {sending ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send" size={16} color="#fff" />}
      </Pressable>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
      backgroundColor: theme.surface,
    },
    title: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 17 },
    subtitle: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 11 },
    banner: {
      marginHorizontal: 14,
      marginTop: 10,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      borderRadius: radius.card,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    bannerText: { color: theme.danger, fontFamily: fonts.medium, fontSize: 12 },
    listContent: { paddingHorizontal: 14, paddingVertical: 12, gap: 6, flexGrow: 1 },
    empty: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, textAlign: 'center', paddingVertical: 30 },
    day: {
      color: theme.textSecondary,
      fontFamily: fonts.bold,
      fontSize: 10,
      textAlign: 'center',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      paddingVertical: 8,
    },
    row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
    rowMine: { justifyContent: 'flex-end' },
    rowTheirs: { justifyContent: 'flex-start' },
    gutter: { width: 28 },
    disc: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: theme.surface2,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    discText: { color: theme.accentInk, fontFamily: fonts.bold, fontSize: 9.5 },
    sender: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 11, marginBottom: 2, paddingHorizontal: 4 },
    bubble: { borderRadius: radius.card, paddingHorizontal: 14, paddingVertical: 9 },
    bubbleMine: { backgroundColor: theme.accent },
    bubbleTheirs: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
    body: { color: theme.textPrimary, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
    bodyMine: { color: '#fff' },
    time: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 10, marginTop: 3 },
    timeMine: { color: 'rgba(255,255,255,0.75)' },
    jump: {
      position: 'absolute',
      alignSelf: 'center',
      bottom: 90,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: theme.accent,
      borderRadius: radius.pill,
      paddingHorizontal: 14,
      paddingVertical: 7,
    },
    jumpText: { color: '#fff', fontFamily: fonts.bold, fontSize: 12 },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
      paddingHorizontal: 14,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: theme.border,
      backgroundColor: theme.surface,
    },
    input: {
      flex: 1,
      maxHeight: 120,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: radius.btn,
      paddingHorizontal: 14,
      paddingTop: 10,
      paddingBottom: 10,
      color: theme.textPrimary,
      fontFamily: fonts.regular,
      fontSize: 14,
      backgroundColor: theme.background,
    },
    send: {
      width: 42,
      height: 42,
      borderRadius: radius.btn,
      backgroundColor: theme.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
