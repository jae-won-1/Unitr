// Messages inbox — the mobile port of app/messages/page.tsx: the team group
// chat pinned above the one-to-one threads, with a search box.
//
// Data is shared: loadConversations (lib/direct-messages.ts) and
// loadChatSummary (lib/team-chat.ts). Re-read every time the screen comes into
// focus, so coming back from a thread clears its unread count.

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAuth } from '@/contexts/AuthContext';
import { loadLeadership } from '@/lib/team-leadership';
import { loadChatSummary, type ChatSummary } from '@/lib/team-chat';
import { loadConversations, type Conversation } from '@/lib/direct-messages';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';
import { initialsOf } from '~/components/chat';

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

export default function Inbox() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [chat, setChat] = useState<ChatSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    const [convos, led] = await Promise.all([loadConversations(user.id), loadLeadership(user.id)]);
    setConversations(convos);
    setChat(await loadChatSummary(led?.teamId, user.id));
    setLoading(false);
    setRefreshing(false);
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const q = search.trim().toLowerCase();
  const filtered = q ? conversations.filter((c) => c.name.toLowerCase().includes(q)) : conversations;
  const chatShown = !!chat && (!q || chat.teamName.toLowerCase().includes(q) || 'team chat'.includes(q));
  // Every unread message, not every unread thread; a muted or left team chat
  // contributes 0 by construction (loadChatSummary).
  const totalUnread = conversations.reduce((n, c) => n + c.unreadCount, 0) + (chat?.unreadCount ?? 0);

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          tintColor={theme.textSecondary}
        />
      }>
      <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
        <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      <Text style={styles.heading}>Messages</Text>
      <Text style={styles.sub}>{totalUnread > 0 ? `${totalUnread} unread` : 'All caught up'}</Text>

      <View style={styles.search}>
        <Ionicons name="search" size={16} color={theme.textSecondary} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search messages..."
          placeholderTextColor={theme.textSecondary}
          style={styles.searchInput}
          autoCorrect={false}
        />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : filtered.length === 0 && !chatShown ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="chatbubble-outline" size={34} color={theme.textSecondary} />
          <Text style={styles.emptyTitle}>No conversations yet</Text>
          <Text style={styles.emptyBody}>
            Direct messages show up here, along with announcements and payment reminders from your
            captain.
          </Text>
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          {chat && chatShown && (
            <Pressable
              onPress={() => router.push('/messages/team')}
              style={[styles.card, styles.chatRow, chat.unreadCount > 0 && styles.unreadBg, chat.hasLeft && { opacity: 0.55 }]}>
              <View style={[styles.tile, chat.unreadCount > 0 && styles.tileOn]}>
                <Ionicons name="people" size={20} color={chat.unreadCount > 0 ? '#fff' : theme.textSecondary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.nameRow}>
                  <Text style={styles.name} numberOfLines={1}>{chat.teamName}</Text>
                  {chat.lastAt && <Text style={styles.when}>{timeAgo(chat.lastAt)}</Text>}
                </View>
                <Text style={styles.preview} numberOfLines={1}>
                  {chat.hasLeft ? 'You left this chat — tap to rejoin' : chat.preview ?? 'Team chat — everyone in the squad'}
                </Text>
              </View>
              {chat.muted && !chat.hasLeft && (
                <Ionicons name="notifications-off-outline" size={16} color={theme.textSecondary} />
              )}
              {chat.unreadCount > 0 && <Badge n={chat.unreadCount} styles={styles} />}
            </Pressable>
          )}

          {filtered.length > 0 && (
            <View style={[styles.card, { overflow: 'hidden' }]}>
              {filtered.map((c, i) => {
                const unread = c.unreadCount > 0;
                return (
                  <Pressable
                    key={c.otherId}
                    onPress={() => router.push({ pathname: '/messages/[otherId]', params: { otherId: c.otherId } })}
                    style={[styles.chatRow, i > 0 && styles.divider, unread && styles.unreadBg]}>
                    <View style={[styles.tile, unread && styles.tileOn]}>
                      <Text style={[styles.tileText, unread && { color: '#fff' }]}>{initialsOf(c.name)}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={styles.nameRow}>
                        <Text style={styles.name} numberOfLines={1}>{c.name}</Text>
                        <Text style={styles.when}>{timeAgo(c.createdAt)}</Text>
                      </View>
                      <Text style={styles.preview} numberOfLines={1}>{c.preview}</Text>
                    </View>
                    {unread && <Badge n={c.unreadCount} styles={styles} />}
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

function Badge({ n, styles }: { n: number; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{n}</Text>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.background },
    content: { padding: 20, paddingTop: 56, paddingBottom: 40 },
    back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', marginBottom: 8 },
    backText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 15 },
    heading: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 26 },
    sub: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 13, marginTop: 2, marginBottom: 14 },
    search: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      borderRadius: radius.btn,
      paddingHorizontal: 12,
      marginBottom: 18,
    },
    searchInput: { flex: 1, paddingVertical: 10, color: theme.textPrimary, fontFamily: fonts.regular, fontSize: 14 },
    center: { paddingVertical: 40, alignItems: 'center' },
    emptyWrap: { alignItems: 'center', gap: 8, paddingVertical: 40, paddingHorizontal: 20 },
    emptyTitle: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 15 },
    emptyBody: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, textAlign: 'center', lineHeight: 18 },
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      ...cardShadow,
    },
    chatRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
    divider: { borderTopWidth: 1, borderTopColor: theme.border },
    unreadBg: { backgroundColor: '#F6FBF7' },
    tile: {
      width: 44,
      height: 44,
      borderRadius: radius.btn,
      backgroundColor: theme.surface2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tileOn: { backgroundColor: theme.accent },
    tileText: { color: theme.textSecondary, fontFamily: fonts.extrabold, fontSize: 13 },
    nameRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    name: { flex: 1, color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 14.5 },
    when: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 10 },
    preview: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 12, marginTop: 2 },
    badge: {
      minWidth: 18,
      height: 18,
      paddingHorizontal: 4,
      borderRadius: 9,
      backgroundColor: theme.danger,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: { color: '#fff', fontFamily: fonts.bold, fontSize: 10 },
  });
