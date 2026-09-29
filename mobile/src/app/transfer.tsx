// Transfer Market — the mobile port of app/my-team/transfer/page.tsx.
//
// Two-sided discovery on one screen: players find teams, captains find players.
// All of the data — the search, the viewer's relationship to every row, the
// inbox, and every action (friend request, offer, accept, ask to join) — is the
// shared lib/transfer-market.ts, so a card here can never offer something the
// web card wouldn't, or invite you to send something twice.
//
// Differences from the web, all platform ones: "View profile" opens the player
// sheet (which can start a conversation) instead of a profile page; there's no
// "View team" (no team page on the phone yet); and accepting a team's offer
// refreshes the session, because joining a squad changes your role and
// RoleContext only looks again when the user object changes.

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  acceptOffer,
  askToJoin,
  declineOffer,
  loadEdges,
  loadInbox,
  loadViewer,
  respondToFriendRequest,
  searchPlayers,
  searchTeams,
  sendFriendRequest,
  sendOffer,
  type InboxFriend,
  type InboxOffer,
  type MarketEdges,
  type MarketPlayer,
  type MarketTeam,
  type Viewer,
} from '@/lib/transfer-market';
import { playsPosition, positionLabel } from '@/lib/profile-options';
import { teamFormatLabel } from '@/lib/team-options';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';
import { initialsOf } from '~/components/chat';
import { PlayerSheet } from '~/components/player-sheet';

