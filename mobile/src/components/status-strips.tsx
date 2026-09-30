// The strips above the next fixture on Home: what needs the viewer's attention.
//
// Role decides which appear, matching the web Home:
//   new_user  → whether a join request they sent is still waiting
//   player    → games the captain still needs an answer on
//   captain   → the same availability list (a captain is a squad member too,
//               and owes an answer like anyone else), plus join requests to
//               approve, squad suggestions to review, and the team's credit.
//
// The availability list is loadUpcomingEvents + loadSquadAnswers, both shared.
// loadSquadAnswers returning WHO answered rather than just how many is what
// lets "3 available · 1 out" expand into names in place — one query either way,
// the names ride along with the count rather than being fetched on the tap.
//
// Any squad member who owes money — joining fee, or their share of games
// already played — gets a "You owe" strip that opens PaySheet, and the same
// sheet is one tap away from a greyed Available button. The captain's
// team-credit tile stays read-only: managing the team's money is the captain
// control panel (Phase 4), and paying what YOU owe is worded around what it's
// for, not around a balance (see pay-sheet.tsx for why).

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';

import { supabase } from '@/lib/supabase';
import {
  loadUpcomingEvents,
  loadSquadAnswers,
  writeMyStatus,
  type UpcomingEvent,
  type SquadAnswers,
  type ConfirmStatus,
} from '@/lib/event-availability';
import { useAvailabilityGate, owedSummary } from '@/lib/availability-gate';
import { useMyDues } from '@/lib/dues';
import { fmtFee, useJoiningFee } from '@/lib/joining-fee';
import { fmtKickoff } from '@/lib/match-dates';
import { PaySheet } from '~/components/pay-sheet';
import { PollSheet } from '~/components/poll-sheet';
import { CaptainPollSheet } from '~/components/captain-poll-sheet';
import { useAvailabilityPoll } from '@/lib/availability-poll';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';


