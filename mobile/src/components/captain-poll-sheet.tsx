// The sheet behind the captain's Availability Poll tile on Home — the port of
// the web's components/PollStatusTile.tsx sheets. On the web the captain's
// Home shows only the tile; the poll's votes, the squad's answers for games
// already confirmed, and "Start a poll" all open from it, over Home. Same here.
//
// Two views, as on the web:
//   status — confirmed games first (they're happening either way), then the
//            live poll's dates with their votes, then the captain's own vote
//            and "Post new dates";
//   create — the shared poll composer.
// The captain's own vote is the ordinary PollSheet, opened by the parent in
// place of this sheet so only one overlay is on screen at a time.

import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';

import { supabase } from '@/lib/supabase';
import type { PollRequest } from '@/lib/availability-poll';
import { fonts, radius } from '~/theme';
import { useTheme } from '~/use-theme';
import { PollComposer } from '~/components/poll-composer';

type Response = { player_id: string; available_date_ids: string[] };

export function CaptainPollSheet({
  visible,
  view,
  onView,
  onClose,
  teamId,
  userId,
  poll,
  myAnswer,
  squadSize,
  confirmedGames,
  onVote,
  onCreated,
}: {
  visible: boolean;
  view: 'status' | 'create';
  onView: (v: 'status' | 'create') => void;
  onClose: () => void;
  teamId: string;
  userId: string;
  poll: PollRequest | null;
  /** null = hasn't voted; [] = "none of these". */
  myAnswer: string[] | null;
  squadSize: number;
  /** The confirmed games' answer rows — rendered by the parent, which owns them. */
  confirmedGames: ReactNode | null;
  onVote: () => void;
  onCreated: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [responses, setResponses] = useState<Response[]>([]);

  useEffect(() => {
    if (!visible || !poll) {
      setResponses([]);
      return;
    }
    void supabase
      .from('availability_responses')
      .select('player_id, available_date_ids')
      .eq('request_id', poll.id)
      .then(({ data }) => setResponses((data ?? []) as Response[]));
  }, [visible, poll]);

  const replied = responses.length;
  const waiting = Math.max(0, squadSize - replied);
  const iVoted = myAnswer !== null;

  const title = view === 'create' ? (poll ? 'New poll' : 'Start a poll') : 'Availability';
  const subtitle =
    view === 'create'
      ? poll
        ? 'Posting new dates replaces the current poll and clears its votes.'
        : "Add the dates you're considering. Your squad votes on which they can make."
      : poll
        ? `${replied} of ${squadSize} replied${waiting > 0 ? ` · still waiting on ${waiting}` : ''}`
        : 'No poll running — these games are already confirmed.';

  const none = responses.filter((r) => r.available_date_ids.length === 0).length;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={styles.scrim} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              <Pressable onPress={onClose} hitSlop={10}>
                <Ionicons name="close" size={24} color={theme.textSecondary} />
              </Pressable>
            </View>
            <Text style={styles.sub}>{subtitle}</Text>

            <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
              {view === 'create' ? (
                <PollComposer
                  teamId={teamId}
                  captainId={userId}
                  // Straight into their own vote, as on the web: the captain is
                  // counted in the squad, so a poll they haven't answered can
                  // never read "all in".
                  onSent={onCreated}
                />
              ) : (
                <View style={{ gap: 8 }}>
                  {confirmedGames && (
                    <View style={{ marginBottom: 12 }}>
                      <Text style={styles.section}>Confirmed games</Text>
                      {confirmedGames}
                    </View>
                  )}

                  {poll && (
                    <>
                      {confirmedGames && <Text style={styles.section}>Poll dates</Text>}
                      {poll.date_options.map((opt) => {
                        const votes = responses.filter((r) => r.available_date_ids.includes(opt.id)).length;
                        const pct = replied > 0 ? Math.round((votes / replied) * 100) : 0;
                        const mine = myAnswer?.includes(opt.id);
                        return (
                          <View key={opt.id} style={styles.opt}>
                            <View style={styles.optHead}>
                              <Text style={styles.optTitle}>
                                {opt.dayName} · {opt.time}
                                {mine && <Text style={styles.you}>  you</Text>}
                              </Text>
                              <Text style={styles.votes}>
                                {votes} vote{votes !== 1 ? 's' : ''}
                              </Text>
                            </View>
                            <View style={styles.bar}>
                              <View style={[styles.barFill, { width: `${pct}%` }]} />
                            </View>
                            <Text style={styles.optSub}>
                              {opt.date}
                              {opt.location ? ` · ${opt.location}` : ''}
                            </Text>
                          </View>
                        );
                      })}
                      <View style={styles.opt}>
                        <View style={styles.optHead}>
                          <Text style={[styles.optTitle, { color: theme.textSecondary, flex: 1 }]}>
                            Unavailable for any of these dates
                          </Text>
                          <Text style={[styles.votes, { color: theme.danger }]}>
                            {none} vote{none !== 1 ? 's' : ''}
                          </Text>
                        </View>
                        <View style={styles.bar}>
                          <View
                            style={[
                              styles.barFill,
                              { backgroundColor: theme.danger, width: `${replied > 0 ? Math.round((none / replied) * 100) : 0}%` },
                            ]}
                          />
                        </View>
                      </View>
                      {replied === 0 && <Text style={styles.sub}>No responses yet.</Text>}
                    </>
                  )}

                  <View style={{ gap: 8, marginTop: 8 }}>
                    {poll && (
                      <Pressable onPress={onVote} style={iVoted ? styles.outline : styles.primary}>
                        <Text style={iVoted ? styles.outlineText : styles.primaryText}>
                          {iVoted ? 'Change your vote' : 'Add your availability'}
                        </Text>
                      </Pressable>
                    )}
                    <Pressable onPress={() => onView('create')} style={poll ? styles.outlineAccent : styles.primary}>
                      <Text style={poll ? styles.outlineAccentText : styles.primaryText}>
                        {poll ? 'Post new dates' : 'Start a poll'}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        onClose();
                        router.push('/poll');
                      }}
                      style={{ alignItems: 'center', paddingVertical: 8 }}>
                      <Text style={styles.link}>Open full poll manager</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    scrim: { flex: 1, backgroundColor: theme.scrim, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: 20,
      paddingTop: 10,
      paddingBottom: 30,
      maxHeight: '88%',
    },
    handle: { alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: theme.border, marginBottom: 12 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 24 },
    sub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, marginTop: 4 },
    section: {
      color: theme.textSecondary,
      fontFamily: fonts.bold,
      fontSize: 10,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 8,
    },
    opt: { backgroundColor: theme.panel, borderColor: theme.border, borderWidth: 1, borderRadius: radius.btn, paddingHorizontal: 14, paddingVertical: 12 },
    optHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 },
    optTitle: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14, flexShrink: 1 },
    you: { color: theme.accentInk, fontFamily: fonts.bold, fontSize: 10 },
    votes: { color: theme.accentInk, fontFamily: fonts.bold, fontSize: 12 },
    bar: { height: 6, borderRadius: 3, backgroundColor: theme.surface2, overflow: 'hidden' },
    barFill: { height: 6, borderRadius: 3, backgroundColor: theme.accent },
    optSub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 10, marginTop: 4 },
    primary: { backgroundColor: theme.accent, borderRadius: radius.btn, paddingVertical: 14, alignItems: 'center' },
    primaryText: { color: '#fff', fontFamily: fonts.bold, fontSize: 14 },
    outline: { borderWidth: 1, borderColor: theme.border, borderRadius: radius.btn, paddingVertical: 14, alignItems: 'center' },
    outlineText: { color: theme.textSecondary, fontFamily: fonts.bold, fontSize: 14 },
    outlineAccent: { borderWidth: 1, borderColor: theme.accent, borderRadius: radius.btn, paddingVertical: 14, alignItems: 'center' },
    outlineAccentText: { color: theme.accentInk, fontFamily: fonts.bold, fontSize: 14 },
    link: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 12 },
  });
