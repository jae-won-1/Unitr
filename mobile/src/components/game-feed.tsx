// The discovery feed — what the viewer's team could join.
//
// The data is entirely shared: useOpenMatchPosts, useOpenTournaments and
// useSuggestions are the web app's own hooks, extracted into lib/game-feed.ts
// and imported here unchanged. That matters because they carry behaviour that
// would be easy to lose in a second implementation — the 42703 retry when
// supabase_admin_hosting.sql has not been run, hiding the viewer's own hosted
// events while keeping venue- and admin-hosted ones visible to teamless
// viewers, and the pending-invitation discount lookup.
//
// What this file owns is the presentation and the action each role gets:
//
//   captain / co-captain → Challenge and Enter are the real commitments, and
//     they move money (a credit hold on challenge, a buy-in on entry). Neither
//     flow is ported yet, so they are GREYED rather than shown as live buttons.
//     Offering a button that silently does nothing with a team's money would be
//     worse than saying it is not ready.
//   player → "Suggest to team", which is fully wired: it writes to
//     match_suggestions, which is exactly what the web app does, and commits
//     nothing on the team's behalf.
//   new_user → discovery only, nothing to act with.

import { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import {
  useOpenMatchPosts,
  useOpenTournaments,
  useSuggestions,
  type MatchPost,
  type Tournament,
} from '@/lib/game-feed';
import { fmtKickoff } from '@/lib/match-dates';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';

type Tab = 'all' | 'matches' | 'tournaments';

// Mirrors GAME_TYPES in components/GameFeed.tsx, minus "Fill In" — the ringer
// feed is its own component on the web and is not ported yet, so offering the
// filter would lead to a permanently empty list.
const GAME_TYPES: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All games' },
  { key: 'matches', label: 'Matches' },
  { key: 'tournaments', label: 'Tournaments' },
];

const money = (pence: number) => `£${(pence / 100).toFixed(2).replace(/\.00$/, '')}`;

