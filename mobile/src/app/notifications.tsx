// Notifications — the feed half of the web TopBar's bell (components/TopBar.tsx):
// the rows in `notifications` for this user — a referee assignment, an event
// taken down with its refund, being removed from an event, a joining fee that
// went up. Newest first with unread leading, as on the web.
//
// A notification's link is a WEBSITE path. Where the phone has the same
// screen, tapping opens it; otherwise the tap just marks it read, since
// sending someone to a screen that doesn't exist here would be worse.
//
// The web bell also shows three computed counts (join requests, open posts,
// match dues). Those already have homes on mobile — join requests on My Team
// and Home, what you owe on Home — so only the stored feed is ported.
// The query is a copy of the TopBar's inline one; keep them in step.

import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, type Href } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';

type NotifRow = { id: string; type: string; title: string; body: string | null; link: string | null; read: boolean; created_at: string };

// Website path → the phone screen that shows the same thing, if there is one.
function mobileRouteFor(link: string | null): Href | null {
  if (!link) return null;
  if (link.startsWith('/messages/team')) return '/messages/team' as Href;
  if (link.startsWith('/messages')) return '/messages' as Href;
  const fixture = link.match(/^\/my-team\/tournament-match\/([^/?#]+)/);
  if (fixture) return { pathname: '/tournament-fixture/[fixtureId]', params: { fixtureId: fixture[1] } } as Href;
  if (link.startsWith('/my-team/settings')) return '/team-settings' as Href;
  if (link.startsWith('/my-team')) return '/my-team' as Href;
  if (link.startsWith('/profile')) return '/profile' as Href;
  if (link.startsWith('/calendar')) return '/calendar' as Href;
  if (link === '/') return '/' as Href;
  return null;
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

export default function Notifications() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { user } = useAuth();
  const [rows, setRows] = useState<NotifRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('notifications')
      .select('id, type, title, body, link, read, created_at')
      .eq('user_id', user.id)
      .order('read', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(30);
    setRows((data ?? []) as NotifRow[]);
    setLoading(false);
    setRefreshing(false);
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const open = async (n: NotifRow) => {
    if (!n.read) {
      setRows((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      await supabase.from('notifications').update({ read: true }).eq('id', n.id);
    }
    const to = mobileRouteFor(n.link);
    if (to) router.push(to);
  };

  const markAll = async () => {
    const unread = rows.filter((r) => !r.read).map((r) => r.id);
    if (unread.length === 0) return;
    setRows((prev) => prev.map((x) => ({ ...x, read: true })));
    await supabase.from('notifications').update({ read: true }).in('id', unread);
  };

  const unreadCount = rows.filter((r) => !r.read).length;

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
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
      <View style={styles.titleRow}>
        <Text style={styles.heading}>Notifications</Text>
        {unreadCount > 0 && (
          <Pressable onPress={markAll} hitSlop={8}>
            <Text style={styles.markAll}>Mark all read</Text>
          </Pressable>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={theme.accent} style={{ marginTop: 30 }} />
      ) : rows.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="notifications-outline" size={34} color={theme.textSecondary} />
          <Text style={styles.emptyTitle}>Nothing yet</Text>
          <Text style={styles.emptyBody}>Referee assignments, event updates and refunds show up here.</Text>
        </View>
      ) : (
        <View style={styles.card}>
          {rows.map((n, i) => (
            <Pressable key={n.id} onPress={() => void open(n)} style={[styles.row, i > 0 && styles.divider, !n.read && styles.unread]}>
              {!n.read && <View style={styles.dot} />}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.title, n.read && { fontFamily: fonts.medium }]}>{n.title}</Text>
                {!!n.body && <Text style={styles.body}>{n.body}</Text>}
                <Text style={styles.when}>{timeAgo(n.created_at)}</Text>
              </View>
              {mobileRouteFor(n.link) && <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />}
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.background },
    content: { padding: 20, paddingTop: 56, paddingBottom: 40, gap: 12 },
    back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
    backText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 15 },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    heading: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 24 },
    markAll: { color: theme.accentInk, fontFamily: fonts.semibold, fontSize: 13 },
    empty: { alignItems: 'center', gap: 8, paddingVertical: 40 },
    emptyTitle: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 15 },
    emptyBody: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, textAlign: 'center' },
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      overflow: 'hidden',
      ...cardShadow,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
    divider: { borderTopWidth: 1, borderTopColor: theme.border },
    unread: { backgroundColor: '#F6FBF7' },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.accent },
    title: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
    body: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 2 },
    when: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 10, marginTop: 4 },
  });
