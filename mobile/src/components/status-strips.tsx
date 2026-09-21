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
// Team credit is read-only here. Topping up and settling payments are the money
// surfaces (TeamCreditsBar is 938 lines on the web) and belong with Phase 3.

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

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
import { fmtKickoff } from '@/lib/match-dates';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';

const money = (pence: number) => `£${(pence / 100).toFixed(2).replace(/\.00$/, '')}`;

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
  const [myPending, setMyPending] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
    }
    setLoading(false);
  }, [teamId, userId, isCaptain]);

  useEffect(() => {
    void load();
  }, [load]);

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

  return (
    <View style={styles.wrap}>
      {isCaptain && (joinRequests > 0 || suggestions > 0 || credit != null) && (
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
          {credit != null && (
            <Tile
              icon="wallet-outline"
              value={money(credit)}
              label="available credit"
              styles={styles}
              theme={theme}
            />
          )}
        </View>
      )}

      {unanswered.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>
            {isCaptain ? 'Your squad needs answers' : 'Your captain needs an answer'}
          </Text>
          {unanswered.map((e) => (
            <EventAnswer
              key={e.key}
              event={e}
              teamId={teamId}
              userId={userId}
              tally={isCaptain ? answers[e.key] : undefined}
              onAnswered={load}
              styles={styles}
              theme={theme}
            />
          ))}
        </View>
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
  styles,
  theme,
}: {
  event: UpcomingEvent;
  teamId: string;
  userId: string;
  tally?: SquadAnswers;
  onAnswered: () => void;
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
          Pay {owedSummary(gate)} to put yourself forward. You can still say you can&apos;t play.
        </Text>
      )}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
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
  });