export function StatusStrips({
  role,
  userId,
  teamId,
  isCaptain,
}: {
  role: string;
  userId: string;
  teamId: string | null;
  isCaptain: boolean;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);

  const [events, setEvents] = useState<UpcomingEvent[]>([]);
  const [answers, setAnswers] = useState<Record<string, SquadAnswers>>({});
  const [joinRequests, setJoinRequests] = useState(0);
  const [suggestions, setSuggestions] = useState(0);
  const [credit, setCredit] = useState<number | null>(null);
  // The captain's poll tile: how many of the squad have answered the live poll.
  const [pollReplies, setPollReplies] = useState(0);
  const [squadSize, setSquadSize] = useState(0);
  const [myPending, setMyPending] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { dues, owedPence: duesOwed, reload: reloadDues } = useMyDues(teamId, userId);
  const { owedPence: feeOwed, reload: reloadFee } = useJoiningFee(teamId, userId);
  const [payOpen, setPayOpen] = useState(false);
  // The captain's live poll — proposed dates, as opposed to games already
  // committed to (those are the per-game answers further down).
  const { request: poll, myAnswer: pollAnswer, reload: reloadPoll } = useAvailabilityPoll(teamId, userId);
  const [pollOpen, setPollOpen] = useState(false);
  // The captain's tile opens a sheet over Home, as on the web, rather than a
  // page: the poll's votes, the confirmed games' answers and Start a poll all
  // live in it. `voteFromSheet` sends the captain back to it after voting.
  const [captainSheet, setCaptainSheet] = useState<'status' | 'create' | null>(null);
  const [voteFromSheet, setVoteFromSheet] = useState(false);
  // Bumped after the pay sheet closes so each EventAnswer remounts and
  // re-reads its availability gate — a payment is exactly what lifts it.
  const [gateKey, setGateKey] = useState(0);

  const load = useCallback(async () => {
    // A teamless viewer's only strip is the request they are waiting on.
    if (!teamId) {
      const { data } = await supabase
        .from('team_members')
        .select('team_id, status')
        .eq('player_id', userId)
        .eq('status', 'pending')
        .maybeSingle();
      if (data?.team_id) {
        const { data: t } = await supabase
          .from('teams')
          .select('name')
          .eq('id', data.team_id)
          .maybeSingle();
        setMyPending((t as { name?: string } | null)?.name ?? 'a team');
      } else {
        setMyPending(null);
      }
      setLoading(false);
      return;
    }

    const ev = await loadUpcomingEvents(teamId, userId);
    setEvents(ev);

    if (isCaptain) {
      // The tally rides along with the names — see the note at the top.
      setAnswers(await loadSquadAnswers(teamId, ev));

      const jr = await supabase
        .from('team_members')
        .select('id', { count: 'exact', head: true })
        .eq('team_id', teamId)
        .eq('status', 'pending');
      setJoinRequests(jr.count ?? 0);

      // Missing-migration guard: match_suggestions may not exist yet, and a
      // failed select must not take the whole strip down with it.
      const sg = await supabase
        .from('match_suggestions')
        .select('id', { count: 'exact', head: true })
        .eq('team_id', teamId);
      setSuggestions(sg.error ? 0 : (sg.count ?? 0));

      const cr = await supabase
        .from('team_credits')
        .select('balance_pence, reserved_pence')
        .eq('team_id', teamId)
        .maybeSingle();
      const row = cr.data as { balance_pence?: number; reserved_pence?: number } | null;
      setCredit(row ? (row.balance_pence ?? 0) - (row.reserved_pence ?? 0) : null);

      // Squad = approved members + the captain, who has no team_members row.
      const sq = await supabase
        .from('team_members')
        .select('id', { count: 'exact', head: true })
        .eq('team_id', teamId)
        .eq('status', 'approved');
      setSquadSize((sq.count ?? 0) + 1);
    }
    setLoading(false);
  }, [teamId, userId, isCaptain]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isCaptain || !poll) {
      setPollReplies(0);
      return;
    }
    void supabase
      .from('availability_responses')
      .select('id', { count: 'exact', head: true })
      .eq('request_id', poll.id)
      .then(({ count }) => setPollReplies(count ?? 0));
  }, [isCaptain, poll]);

  if (loading) return null;

  // ── new_user ────────────────────────────────────────────────────────
  // A join request leaves the requester classed as new_user until a captain
  // acts, which looks identical to never having asked — so say so explicitly.
  if (!teamId) {
    if (!myPending) return null;
    return (
      <View style={[styles.strip, styles.stripWarn]}>
        <Ionicons name="hourglass-outline" size={18} color="#B07400" />
        <View style={styles.stripBody}>
          <Text style={styles.stripTitleWarn}>Request pending</Text>
          <Text style={styles.stripSub}>
            Waiting for {myPending} to approve you.
          </Text>
        </View>
      </View>
    );
  }

  const unanswered = events.filter((e) => e.myStatus === 'pending');
  const owed = feeOwed + duesOwed;
  const owedLine =
    feeOwed > 0 && duesOwed > 0
      ? `Joining fee and your share of ${dues.length} game${dues.length === 1 ? '' : 's'}`
      : feeOwed > 0
        ? 'Your joining fee'
        : `Your share of ${dues.length} game${dues.length === 1 ? '' : 's'} already played`;

  // The web tile's badge: the captain's own missing vote outranks the squad
  // count, because it's the one number on the tile they can fix right now.
  const unansweredMine = events.filter((e) => e.myStatus === 'pending').length;
  const pollBadge = !poll
    ? unansweredMine > 0
      ? { label: 'Your reply', warn: true }
      : null
    : pollAnswer === null
      ? { label: 'Your vote', warn: false }
      : pollReplies < squadSize
        ? { label: `${squadSize - pollReplies} left`, warn: true }
        : { label: 'Complete', warn: false };

  const closePay = () => {
    setPayOpen(false);
    void reloadDues();
    void reloadFee();
    setGateKey((k) => k + 1);
    void load();
  };

  return (
    <View style={styles.wrap}>
      {owed > 0 && (
        <Pressable onPress={() => setPayOpen(true)} style={[styles.strip, styles.stripOwe]}>
          <Ionicons name="card-outline" size={18} color={theme.danger} />
          <View style={styles.stripBody}>
            <Text style={styles.stripTitleOwe}>You owe {fmtFee(owed)}</Text>
            <Text style={styles.stripSub}>{owedLine}</Text>
          </View>
          <Text style={styles.stripAction}>Pay</Text>
        </Pressable>
      )}

      {/* The web captain Home's money row and poll tile, in the same order.
          No "top up" here: on the phone every payment names what it's for
          (App Store rules — see pay-sheet.tsx), so the balance is read-only
          and the squad pays through what they owe. Payment Status — ticking
          who has paid — stays on the web for now, greyed rather than hidden. */}
      {isCaptain && (
        <View>
          <Text style={styles.sectionTitle}>Team money</Text>
          <View style={styles.moneyGrid}>
            <View style={[styles.moneyBtn, styles.moneyWide]}>
              <Ionicons name="wallet-outline" size={16} color={theme.accentInk} />
              <Text style={styles.moneyValue}>{credit != null ? fmtFee(Math.max(0, credit)) : '—'}</Text>
              <Text style={styles.moneyHint}>available</Text>
            </View>
            <View style={styles.moneyRow}>
              <Pressable
                onPress={() =>
                  Alert.alert('Payment Status', 'Marking who has paid is on the web app for now.')
                }
                style={[styles.moneyBtn, styles.moneyOff]}>
                <Text style={[styles.moneyText, { color: theme.textSecondary }]}>Payment Status</Text>
              </Pressable>
              <Pressable onPress={() => router.push('/settle')} style={styles.moneyBtn}>
                <Text style={styles.moneyText}>Settle Payments</Text>
              </Pressable>
            </View>
          </View>

          <Pressable
            onPress={() => setCaptainSheet(poll || events.length > 0 ? 'status' : 'create')}
            style={[styles.card, styles.pollTile]}>
            <View style={styles.pollIcon}>
              <Ionicons name="checkbox-outline" size={20} color="#fff" />
            </View>
            <View style={styles.stripBody}>
              <Text style={styles.pollTitle}>Availability Poll</Text>
              <Text style={styles.stripSub}>
                {!poll
                  ? events.length > 0
                    ? `${events.length} confirmed game${events.length === 1 ? '' : 's'} · tap to set availability`
                    : 'No poll running · tap to start one'
                  : `${pollReplies} of ${squadSize} replied${pollAnswer === null ? " · you haven't voted yet" : pollReplies >= squadSize ? ' · all in' : ` · waiting on ${Math.max(0, squadSize - pollReplies)}`}`}
              </Text>
            </View>
            {pollBadge && (
              <View style={[styles.pollBadge, pollBadge.warn ? styles.pollBadgeWarn : styles.pollBadgeDone]}>
                <Text style={[styles.pollBadgeText, { color: pollBadge.warn ? '#B45309' : theme.accentInk }]}>
                  {pollBadge.label}
                </Text>
              </View>
            )}
            <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
          </Pressable>
        </View>
      )}

      {isCaptain && (joinRequests > 0 || suggestions > 0) && (
        <View style={styles.tileRow}>
          {joinRequests > 0 && (
            <Tile
              icon="person-add-outline"
              value={String(joinRequests)}
              label={joinRequests === 1 ? 'join request' : 'join requests'}
              styles={styles}
              theme={theme}
              accent
            />
          )}
          {suggestions > 0 && (
            <Tile
              icon="bulb-outline"
              value={String(suggestions)}
              label={suggestions === 1 ? 'suggestion' : 'suggestions'}
              styles={styles}
              theme={theme}
            />
          )}
        </View>
      )}

      {!isCaptain && poll && poll.date_options.length > 0 && (
        <Pressable
          onPress={() => setPollOpen(true)}
          style={[styles.strip, styles.stripPoll, pollAnswer === null && styles.stripPollDue]}>
          <Ionicons name="calendar-outline" size={18} color={pollAnswer === null ? '#B07400' : theme.accentInk} />
          <View style={styles.stripBody}>
            <Text style={pollAnswer === null ? styles.stripTitleWarn : styles.stripTitlePoll}>
              {pollAnswer === null ? (isCaptain ? 'Your vote on the dates' : 'Your captain proposed dates') : 'Proposed dates'}
            </Text>
            <Text style={styles.stripSub}>
              {pollAnswer === null
                ? `${poll.date_options.length} option${poll.date_options.length === 1 ? '' : 's'} — which could you play?`
                : pollAnswer.length === 0
                  ? 'You said none work · tap to change'
                  : `${pollAnswer.length} date${pollAnswer.length === 1 ? '' : 's'} sent · tap to change`}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
        </Pressable>
      )}

      {!isCaptain && unanswered.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>
            {isCaptain ? 'Your squad needs answers' : 'Your captain needs an answer'}
          </Text>
          {unanswered.map((e) => (
            <EventAnswer
              key={`${e.key}:${gateKey}`}
              event={e}
              teamId={teamId}
              userId={userId}
              tally={isCaptain ? answers[e.key] : undefined}
              onAnswered={load}
              onPay={() => setPayOpen(true)}
              styles={styles}
              theme={theme}
            />
          ))}
        </View>
      )}

      <PaySheet visible={payOpen} teamId={teamId} userId={userId} onClose={closePay} />
      {poll && (
        <PollSheet
          visible={pollOpen}
          request={poll}
          myAnswer={pollAnswer}
          teamId={teamId}
          userId={userId}
          onClose={(answered) => {
            setPollOpen(false);
            if (answered) void reloadPoll();
            if (voteFromSheet) {
              setVoteFromSheet(false);
              setCaptainSheet('status');
            }
          }}
          onPay={() => {
            setPollOpen(false);
            setVoteFromSheet(false);
            setPayOpen(true);
          }}
        />
      )}
      {isCaptain && (
        <CaptainPollSheet
          visible={captainSheet !== null}
          view={captainSheet ?? 'status'}
          onView={setCaptainSheet}
          onClose={() => setCaptainSheet(null)}
          teamId={teamId}
          userId={userId}
          poll={poll}
          myAnswer={pollAnswer}
          squadSize={squadSize}
          confirmedGames={
            events.length > 0
              ? events.map((e) => (
                  <EventAnswer
                    key={`${e.key}:${gateKey}`}
                    event={e}
                    teamId={teamId}
                    userId={userId}
                    tally={answers[e.key]}
                    onAnswered={load}
                    onPay={() => {
                      setCaptainSheet(null);
                      setPayOpen(true);
                    }}
                    styles={styles}
                    theme={theme}
                  />
                ))
              : null
          }
          onVote={() => {
            setCaptainSheet(null);
            setVoteFromSheet(true);
            setPollOpen(true);
          }}
          onCreated={async () => {
            await reloadPoll();
            setCaptainSheet(null);
            setVoteFromSheet(true);
            setPollOpen(true);
          }}
        />
      )}
    </View>
  );
}

