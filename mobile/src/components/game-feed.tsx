// The discovery feed — what the viewer's team could join, plus Fill In: guest
// spots anyone signed in can take, team or no team.
//
// The data is entirely shared: useOpenMatchPosts, useOpenTournaments,
// useSuggestions and useRingerPosts are the web app's own hooks, extracted
// into lib/game-feed.ts and lib/ringer-feed.ts and imported here unchanged.
// That matters because they carry behaviour that would be easy to lose in a
// second implementation — the 42703 retry when supabase_admin_hosting.sql has
// not been run, hiding the viewer's own hosted events while keeping venue-
// and admin-hosted ones visible to teamless viewers, the pending-invitation
// discount lookup, and Fill In excluding the viewer's own team's requests.
//
// What this file owns is the presentation and the action each role gets:
//
//   captain / co-captain → Enter is live: it opens enter-tournament-sheet.tsx
//     (the same /api/tournaments/join the web calls, with any shortfall paid
//     as a named amount towards the buy-in). Challenge stays GREYED until the
//     friendly flow is ported — it places a hold on the team's money and picks
//     a pitch, and a button that silently did nothing with that would be worse
//     than saying it isn't ready.
//   player → "Suggest to team", which is fully wired: it writes to
//     match_suggestions, which is exactly what the web app does, and commits
//     nothing on the team's behalf.
//   new_user → discovery only, nothing to act with.
//   anyone, on a Fill In card → "Join for £x" is wired end to end: the same
//     /api/ringer/create-intent + /api/ringer/join pair the web app calls,
//     confirmed here with Stripe's PaymentSheet instead of the Payment
//     Element. PaymentSheet (not a raw CardField + confirmPayment) because it
//     drives 3D Secure natively without this app re-solving the two mobile
//     3DS bugs lib/confirm-payment.ts exists for on the web — see
//     joinRingerSpot below for the corresponding PaymentIntent-id recovery.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStripe } from '@stripe/stripe-react-native';
import { router } from 'expo-router';

import {
  useOpenMatchPosts,
  useOpenTournaments,
  useSuggestions,
  type MatchPost,
  type Tournament,
} from '@/lib/game-feed';
import { useRingerPosts, fmtRingerDate, type RingerPost } from '@/lib/ringer-feed';
import { authedPost } from '@/lib/authed-fetch';
import { fmtKickoff } from '@/lib/match-dates';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';
import { paymentIntentIdFrom } from '~/payments';
import { EnterTournamentSheet } from '~/components/enter-tournament-sheet';
import { supabase } from '@/lib/supabase';

type Tab = 'all' | 'matches' | 'tournaments' | 'ringer';