export function GameFeed({
  teamId,
  userId,
  canAct,
}: {
  teamId: string | null;
  userId: string;
  /** Captain or co-captain: the roles that may commit the team. */
  canAct: boolean;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);

  const [tab, setTab] = useState<Tab>('all');
  const [menuOpen, setMenuOpen] = useState(false);

  const { posts, loading: postsLoading } = useOpenMatchPosts(teamId);
  const { tournaments, loading: tourLoading } = useOpenTournaments(teamId);
  const { suggested, unavailable, suggest } = useSuggestions(teamId, userId);

  const loading = postsLoading || tourLoading;
  const showMatches = tab === 'all' || tab === 'matches';
  const showTournaments = tab === 'all' || tab === 'tournaments';
  const current = GAME_TYPES.find((t) => t.key === tab) ?? GAME_TYPES[0];

  const empty = useMemo(
    () =>
      !loading &&
      (!showMatches || posts.length === 0) &&
      (!showTournaments || tournaments.length === 0),
    [loading, showMatches, showTournaments, posts.length, tournaments.length],
  );

  return (
    <View style={styles.wrap}>
      {/* Game-type dropdown, the same control the web feed uses. */}
      <Pressable onPress={() => setMenuOpen(true)} style={styles.typeTrigger}>
        <Text style={styles.typeTriggerText}>{current.label}</Text>
        <Ionicons name="chevron-down" size={14} color={theme.textPrimary} />
      </Pressable>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setMenuOpen(false)}>
          <View style={styles.menu}>
            {GAME_TYPES.map((t, i) => (
              <Pressable
                key={t.key}
                onPress={() => {
                  setTab(t.key);
                  setMenuOpen(false);
                }}
                style={[styles.menuItem, i > 0 && { borderTopWidth: 1, borderTopColor: theme.border }]}>
                <Text style={[styles.menuItemText, t.key === tab && styles.menuItemTextOn]}>
                  {t.label}
                </Text>
                {t.key === tab && <Ionicons name="checkmark" size={16} color={theme.accentInk} />}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {loading && (
        <View style={styles.card}>
          <ActivityIndicator color={theme.accent} />
        </View>
      )}

      {empty && (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>Nothing open right now</Text>
          <Text style={styles.muted}>
            Games other teams post will show up here. Check back, or post one of your own on
            the web app.
          </Text>
        </View>
      )}

      {showMatches &&
        posts.map((p) => (
          <MatchCard
            key={p.id}
            post={p}
            theme={theme}
            styles={styles}
            teamId={teamId}
            canAct={canAct}
            suggested={suggested.has(p.id)}
            suggestUnavailable={unavailable}
            onSuggest={() => suggest(p.id, 'match')}
          />
        ))}

      {showTournaments &&
        tournaments.map((t) => (
          <TournamentCard
            key={t.id}
            t={t}
            theme={theme}
            styles={styles}
            teamId={teamId}
            canAct={canAct}
            suggested={suggested.has(t.id)}
            suggestUnavailable={unavailable}
            onSuggest={() => suggest(t.id, 'tournament')}
          />
        ))}
    </View>
  );
}

// The action block, shared by both card types so the two never disagree about
// what a given role is offered.
function Actions({
  teamId,
  canAct,
  suggested,
  suggestUnavailable,
  onSuggest,
  commitLabel,
  styles,
}: {
  teamId: string | null;
  canAct: boolean;
  suggested: boolean;
  suggestUnavailable: boolean;
  onSuggest: () => void;
  /** "Challenge" for a match, "Enter" for a tournament. */
  commitLabel: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  if (!teamId) return null;

  if (canAct) {
    // Greyed, not hidden — and deliberately not wired. Both flows move money
    // (a credit hold, a buy-in) and neither is ported yet.
    return (
      <View style={styles.actionRow}>
        <View style={[styles.commitBtn, styles.commitBtnOff]}>
          <Text style={styles.commitBtnOffText}>{commitLabel}</Text>
        </View>
        <Text style={styles.actionNote}>On the web app until Phase 3</Text>
      </View>
    );
  }

  if (suggestUnavailable) {
    return <Text style={styles.actionNote}>Suggestions unavailable on this database.</Text>;
  }

  return (
    <Pressable
      onPress={suggested ? undefined : onSuggest}
      disabled={suggested}
      style={({ pressed }) => [
        styles.suggestBtn,
        suggested && styles.suggestBtnDone,
        pressed && !suggested && { opacity: 0.8 },
      ]}>
      <Ionicons
        name={suggested ? 'checkmark' : 'arrow-up-circle-outline'}
        size={15}
        color={suggested ? '#0E7A3C' : '#fff'}
      />
      <Text style={[styles.suggestBtnText, suggested && styles.suggestBtnDoneText]}>
        {suggested ? 'Suggested' : 'Suggest to team'}
      </Text>
    </Pressable>
  );
}

function MatchCard({
  post,
  theme,
  styles,
  teamId,
  canAct,
  suggested,
  suggestUnavailable,
  onSuggest,
}: {
  post: MatchPost;
  theme: ReturnType<typeof useTheme>;
  styles: ReturnType<typeof makeStyles>;
  teamId: string | null;
  canAct: boolean;
  suggested: boolean;
  suggestUnavailable: boolean;
  onSuggest: () => void;
}) {
  // Posts carry several pitch options; the cheapest is what the card quotes,
  // since the challenging captain picks which one at challenge time.
  const cheapest = post.pitchOptions.length
    ? Math.min(...post.pitchOptions.map((p) => p.price))
    : null;

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={[styles.kindBadge, { backgroundColor: '#E7F8EC', borderColor: '#B7E8C6' }]}>
          <Text style={[styles.kindBadgeText, { color: '#0E7A3C' }]}>Match</Text>
        </View>
        {post.pitchSecured && (
          <View style={styles.securedBadge}>
            <Ionicons name="lock-closed" size={10} color={theme.accent2} />
            <Text style={styles.securedText}>Pitch secured</Text>
          </View>
        )}
      </View>

      <Text style={styles.cardTitle}>{post.team}</Text>
      {!!post.location && <Text style={styles.cardSub}>{post.location}</Text>}

      <View style={styles.metaRow}>
        <Ionicons name="time-outline" size={14} color={theme.textSecondary} />
        <Text style={styles.metaText}>{fmtKickoff(post.match_date, post.match_time)}</Text>
      </View>
      {post.pitchOptions.length > 0 && (
        <View style={styles.metaRow}>
          <Ionicons name="location-outline" size={14} color={theme.textSecondary} />
          <Text style={styles.metaText} numberOfLines={1}>
            {post.pitchOptions.length === 1
              ? post.pitchOptions[0].name
              : `${post.pitchOptions.length} pitch options`}
          </Text>
        </View>
      )}

      {!!post.description && (
        <Text style={styles.description} numberOfLines={3}>
          {post.description}
        </Text>
      )}

      <View style={styles.cardFoot}>
        {cheapest != null && <Text style={styles.price}>{money(cheapest)}</Text>}
        <Actions
          teamId={teamId}
          canAct={canAct}
          suggested={suggested}
          suggestUnavailable={suggestUnavailable}
          onSuggest={onSuggest}
          commitLabel="Challenge"
          styles={styles}
        />
      </View>
    </View>
  );
}

function TournamentCard({
  t,
  theme,
  styles,
  teamId,
  canAct,
  suggested,
  suggestUnavailable,
  onSuggest,
}: {
  t: Tournament;
  theme: ReturnType<typeof useTheme>;
  styles: ReturnType<typeof makeStyles>;
  teamId: string | null;
  canAct: boolean;
  suggested: boolean;
  suggestUnavailable: boolean;
  onSuggest: () => void;
}) {
  const entered = !!teamId && t.joinedTeamIds.includes(teamId);
  const full = t.joinedCount >= t.maxTeams;
  const organiser = t.organiserAdminName ?? t.organiserTeamName;
  const net = Math.max(0, t.pricePerTeamPence - t.inviteDiscountPence);

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={[styles.kindBadge, { backgroundColor: '#FFF6E3', borderColor: '#F5DCA6' }]}>
          <Text style={[styles.kindBadgeText, { color: '#B07400' }]}>
            {t.matchType === 'league' ? 'League' : t.matchType === 'match' ? 'Event' : 'Tournament'}
          </Text>
        </View>
        {entered && (
          <View style={styles.enteredBadge}>
            <Ionicons name="checkmark-circle" size={11} color={theme.accentInk} />
            <Text style={styles.enteredText}>Entered</Text>
          </View>
        )}
      </View>

      <Text style={styles.cardTitle}>{t.title}</Text>
      {organiser && <Text style={styles.cardSub}>by {organiser}</Text>}

      <View style={styles.metaRow}>
        <Ionicons name="time-outline" size={14} color={theme.textSecondary} />
        <Text style={styles.metaText}>{fmtKickoff(t.matchDate, t.startTime)}</Text>
      </View>
      <View style={styles.metaRow}>
        <Ionicons name="location-outline" size={14} color={theme.textSecondary} />
        <Text style={styles.metaText} numberOfLines={1}>{t.pitchName}</Text>
      </View>
      <View style={styles.metaRow}>
        <Ionicons name="people-outline" size={14} color={theme.textSecondary} />
        <Text style={styles.metaText}>
          {t.joinedCount} / {t.maxTeams} teams{full && !entered ? ' · full' : ''}
        </Text>
      </View>

      <View style={styles.cardFoot}>
        <View>
          <Text style={styles.price}>{net === 0 ? 'Free' : money(net)}</Text>
          {t.inviteDiscountPence > 0 && (
            <Text style={styles.discount}>
              {money(t.pricePerTeamPence)} — invite discount applied
            </Text>
          )}
        </View>
        {!entered && !full && (
          <Actions
            teamId={teamId}
            canAct={canAct}
            suggested={suggested}
            suggestUnavailable={suggestUnavailable}
            onSuggest={onSuggest}
            commitLabel="Enter"
            styles={styles}
          />
        )}
      </View>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    wrap: { gap: 12 },
    typeTrigger: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderRadius: radius.btn,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      paddingHorizontal: 16,
      paddingVertical: 10,
      marginBottom: 2,
    },
    typeTriggerText: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
    scrim: { flex: 1, backgroundColor: theme.scrim, paddingTop: 300, paddingHorizontal: 20 },
    menu: {
      alignSelf: 'flex-start',
      minWidth: 200,
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      overflow: 'hidden',
    },
    menuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      paddingHorizontal: 16,
      paddingVertical: 13,
    },
    menuItemText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 14 },
    menuItemTextOn: { color: theme.accentInk, fontFamily: fonts.bold },

    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      padding: 15,
      ...cardShadow,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
    kindBadge: { borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 3 },
    kindBadgeText: { fontFamily: fonts.semibold, fontSize: 11 },
    securedBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: '#EAF0FF',
      borderColor: '#C6D4FF',
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    securedText: { color: theme.accent2, fontFamily: fonts.semibold, fontSize: 10 },
    enteredBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: theme.successBg,
      borderColor: theme.successBorder,
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    enteredText: { color: theme.accentInk, fontFamily: fonts.semibold, fontSize: 10 },
    cardTitle: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 16 },
    cardSub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, marginTop: 1 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
    metaText: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 13, flexShrink: 1 },
    description: {
      color: theme.textSecondary,
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 19,
      marginTop: 9,
    },
    cardFoot: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      marginTop: 13,
      paddingTop: 13,
      borderTopWidth: 1,
      borderTopColor: theme.border,
    },
    price: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 17 },
    discount: { color: theme.accentInk, fontFamily: fonts.medium, fontSize: 11, marginTop: 1 },
    actionRow: { alignItems: 'flex-end', gap: 3 },
    commitBtn: { borderRadius: radius.btn, paddingHorizontal: 18, paddingVertical: 10 },
    commitBtnOff: { backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border },
    commitBtnOffText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 14 },
    actionNote: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 10 },
    suggestBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: theme.accent,
      borderRadius: radius.btn,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    suggestBtnDone: {
      backgroundColor: theme.successBg,
      borderWidth: 1,
      borderColor: theme.successBorder,
    },
    suggestBtnText: { color: '#fff', fontFamily: fonts.semibold, fontSize: 13 },
    suggestBtnDoneText: { color: theme.accentInk },
    emptyTitle: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14, marginBottom: 4 },
    muted: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  });