const POSITIONS = ['All', 'GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'RW', 'LW', 'ST'];
const EXPERIENCES = ['All', 'Casual', 'Semi-Pro'];
const NO_EDGES: MarketEdges = { friends: new Map(), offers: new Map(), joins: new Map() };

export default function TransferMarket() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { user } = useAuth();
  const [tab, setTab] = useState<'players' | 'teams'>('players');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [pos, setPos] = useState('All');
  const [exp, setExp] = useState('All');
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [players, setPlayers] = useState<MarketPlayer[]>([]);
  const [teams, setTeams] = useState<MarketTeam[]>([]);
  const [edges, setEdges] = useState<MarketEdges>(NO_EDGES);
  const [inbox, setInbox] = useState<{ offers: InboxOffer[]; friends: InboxFriend[] }>({ offers: [], friends: [] });
  const [inboxOpen, setInboxOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!user) return;
    void loadViewer(user.id).then(setViewer);
  }, [user]);

  // Relationships and the inbox move together — accepting an offer changes
  // both — so one refresh keeps every card honest.
  const refresh = useCallback(async () => {
    if (!user || !viewer) return;
    const [e, i] = await Promise.all([loadEdges(viewer), loadInbox(user.id)]);
    setEdges(e);
    setInbox(i);
  }, [user, viewer]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const run =
      tab === 'players'
        ? searchPlayers(debounced, user?.id).then((r) => !cancelled && setPlayers(r))
        : searchTeams(debounced).then((r) => !cancelled && setTeams(r));
    void run.finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tab, debounced, user?.id]);

  const visiblePlayers = players.filter(
    (p) => (pos === 'All' || playsPosition(p, pos)) && (exp === 'All' || p.experience === exp),
  );
  const pending = inbox.offers.length + inbox.friends.length;
  const count = tab === 'players' ? visiblePlayers.length : teams.length;

  const afterInboxAction = async () => {
    await refresh();
    if (user) setViewer(await loadViewer(user.id));
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.headRow}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={24} color={theme.textPrimary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.heading}>Transfer Market</Text>
            <Text style={styles.small}>Find players and teams</Text>
          </View>
          <Pressable onPress={() => setInboxOpen(true)} style={styles.inboxBtn} accessibilityLabel="Your inbox">
            <Ionicons name="mail-outline" size={19} color={theme.textSecondary} />
            {pending > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{pending}</Text>
              </View>
            )}
          </Pressable>
        </View>

        <View style={styles.search}>
          <Ionicons name="search" size={16} color={theme.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={tab === 'players' ? 'Search players by name…' : 'Search teams by name…'}
            placeholderTextColor={theme.textSecondary}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {loading && <ActivityIndicator size="small" color={theme.accent} />}
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['players', 'teams'] as const).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} style={[styles.toggle, tab === t && styles.toggleOn]}>
              <Text style={[styles.toggleText, tab === t && styles.toggleTextOn]}>{t === 'players' ? 'Players' : 'Teams'}</Text>
            </Pressable>
          ))}
        </View>

        {tab === 'players' && (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {POSITIONS.map((p) => (
                <Chip key={p} label={p} on={pos === p} onPress={() => setPos(p)} styles={styles} />
              ))}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {EXPERIENCES.map((e) => (
                <Chip key={e} label={e} on={exp === e} onPress={() => setExp(e)} styles={styles} />
              ))}
            </ScrollView>
          </>
        )}

        <Text style={styles.small}>
          {loading ? 'Searching…' : `${count} ${tab === 'players' ? 'player' : 'team'}${count === 1 ? '' : 's'} found`}
        </Text>

        {!loading && count === 0 && (
          <View style={styles.card}>
            <Text style={[styles.small, { textAlign: 'center' }]}>
              {debounced.trim() ? `No ${tab} match “${debounced.trim()}”.` : `No ${tab} on Uniter yet.`}
            </Text>
          </View>
        )}

        {tab === 'players'
          ? visiblePlayers.map((p) => (
              <PlayerCard key={p.id} player={p} edges={edges} viewer={viewer} onChanged={refresh} onView={() => setViewing(p.id)} styles={styles} />
            ))
          : teams.map((t) => <TeamCard key={t.id} team={t} edges={edges} viewer={viewer} onChanged={refresh} styles={styles} />)}
      </ScrollView>

      {user && (
        <InboxSheet
          visible={inboxOpen}
          offers={inbox.offers}
          friends={inbox.friends}
          userId={user.id}
          onClose={() => setInboxOpen(false)}
          onChanged={afterInboxAction}
          styles={styles}
          theme={theme}
        />
      )}
      <PlayerSheet playerId={viewing} viewerId={user?.id} onClose={() => setViewing(null)} />
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function Chip({ label, on, onPress, styles }: { label: string; on: boolean; onPress: () => void; styles: Styles }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Btn({ label, onPress, busy, kind = 'primary', disabled, styles }: { label: string; onPress?: () => void; busy?: boolean; kind?: 'primary' | 'outline' | 'muted' | 'done'; disabled?: boolean; styles: Styles }) {
  const style = kind === 'primary' ? styles.btnPrimary : kind === 'outline' ? styles.btnOutline : kind === 'done' ? styles.btnDone : styles.btnMuted;
  const text = kind === 'primary' ? styles.btnPrimaryText : kind === 'outline' ? styles.btnOutlineText : kind === 'done' ? styles.btnDoneText : styles.btnMutedText;
  return (
    <Pressable onPress={onPress} disabled={!onPress || busy || disabled} style={[styles.btn, style, (busy || disabled) && { opacity: 0.5 }]}>
      {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={text}>{label}</Text>}
    </Pressable>
  );
}

function PlayerCard({
  player,
  edges,
  viewer,
  onChanged,
  onView,
  styles,
}: {
  player: MarketPlayer;
  edges: MarketEdges;
  viewer: Viewer | null;
  onChanged: () => Promise<void>;
  onView: () => void;
  styles: Styles;
}) {
  const [busy, setBusy] = useState(false);
  const friend = edges.friends.get(player.id) ?? 'none';
  const offer = edges.offers.get(player.id) ?? 'none';
  // Only a free agent can be signed — someone in a squad has to leave it first.
  const canOffer = !!viewer?.captainTeamId && !player.teamName;
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await fn();
    await onChanged();
    setBusy(false);
  };
  const meta = [positionLabel(player), player.location, player.experience].filter(Boolean).join(' · ');

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initialsOf(player.full_name)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name} numberOfLines={1}>{player.full_name}</Text>
          <Text style={styles.small} numberOfLines={1}>{meta || 'No info set'}</Text>
        </View>
        <View style={[styles.tag, !player.teamName && styles.tagFree]}>
          <Text style={[styles.tagText, !player.teamName && styles.tagFreeText]} numberOfLines={1}>
            {player.teamName ?? 'Free agent'}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Btn label="View profile" kind="muted" onPress={onView} styles={styles} />
        {friend === 'friends' ? (
          <Btn label="Friends ✓" kind="done" styles={styles} />
        ) : friend === 'sent' ? (
          <Btn label="Request sent" kind="muted" styles={styles} />
        ) : friend === 'incoming' ? (
          <Btn label="Accept friend" busy={busy} onPress={() => viewer && run(() => respondToFriendRequest(player.id, viewer.userId, true))} styles={styles} />
        ) : (
          <Btn label="Add friend" kind="outline" busy={busy} disabled={!viewer} onPress={() => viewer && run(() => sendFriendRequest(viewer.userId, player.id))} styles={styles} />
        )}
      </View>
      {canOffer && (
        <Btn
          label={offer === 'pending' ? 'Offer sent' : offer === 'accepted' ? 'Offer accepted' : offer === 'declined' ? 'Offer declined · send again' : 'Send offer to join'}
          kind={offer === 'none' || offer === 'declined' ? 'primary' : 'muted'}
          busy={busy}
          disabled={offer === 'pending' || offer === 'accepted'}
          onPress={() => viewer?.captainTeamId && run(() => sendOffer(viewer.captainTeamId!, viewer.userId, player.id, null))}
          styles={styles}
        />
      )}
    </View>
  );
}