// Mirrors GAME_TYPES in components/GameFeed.tsx.
const GAME_TYPES: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All games' },
  { key: 'matches', label: 'Matches' },
  { key: 'tournaments', label: 'Tournaments' },
  { key: 'ringer', label: 'Fill In' },
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
  const { tournaments, loading: tourLoading, markJoined } = useOpenTournaments(teamId);
  const [entering, setEntering] = useState<Tournament | null>(null);
  // The join route records the team's name on the entry, as the web passes it.
  const [teamName, setTeamName] = useState<string | null>(null);
  useEffect(() => {
    if (!canAct || !teamId) return;
    void supabase
      .from('teams')
      .select('name')
      .eq('id', teamId)
      .maybeSingle()
      .then(({ data }) => setTeamName((data as { name?: string } | null)?.name ?? null));
  }, [canAct, teamId]);
  const { suggested, unavailable, suggest } = useSuggestions(teamId, userId);
  const {
    posts: ringers,
    loading: ringerLoading,
    unavailable: ringerUnavailable,
    reload: reloadRingers,
  } = useRingerPosts(userId);
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [joiningId, setJoiningId] = useState<string | null>(null);

  // Mirrors RingerFeed.tsx's startJoin/confirmJoin on the web, with
  // PaymentSheet standing in for Stripe Elements. There is no signed-out case
  // to gate here — Gate in app/_layout.tsx never lets a signed-out session
  // reach a tab screen at all.
  const joinRingerSpot = useCallback(
    async (post: RingerPost) => {
      setJoiningId(post.id);
      try {
        const startRes = await authedPost('/api/ringer/create-intent', { requestId: post.id });
        const startData = await startRes.json();
        if (!startData.clientSecret) {
          Alert.alert('Could not start payment', startData.error ?? 'Try again in a moment.');
          return;
        }
        const clientSecret: string = startData.clientSecret;

        const init = await initPaymentSheet({
          merchantDisplayName: 'Uniter',
          paymentIntentClientSecret: clientSecret,
        });
        if (init.error) {
          Alert.alert('Could not start payment', init.error.message);
          return;
        }

        const present = await presentPaymentSheet();
        if (present.error) {
          // The sheet's own Cancel button surfaces as an error here too —
          // silently backing out of a payment isn't a failure worth an alert.
          if (present.error.code !== 'Canceled') {
            Alert.alert('Payment failed', present.error.message);
          }
          return;
        }

        // The charge succeeded on Stripe's side at this point. Recording the
        // signup can still fail (network, a spot taken in the meantime), and
        // that failure is reported plainly rather than inviting a re-pay —
        // same reasoning as the web app's confirmJoin.
        const joinRes = await authedPost('/api/ringer/join', {
          requestId: post.id,
          paymentIntentId: paymentIntentIdFrom(clientSecret),
        });
        const joinData = await joinRes.json();
        if (!joinData.ok) {
          Alert.alert(
            "You've been charged",
            joinData.error ?? "Contact the team before paying again — we couldn't confirm your spot.",
          );
          return;
        }

        await reloadRingers();
        Alert.alert("You're in", `You're in the matchday squad for ${post.teamName}.`);
      } catch {
        Alert.alert('Something went wrong', "Couldn't reach the payment service. Please try again.");
      } finally {
        setJoiningId(null);
      }
    },
    [initPaymentSheet, presentPaymentSheet, reloadRingers],
  );

  const loading = postsLoading || tourLoading || ringerLoading;
  const showMatches = tab === 'all' || tab === 'matches';
  const showTournaments = tab === 'all' || tab === 'tournaments';
  const showRingers = tab === 'all' || tab === 'ringer';
  const current = GAME_TYPES.find((t) => t.key === tab) ?? GAME_TYPES[0];

  // The ringer-only tab gets its own "not set up" message instead of this one
  // when the migration is missing, so this excludes that case rather than
  // showing both.
  const empty = useMemo(
    () =>
      !loading &&
      !(tab === 'ringer' && ringerUnavailable) &&
      (!showMatches || posts.length === 0) &&
      (!showTournaments || tournaments.length === 0) &&
      (!showRingers || ringers.length === 0),
    [loading, tab, ringerUnavailable, showMatches, showTournaments, showRingers, posts.length, tournaments.length, ringers.length],
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
            onEnter={() => setEntering(t)}
          />
        ))}

      {entering && teamId && (
        <EnterTournamentSheet
          tournament={entering}
          teamId={teamId}
          teamName={teamName}
          userId={userId}
          onClose={() => setEntering(null)}
          onEntered={() => markJoined(entering.id, teamId)}
        />
      )}

      {showRingers && tab === 'ringer' && ringerUnavailable && (
        <View style={styles.card}>
          <Text style={styles.muted}>Fill In isn&apos;t set up on this database yet.</Text>
        </View>
      )}

      {showRingers &&
        ringers.map((r) => (
          <RingerCard
            key={r.id}
            post={r}
            theme={theme}
            styles={styles}
            joining={joiningId === r.id}
            onJoin={() => joinRingerSpot(r)}
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
  onCommit,
  styles,
}: {
  teamId: string | null;
  canAct: boolean;
  suggested: boolean;
  suggestUnavailable: boolean;
  onSuggest: () => void;
  /** "Challenge" for a match, "Enter" for a tournament. */
  commitLabel: string;
  /** Present when the commit flow is ported; absent keeps it greyed. */
  onCommit?: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  if (!teamId) return null;

  if (canAct && onCommit) {
    return (
      <Pressable onPress={onCommit} style={({ pressed }) => [styles.commitBtn, styles.commitBtnOn, pressed && { opacity: 0.85 }]}>
        <Text style={styles.commitBtnOnText}>{commitLabel}</Text>
      </Pressable>
    );
  }

  if (canAct) {
    // Greyed, not hidden — Challenge places a hold on the team's money and
    // picks a pitch, and that flow isn't ported yet.
    return (
      <View style={styles.actionRow}>
        <View style={[styles.commitBtn, styles.commitBtnOff]}>
          <Text style={styles.commitBtnOffText}>{commitLabel}</Text>
        </View>
        <Text style={styles.actionNote}>On the web app for now</Text>
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
  onEnter,
}: {
  t: Tournament;
  theme: ReturnType<typeof useTheme>;
  styles: ReturnType<typeof makeStyles>;
  teamId: string | null;
  canAct: boolean;
  suggested: boolean;
  suggestUnavailable: boolean;
  onSuggest: () => void;
  onEnter: () => void;
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

      <Pressable onPress={() => router.push({ pathname: '/tournament/[id]', params: { id: t.id } })} hitSlop={6}>
        <Text style={styles.cardTitle}>{t.title}</Text>
        <Text style={styles.cardSub}>
          {organiser ? `by ${organiser} · ` : ''}
          <Text style={{ color: theme.accentInk }}>Details</Text>
        </Text>
      </Pressable>

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
            onCommit={onEnter}
            styles={styles}
          />
        )}
      </View>
    </View>
  );
}

// A one-off guest spot. No team involved on either side of this card — the
// squad only appears in "vs", and joining is a personal card payment, not a
// team commitment, so there is no Suggest-to-team fallback: every signed-in
// viewer gets the same (greyed) Join button.
function RingerCard({
  post,
  theme,
  styles,
  joining,
  onJoin,
}: {
  post: RingerPost;
  theme: ReturnType<typeof useTheme>;
  styles: ReturnType<typeof makeStyles>;
  joining: boolean;
  onJoin: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={[styles.kindBadge, { backgroundColor: '#EAF0FF', borderColor: '#C6D4FF' }]}>
          <Text style={[styles.kindBadgeText, { color: theme.accent2 }]}>Fill In</Text>
        </View>
        {post.joined && (
          <View style={styles.enteredBadge}>
            <Ionicons name="checkmark-circle" size={11} color={theme.accentInk} />
            <Text style={styles.enteredText}>You&apos;re in</Text>
          </View>
        )}
      </View>

      <Text style={styles.cardTitle}>{post.teamName}</Text>
      <Text style={styles.cardSub}>vs {post.opponentName}</Text>

      <View style={styles.metaRow}>
        <Ionicons name="time-outline" size={14} color={theme.textSecondary} />
        <Text style={styles.metaText}>
          {fmtRingerDate(post.date)} · {post.time}
        </Text>
      </View>
      <View style={styles.metaRow}>
        <Ionicons name="location-outline" size={14} color={theme.textSecondary} />
        <Text style={styles.metaText} numberOfLines={1}>{post.pitch}</Text>
      </View>
      <View style={styles.metaRow}>
        <Ionicons name="people-outline" size={14} color={theme.textSecondary} />
        <Text style={styles.metaText}>
          {post.positions.length === 0 ? 'Any position' : post.positions.join(', ')} ·{' '}
          {post.spotsLeft} spot{post.spotsLeft === 1 ? '' : 's'} left
        </Text>
      </View>

      {!!post.notes && (
        <Text style={styles.description} numberOfLines={2}>
          {post.notes}
        </Text>
      )}

      <View style={styles.cardFoot}>
        <Text style={styles.price}>{money(post.pricePence)}</Text>
        {post.joined ? (
          <Text style={styles.actionNote}>You&apos;re in the squad</Text>
        ) : (
          <Pressable
            onPress={joining ? undefined : onJoin}
            disabled={joining}
            style={({ pressed }) => [
              styles.commitBtn,
              styles.joinBtn,
              (pressed || joining) && { opacity: 0.8 },
            ]}>
            {joining ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.joinBtnText}>Join for {money(post.pricePence)}</Text>
            )}
          </Pressable>
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
    commitBtnOn: { backgroundColor: theme.accent },
    commitBtnOnText: { color: '#fff', fontFamily: fonts.bold, fontSize: 14 },
    commitBtnOff: { backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border },
    commitBtnOffText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 14 },
    joinBtn: { backgroundColor: theme.accent, minWidth: 84, alignItems: 'center' },
    joinBtnText: { color: '#fff', fontFamily: fonts.bold, fontSize: 14 },
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