function Tile({
  icon,
  value,
  label,
  styles,
  theme,
  accent = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
  styles: ReturnType<typeof makeStyles>;
  theme: ReturnType<typeof useTheme>;
  accent?: boolean;
}) {
  return (
    <View style={[styles.tile, accent && styles.tileAccent]}>
      <Ionicons name={icon} size={16} color={accent ? theme.accentInk : theme.textSecondary} />
      <Text style={[styles.tileValue, accent && { color: theme.accentInk }]}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

// One fixture awaiting this player's answer. The captain's copy carries the
// squad tally, which expands into the two groups of names in place — the line
// is inert until somebody has actually answered.
function EventAnswer({
  event,
  teamId,
  userId,
  tally,
  onAnswered,
  onPay,
  styles,
  theme,
}: {
  event: UpcomingEvent;
  teamId: string;
  userId: string;
  tally?: SquadAnswers;
  onAnswered: () => void;
  onPay: () => void;
  styles: ReturnType<typeof makeStyles>;
  theme: ReturnType<typeof useTheme>;
}) {
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const gate = useAvailabilityGate(teamId, userId);

  const answer = async (status: ConfirmStatus) => {
    if (busy) return;
    setBusy(true);
    await writeMyStatus(event.target, { playerId: userId, teamId, status });
    setBusy(false);
    onAnswered();
  };

  const answered = (tally?.confirmed.length ?? 0) + (tally?.declined.length ?? 0);

  return (
    <View style={styles.event}>
      <Text style={styles.eventTitle}>{event.title}</Text>
      <Text style={styles.eventWhen}>
        {fmtKickoff(event.matchDate, event.matchTime)}
        {event.venueName ? ` · ${event.venueName}` : ''}
      </Text>
      {event.myStatus !== 'pending' && (
        <Text style={[styles.eventWhen, { color: event.myStatus === 'confirmed' ? theme.accentInk : theme.danger }]}>
          You said: {event.myStatus === 'confirmed' ? 'Available' : "Can't play"}
        </Text>
      )}

      {tally && answered > 0 && (
        <Pressable onPress={() => setExpanded((v) => !v)} style={styles.tallyRow}>
          <Text style={styles.tally}>
            {tally.confirmed.length} available · {tally.declined.length} out
          </Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={13}
            color={theme.textSecondary}
          />
        </Pressable>
      )}
      {expanded && tally && (
        <View style={styles.names}>
          {tally.confirmed.length > 0 && (
            <Text style={styles.nameLine}>
              <Text style={styles.nameLabel}>In: </Text>
              {tally.confirmed.map((p) => p.name).join(', ')}
            </Text>
          )}
          {tally.declined.length > 0 && (
            <Text style={styles.nameLine}>
              <Text style={styles.nameLabel}>Out: </Text>
              {tally.declined.map((p) => p.name).join(', ')}
            </Text>
          )}
        </View>
      )}

      <View style={styles.answerRow}>
        <Pressable
          // Gated: owing the team money means you cannot claim a place.
          onPress={gate.blocked ? undefined : () => answer('confirmed')}
          disabled={gate.blocked || busy}
          style={[styles.answerBtn, styles.answerIn, gate.blocked && styles.answerOff]}>
          {busy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={[styles.answerText, gate.blocked && styles.answerTextOff]}>
              Available
            </Text>
          )}
        </Pressable>
        <Pressable
          // Never gated — ruling yourself out claims no place.
          onPress={() => answer('declined')}
          disabled={busy}
          style={[styles.answerBtn, styles.answerOut]}>
          <Text style={styles.answerOutText}>Can&apos;t play</Text>
        </Pressable>
      </View>

      {gate.blocked && !gate.loading && (
        <Text style={styles.gateNote}>
          Pay {owedSummary(gate)} to put yourself forward. You can still say you can&apos;t play.{' '}
          <Text style={styles.gateLink} onPress={onPay}>
            Pay now
          </Text>
        </Text>
      )}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    sectionTitle: {
      color: theme.textPrimary,
      fontFamily: fonts.extrabold,
      fontSize: 15,
      textTransform: 'uppercase',
      marginTop: 8,
      marginBottom: 10,
    },
    moneyGrid: { gap: 8 },
    moneyRow: { flexDirection: 'row', gap: 8 },
    moneyBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingVertical: 13,
    },
    moneyWide: { flex: 0 },
    moneyOff: { opacity: 0.55 },
    moneyValue: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 15 },
    moneyHint: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13 },
    moneyText: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
    pollTile: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
    pollIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: theme.accent2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pollBadge: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
    pollBadgeWarn: { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' },
    pollBadgeDone: { backgroundColor: theme.successBg, borderColor: theme.successBorder },
    pollBadgeText: { fontFamily: fonts.bold, fontSize: 10 },
    pollTitle: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 15 },
    wrap: { gap: 10, marginTop: 18 },
    strip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      borderRadius: radius.card,
      borderWidth: 1,
      padding: 14,
      marginTop: 18,
    },
    stripWarn: { backgroundColor: '#FFF6E3', borderColor: '#F5DCA6' },
    stripBody: { flex: 1 },
    stripTitleWarn: { color: '#B07400', fontFamily: fonts.semibold, fontSize: 14 },
    // Inside wrap, which already spaces its children — the standalone strip's
    // own top margin would double it.
    stripPoll: { backgroundColor: theme.surface, borderColor: theme.border, marginTop: 0 },
    stripPollDue: { backgroundColor: '#FFF6E3', borderColor: '#F5DCA6' },
    stripTitlePoll: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14 },
    stripOwe: { backgroundColor: '#FDECEC', borderColor: '#F5C2C2', marginTop: 0 },
    stripTitleOwe: { color: theme.danger, fontFamily: fonts.semibold, fontSize: 14 },
    stripAction: { color: theme.danger, fontFamily: fonts.bold, fontSize: 13 },
    stripSub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, marginTop: 1 },

    tileRow: { flexDirection: 'row', gap: 9 },
    tile: {
      flex: 1,
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      paddingVertical: 12,
      paddingHorizontal: 10,
      alignItems: 'center',
      gap: 3,
      ...cardShadow,
    },
    tileAccent: { backgroundColor: theme.successBg, borderColor: theme.successBorder },
    tileValue: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 18 },
    tileLabel: {
      color: theme.textSecondary,
      fontFamily: fonts.medium,
      fontSize: 10,
      textAlign: 'center',
    },

    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      padding: 15,
      ...cardShadow,
    },
    cardLabel: {
      color: theme.textSecondary,
      fontFamily: fonts.semibold,
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: 10,
    },
    event: { gap: 3, paddingTop: 4 },
    eventTitle: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 15 },
    eventWhen: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
    tallyRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
    tally: { color: theme.accentInk, fontFamily: fonts.semibold, fontSize: 12 },
    names: { gap: 2, marginTop: 4 },
    nameLine: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
    nameLabel: { fontFamily: fonts.semibold, color: theme.textPrimary },
    answerRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
    answerBtn: {
      flex: 1,
      borderRadius: radius.btn,
      paddingVertical: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    answerIn: { backgroundColor: theme.accent },
    answerOff: { backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border },
    answerOut: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
    answerText: { color: '#fff', fontFamily: fonts.semibold, fontSize: 13 },
    answerTextOff: { color: theme.textSecondary },
    answerOutText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 13 },
    gateNote: {
      color: theme.textSecondary,
      fontFamily: fonts.regular,
      fontSize: 11,
      lineHeight: 16,
      marginTop: 6,
    },
    gateLink: { color: theme.accentInk, fontFamily: fonts.semibold },
  });