function TeamCard({
  team,
  edges,
  viewer,
  onChanged,
  styles,
}: {
  team: MarketTeam;
  edges: MarketEdges;
  viewer: Viewer | null;
  onChanged: () => Promise<void>;
  styles: Styles;
}) {
  const [busy, setBusy] = useState(false);
  const join = edges.joins.get(team.id) ?? 'none';
  // One team at a time: being in any squad blocks asking to join another.
  const elsewhere = !!viewer?.myTeamId && viewer.myTeamId !== team.id;
  const meta = [team.location, teamFormatLabel(team), team.level, `${team.members} member${team.members === 1 ? '' : 's'}`]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={[styles.avatar, styles.avatarMuted]}>
          <Text style={[styles.avatarText, { color: '#5A6478' }]}>{initialsOf(team.name)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name} numberOfLines={1}>{team.name}</Text>
          <Text style={styles.small} numberOfLines={2}>{meta}</Text>
        </View>
      </View>
      {join === 'captain' ? (
        <Btn label="Your team" kind="muted" styles={styles} />
      ) : join === 'member' ? (
        <Btn label="You're in ✓" kind="done" styles={styles} />
      ) : join === 'pending' ? (
        <Btn label="Request pending" kind="muted" styles={styles} />
      ) : (
        <Btn
          label={elsewhere ? 'Leave your current team first' : 'Ask to join'}
          busy={busy}
          disabled={!viewer || elsewhere}
          onPress={async () => {
            if (!viewer) return;
            setBusy(true);
            await askToJoin(team.id, viewer.userId);
            await onChanged();
            setBusy(false);
          }}
          styles={styles}
        />
      )}
    </View>
  );
}

