// Post an announcement — the mobile port of app/my-team/announcement/create.
//
// Same two writes as the web page: a team_announcements row filed under the
// TEAM's captain (actingCaptain rule — a co-captain posting still files it
// under the captain, so every captain_id read keeps finding it), then a DM to
// every squad member so it lands in their inbox. @-mentions offer the squad's
// names as you type, the web's autocomplete in chip form.
//
// This file carries its own copy of those two queries: on the web they're
// inline in the page, and moving them into lib/ would mean refactoring a live
// page unsupervised. Worth unifying later — they must stay in step.

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { loadLedTeam } from '@/lib/team-leadership';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';

type RosterPlayer = { player_id: string; name: string };

export default function PostAnnouncement() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [cursor, setCursor] = useState(0);
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The captain plus every approved member — the same roster the web builds,
  // de-duplicated, used both for mentions and for who gets the DM.
  useEffect(() => {
    if (!user) return;
    void (async () => {
      const team = await loadLedTeam<{ id: string; captain_id: string }>(user.id, 'id, captain_id');
      if (!team) return;
      const [{ data: members }, { data: captainProfile }] = await Promise.all([
        supabase.from('team_members').select('player_id, profiles(full_name)').eq('team_id', team.id).eq('status', 'approved'),
        supabase.from('profiles').select('full_name').eq('id', team.captain_id).maybeSingle(),
      ]);
      const list: RosterPlayer[] = [
        ...(team.captain_id ? [{ player_id: team.captain_id, name: (captainProfile?.full_name as string) ?? 'Captain' }] : []),
        ...(members ?? []).map((m) => ({
          player_id: m.player_id as string,
          name: (m.profiles as unknown as { full_name: string } | null)?.full_name ?? 'Player',
        })),
      ].filter((p, i, arr) => arr.findIndex((x) => x.player_id === p.player_id) === i);
      setRoster(list);
    })();
  }, [user]);

  // "@Ja" right before the cursor → squad names starting "Ja".
  const beforeCursor = body.slice(0, cursor);
  const mention = beforeCursor.match(/@([A-Za-z]*)$/);
  const suggestions = mention
    ? roster.filter((p) => p.name.toLowerCase().startsWith(mention[1].toLowerCase()))
    : [];

  const pickMention = (p: RosterPlayer) => {
    if (!mention) return;
    const start = cursor - mention[0].length;
    const inserted = `@${p.name} `;
    const next = body.slice(0, start) + inserted + body.slice(cursor);
    setBody(next);
    setCursor(start + inserted.length);
  };

  const post = async () => {
    if (!user) return;
    if (!body.trim()) {
      setError('Write something for your team to see.');
      return;
    }
    setPosting(true);
    setError(null);
    const team = await loadLedTeam<{ id: string; name: string; captain_id: string }>(user.id, 'id, name, captain_id');
    if (!team) {
      setPosting(false);
      setError('No team found.');
      return;
    }
    const { error: insertError } = await supabase.from('team_announcements').insert({
      team_id: team.id,
      captain_id: team.captain_id ?? user.id,
      title: title.trim() || null,
      body: body.trim(),
    });
    if (insertError) {
      setPosting(false);
      setError(insertError.message);
      return;
    }

    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
    const recipients = roster.map((p) => p.player_id).filter((id) => id !== user.id);
    if (recipients.length > 0) {
      const summary = title.trim() ? `${title.trim()}\n${body.trim()}` : body.trim();
      await supabase.from('messages').insert(
        recipients.map((playerId) => ({
          sender_id: user.id,
          receiver_id: playerId,
          type: 'team_announcement',
          body: `📋 New team announcement from ${profile?.full_name ?? 'your captain'} (${team.name}):\n${summary}`,
        })),
      );
    }
    setPosting(false);
    router.back();
  };

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
        <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      <Text style={styles.heading}>Post announcement</Text>
      <Text style={styles.sub}>
        Everyone in the squad gets it as a message{roster.length > 1 ? ` — ${roster.length - 1} people` : ''}.
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>Title (optional)</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Training moved to Thursday"
          placeholderTextColor={theme.textSecondary}
          style={styles.input}
          maxLength={120}
        />
        <Text style={styles.label}>Message</Text>
        <TextInput
          value={body}
          onChangeText={setBody}
          onSelectionChange={(e) => setCursor(e.nativeEvent.selection.end)}
          placeholder="Type @ to mention a player"
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, styles.bodyInput]}
          multiline
        />
        {suggestions.length > 0 && (
          <View style={styles.suggestions}>
            {suggestions.slice(0, 8).map((p) => (
              <Pressable key={p.player_id} onPress={() => pickMention(p)} style={styles.suggestion}>
                <Text style={styles.suggestionText}>@{p.name}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Pressable onPress={post} disabled={posting || !body.trim()} style={[styles.primary, (posting || !body.trim()) && { opacity: 0.5 }]}>
          {posting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Post to the squad</Text>}
        </Pressable>
      </View>
    </ScrollView>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.background },
    content: { padding: 20, paddingTop: 56, paddingBottom: 48, gap: 12 },
    back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
    backText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 15 },
    heading: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 24 },
    sub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, marginTop: -6 },
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      padding: 15,
      gap: 8,
      ...cardShadow,
    },
    label: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 13, marginTop: 4 },
    input: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: radius.btn,
      paddingHorizontal: 14,
      paddingVertical: 11,
      color: theme.textPrimary,
      fontFamily: fonts.regular,
      fontSize: 14,
      backgroundColor: theme.background,
    },
    bodyInput: { minHeight: 140, textAlignVertical: 'top' },
    suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    suggestion: {
      backgroundColor: '#EAF0FF',
      borderColor: '#C6D4FF',
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    suggestionText: { color: theme.accent2, fontFamily: fonts.semibold, fontSize: 12 },
    error: { color: theme.danger, fontFamily: fonts.regular, fontSize: 12 },
    primary: { backgroundColor: theme.accent, borderRadius: radius.btn, paddingVertical: 13, alignItems: 'center', marginTop: 6 },
    primaryText: { color: '#fff', fontFamily: fonts.bold, fontSize: 14 },
  });