function InboxSheet({
  visible,
  offers,
  friends,
  userId,
  onClose,
  onChanged,
  styles,
  theme,
}: {
  visible: boolean;
  offers: InboxOffer[];
  friends: InboxFriend[];
  userId: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
  styles: Styles;
  theme: ReturnType<typeof useTheme>;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, joinedATeam = false) => {
    setBusy(true);
    await fn();
    // Accepting an offer puts you in a squad — a role change RoleContext only
    // notices when the user object changes.
    if (joinedATeam) await supabase.auth.refreshSession();
    await onChanged();
    setBusy(false);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.sheetHead}>
            <Text style={styles.name}>Your inbox</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={theme.textSecondary} />
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: 10 }}>
            {offers.length === 0 && friends.length === 0 && <Text style={[styles.small, { textAlign: 'center', paddingVertical: 16 }]}>Nothing waiting on you.</Text>}
            {offers.length > 0 && <Text style={styles.section}>Team offers</Text>}
            {offers.map((o) => (
              <View key={o.id} style={styles.inboxItem}>
                <Text style={styles.name}>{o.teamName}</Text>
                <Text style={styles.small}>{o.message ?? 'wants you to join their squad.'}</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <Btn label="Decline" kind="muted" busy={busy} onPress={() => run(() => declineOffer(o.id))} styles={styles} />
                  <Btn label="Accept & join" busy={busy} onPress={() => run(() => acceptOffer(o.id, o.teamId, userId), true)} styles={styles} />
                </View>
              </View>
            ))}
            {friends.length > 0 && <Text style={styles.section}>Friend requests</Text>}
            {friends.map((f) => (
              <View key={f.fromId} style={styles.inboxItem}>
                <Text style={styles.name}>{f.name}</Text>
                <Text style={styles.small}>{[f.position, f.location].filter(Boolean).join(' · ') || 'Player'}</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <Btn label="Ignore" kind="muted" busy={busy} onPress={() => run(() => respondToFriendRequest(f.fromId, userId, false))} styles={styles} />
                  <Btn label="Accept" busy={busy} onPress={() => run(() => respondToFriendRequest(f.fromId, userId, true))} styles={styles} />
                </View>
              </View>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.background },
    content: { padding: 20, paddingTop: 56, paddingBottom: 48, gap: 12 },
    headRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    heading: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 22 },
    small: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
    section: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 },
    inboxBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badge: {
      position: 'absolute',
      top: -4,
      right: -4,
      minWidth: 18,
      height: 18,
      paddingHorizontal: 4,
      borderRadius: 9,
      backgroundColor: theme.danger,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: { color: '#fff', fontFamily: fonts.bold, fontSize: 10 },
    search: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      borderRadius: radius.btn,
      paddingHorizontal: 12,
    },
    searchInput: { flex: 1, paddingVertical: 11, color: theme.textPrimary, fontFamily: fonts.regular, fontSize: 14 },
    toggle: { flex: 1, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface2, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
    toggleOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    toggleText: { color: theme.textSecondary, fontFamily: fonts.bold, fontSize: 13 },
    toggleTextOn: { color: '#fff' },
    chip: { borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface2, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
    chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    chipText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 12 },
    chipTextOn: { color: '#fff' },
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      padding: 14,
      gap: 10,
      ...cardShadow,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: theme.successBg,
      borderWidth: 1,
      borderColor: theme.successBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarMuted: { backgroundColor: theme.surface, borderColor: theme.border },
    avatarText: { color: theme.accentInk, fontFamily: fonts.bold, fontSize: 13 },
    name: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
    tag: { maxWidth: 110, borderWidth: 1, borderColor: theme.border, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
    tagFree: { backgroundColor: theme.successBg, borderColor: theme.successBorder },
    tagText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 10 },
    tagFreeText: { color: theme.accentInk },
    btn: { flex: 1, borderRadius: 12, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
    btnPrimary: { backgroundColor: theme.accent },
    btnPrimaryText: { color: '#fff', fontFamily: fonts.bold, fontSize: 13 },
    btnOutline: { borderWidth: 1, borderColor: theme.accent },
    btnOutlineText: { color: theme.accentInk, fontFamily: fonts.bold, fontSize: 13 },
    btnMuted: { borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface },
    btnMutedText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 13 },
    btnDone: { backgroundColor: theme.successBg, borderWidth: 1, borderColor: theme.successBorder },
    btnDoneText: { color: theme.accentInk, fontFamily: fonts.bold, fontSize: 13 },
    scrim: { flex: 1, backgroundColor: theme.scrim, justifyContent: 'flex-end' },
    sheet: { backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 34, gap: 10 },
    sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    inboxItem: { borderWidth: 1, borderColor: theme.border, borderRadius: radius.btn, padding: 12 },
  });
