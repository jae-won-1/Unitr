// Profile — the mobile port of app/profile/page.tsx.
//
// Reached from the avatar on each tab's header (components/top-actions.tsx),
// as a stack screen over the tabs, the way the web app reaches it from the
// TopBar's avatar menu rather than from a tab.
//
// Shared, unchanged: loadProfileFields / saveProfileFields and the option
// lists (lib/profile-options.ts), persistSavedCard (lib/save-card.ts),
// useLeadership for the captain badge (so a co-captain gets it too — the web
// page's own captain_id lookup misses them).
//
// Not ported, deliberately:
//   • Connect Google (Sign-in Methods). linkIdentity is an OAuth round trip
//     that needs the app registered as a redirect target with Supabase and
//     Google — dashboard work, not code. Pointed at the web app instead.
//
// Friends is here: accepted friend_requests in either direction (the web
// page's useFriends query, copied — keep in step), each opening the player
// sheet, which can start a conversation.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStripe } from '@stripe/stripe-react-native';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { authedPost } from '@/lib/authed-fetch';
import { persistSavedCard } from '@/lib/save-card';
import { STRIPE_TEST_MODE } from '@/lib/stripe-mode';
import { useLeadership } from '@/lib/team-leadership';
import {
  AGE_GROUPS,
  FOOTBALL_TYPES,
  GENDERS,
  PLAY_FREQUENCIES,
  loadProfileFields,
  optionLabel,
  playerPositions,
  type ProfileFields,
} from '@/lib/profile-options';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';
import { EditProfileSheet } from '~/components/edit-profile-sheet';
import { PlayerSheet } from '~/components/player-sheet';

type Friend = { id: string; name: string; position: string | null };

// Accepted friend requests in either direction. friend_requests points at
// auth.users, which has no relationship to profiles in the schema cache, so
// names are a second query. A missing table degrades to no friends.
async function loadFriends(userId: string): Promise<Friend[]> {
  const { data: rows, error } = await supabase
    .from('friend_requests')
    .select('from_player_id, to_player_id')
    .eq('status', 'accepted')
    .or(`from_player_id.eq.${userId},to_player_id.eq.${userId}`);
  if (error || !rows || rows.length === 0) return [];
  const others = Array.from(new Set(rows.map((r) => (r.from_player_id === userId ? r.to_player_id : r.from_player_id) as string)));
  const { data: profiles } = await supabase.from('profiles').select('id, full_name, position').in('id', others);
  return (profiles ?? [])
    .map((p) => ({ id: p.id as string, name: (p.full_name as string) || 'Player', position: (p.position as string) || null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

type Profile = {
  full_name: string;
  position: string | null;
  positions?: string[] | null;
  location: string | null;
  experience: string | null;
  games_per_month: string | null;
  preferred_football_type: string | null;
  age_group: string | null;
  gender: string | null;
};

// Nulls become empty strings: an unanswered question and a blank answer are
// the same thing to a form. Same mapping as the web page.
function editableFields(profile: Profile | null): ProfileFields {
  return {
    full_name: profile?.full_name ?? '',
    positions: playerPositions(profile),
    experience: profile?.experience ?? '',
    games_per_month: profile?.games_per_month ?? '',
    preferred_football_type: profile?.preferred_football_type ?? '',
    age_group: profile?.age_group ?? '',
    gender: profile?.gender ?? '',
  };
}

export default function ProfileScreen() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { user, signOut } = useAuth();
  const { teamId, isCaptain, isCoCaptain } = useLeadership(user?.id);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [teamName, setTeamName] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [viewing, setViewing] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void loadFriends(user.id).then(setFriends);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void loadProfileFields<Profile>(user.id).then((data) => {
      setProfile(data);
      setLoading(false);
    });
  }, [user]);

  useEffect(() => {
    if (!teamId) {
      setTeamName(null);
      return;
    }
    void supabase
      .from('teams')
      .select('name')
      .eq('id', teamId)
      .maybeSingle()
      .then(({ data }) => setTeamName((data as { name?: string } | null)?.name ?? null));
  }, [teamId]);

  const initial = useMemo(() => editableFields(profile), [profile]);

  if (!user || loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  const name = profile?.full_name || 'Player';
  const initials = name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const positions = playerPositions(profile);
  const subtitle = [positions[0], profile?.location].filter(Boolean).join(' · ') || 'No position set';

  // The sheet has already written the row, so take its word for it rather
  // than re-reading the profile it just saved.
  const applySaved = (fields: ProfileFields) =>
    setProfile((prev) => ({
      ...(prev ?? { location: null }),
      full_name: fields.full_name,
      position: fields.positions[0] ?? null,
      positions: fields.positions,
      experience: fields.experience || null,
      games_per_month: fields.games_per_month || null,
      preferred_football_type: fields.preferred_football_type || null,
      age_group: fields.age_group || null,
      gender: fields.gender || null,
    }) as Profile);

  const about = [
    ['Age group', optionLabel(AGE_GROUPS, profile?.age_group)],
    ['Gender', optionLabel(GENDERS, profile?.gender)],
    ['Plays', optionLabel(PLAY_FREQUENCIES, profile?.games_per_month)],
    ['Looking for', optionLabel(FOOTBALL_TYPES, profile?.preferred_football_type)],
  ].filter(([, v]) => !!v) as [string, string][];

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
        <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      <View style={styles.hero}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials || '?'}</Text>
        </View>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        {isCaptain && teamName && (
          <View style={styles.captainPill}>
            <Text style={styles.captainPillText}>
              {isCoCaptain ? 'Co-captain' : 'Captain'} — {teamName}
            </Text>
          </View>
        )}
        {(positions.length > 0 || !!profile?.experience) && (
          <View style={styles.chips}>
            {positions.map((p) => (
              <View key={p} style={styles.chip}>
                <Text style={styles.chipText}>{p}</Text>
              </View>
            ))}
            {!!profile?.experience && (
              <View style={[styles.chip, styles.chipMuted]}>
                <Text style={styles.chipMutedText}>{profile.experience}</Text>
              </View>
            )}
          </View>
        )}
      </View>

      <Text style={styles.sectionTitle}>Friends{friends.length ? ` · ${friends.length}` : ''}</Text>
      <View style={styles.card}>
        {friends.length === 0 ? (
          <Text style={styles.cardBody}>No friends yet. Add people from the Transfer Market.</Text>
        ) : (
          friends.map((f, i) => (
            <Pressable key={f.id} onPress={() => setViewing(f.id)} style={[styles.aboutRow, i > 0 && styles.divider]}>
              <Text style={styles.aboutValue}>{f.name}</Text>
              <Text style={styles.aboutLabel}>{f.position ?? ''}</Text>
            </Pressable>
          ))
        )}
      </View>

      <Pressable onPress={() => setEditing(true)} style={styles.editBtn}>
        <Text style={styles.editBtnText}>Edit Profile</Text>
      </Pressable>

      {about.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>About you</Text>
          <View style={styles.card}>
            {about.map(([label, value], i) => (
              <View key={label} style={[styles.aboutRow, i > 0 && styles.divider]}>
                <Text style={styles.aboutLabel}>{label}</Text>
                <Text style={styles.aboutValue}>{value}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      <PaymentMethod userId={user.id} styles={styles} theme={theme} />

      <Text style={styles.sectionTitle}>Sign-in methods</Text>
      <View style={styles.card}>
        <Text style={styles.cardBody}>
          Connecting Google to this account is on the web app for now, under Profile → Sign-in
          methods.
        </Text>
      </View>

      {/* Greyed rather than removed — the house convention; stats and video are
          off for the pilot on the web app too. */}
      <Disabled title="Season stats" blurb="Games, goals and assists start recording once match results go live." styles={styles} />
      <Disabled title="Individual highlights" blurb="Uploading and watching match clips arrives once video is built." styles={styles} />

      {isCaptain && (
        <Pressable onPress={() => router.navigate('/my-team')} style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Manage My Team</Text>
        </Pressable>
      )}

      <Pressable
        onPress={() =>
          Alert.alert('Sign out?', undefined, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: () => void signOut('/sign-in') },
          ])
        }
        style={styles.signOut}>
        <Ionicons name="log-out-outline" size={17} color={theme.textSecondary} />
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>

      <PlayerSheet playerId={viewing} viewerId={user.id} onClose={() => setViewing(null)} />

      <EditProfileSheet
        visible={editing}
        userId={user.id}
        initial={initial}
        onClose={() => setEditing(false)}
        onSaved={applySaved}
      />
    </ScrollView>
  );
}

// Card on file — the same SetupIntent route the web page uses
// (/api/create-setup-intent), confirmed in PaymentSheet's setup mode, then
// written to the profile by the shared persistSavedCard so a card saved here
// is saved identically to one saved on the web.
function PaymentMethod({
  userId,
  styles,
  theme,
}: {
  userId: string;
  styles: ReturnType<typeof makeStyles>;
  theme: ReturnType<typeof useTheme>;
}) {
  const { initPaymentSheet, presentPaymentSheet, retrieveSetupIntent } = useStripe();
  const [card, setCard] = useState<{ brand: string | null; last4: string | null } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('stripe_payment_method_id, card_brand, card_last4')
      .eq('id', userId)
      .maybeSingle();
    setCard(data?.stripe_payment_method_id ? { brand: data.card_brand, last4: data.card_last4 } : null);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const addCard = async () => {
    setBusy(true);
    try {
      const res = await authedPost('/api/create-setup-intent', {});
      const d = await res.json();
      if (!d.clientSecret) {
        Alert.alert('Could not start', d.error ?? 'Try again in a moment.');
        return;
      }
      const init = await initPaymentSheet({
        merchantDisplayName: 'Uniter',
        setupIntentClientSecret: d.clientSecret,
      });
      if (init.error) {
        Alert.alert('Could not start', init.error.message);
        return;
      }
      const present = await presentPaymentSheet();
      if (present.error) {
        if (present.error.code !== 'Canceled') Alert.alert('Card not saved', present.error.message);
        return;
      }
      // PaymentSheet returns no intent on success — ask Stripe which payment
      // method the setup attached, then record it the shared way.
      const { setupIntent, error } = await retrieveSetupIntent(d.clientSecret);
      const pmId = setupIntent?.paymentMethod?.id ?? setupIntent?.paymentMethodId ?? null;
      if (error || !pmId) {
        Alert.alert('Card saved with Stripe', "We couldn't record it here — try again, or add it on the web app.");
        return;
      }
      const saved = await persistSavedCard(userId, pmId);
      setCard(saved);
    } catch {
      Alert.alert('Something went wrong', "Couldn't reach the payment service.");
    } finally {
      setBusy(false);
    }
  };

  const removeCard = () =>
    Alert.alert('Remove this card?', 'Match fees will no longer be charged to it automatically.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await supabase
            .from('profiles')
            .update({ stripe_payment_method_id: null, card_brand: null, card_last4: null })
            .eq('id', userId);
          setCard(null);
        },
      },
    ]);

  if (card === undefined) return null;

  return (
    <>
      <Text style={styles.sectionTitle}>Payment method</Text>
      <View style={[styles.card, { paddingVertical: 14, gap: 12 }]}>
        <Text style={styles.cardBody}>
          Save a card so your share of match fees is charged automatically when your squad is
          confirmed.
        </Text>
        {STRIPE_TEST_MODE && (
          // Testing runs Stripe in test mode against the live database: adding
          // a card here would replace this player's real one, and removing it
          // would remove the real one. So neither is offered (lib/stripe-mode.ts).
          <Text style={styles.cardRowSub}>
            Adding or removing a card is off while testing — it would change the real card saved on this account.
          </Text>
        )}
        {card && (
          <View style={styles.cardRow}>
            <Ionicons name="card-outline" size={20} color={theme.accentInk} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardRowTitle}>
                {(card.brand ?? 'Card').replace(/^\w/, (c) => c.toUpperCase())} •••• {card.last4 ?? '????'}
              </Text>
              <Text style={styles.cardRowSub}>Saved · ready for automatic payments</Text>
            </View>
            {!STRIPE_TEST_MODE && (
              <Pressable onPress={removeCard} hitSlop={8}>
                <Text style={styles.remove}>Remove</Text>
              </Pressable>
            )}
          </View>
        )}
        {!STRIPE_TEST_MODE && (
          <Pressable onPress={addCard} disabled={busy} style={[styles.secondaryBtn, busy && { opacity: 0.6 }]}>
            {busy ? (
              <ActivityIndicator color={theme.accentInk} />
            ) : (
              <Text style={styles.secondaryBtnText}>{card ? 'Update card' : 'Add a card'}</Text>
            )}
          </Pressable>
        )}
      </View>
    </>
  );
}

function Disabled({ title, blurb, styles }: { title: string; blurb: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <>
      <Text style={[styles.sectionTitle, { opacity: 0.5 }]}>{title}</Text>
      <View style={styles.disabledCard}>
        <Text style={styles.disabledTitle}>Not available yet</Text>
        <Text style={styles.disabledBlurb}>{blurb}</Text>
      </View>
    </>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.background },
    content: { padding: 20, paddingTop: 56, paddingBottom: 48 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background },
    back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', marginBottom: 8 },
    backText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 15 },
    hero: { alignItems: 'center', marginTop: 4 },
    avatar: {
      width: 80,
      height: 80,
      borderRadius: 40,
      borderWidth: 2,
      borderColor: theme.accent,
      backgroundColor: theme.successBg,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
    },
    avatarText: { color: theme.accentInk, fontFamily: fonts.extrabold, fontSize: 26 },
    name: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 21 },
    subtitle: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 14, marginTop: 2 },
    captainPill: {
      marginTop: 10,
      backgroundColor: theme.successBg,
      borderColor: theme.successBorder,
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingHorizontal: 12,
      paddingVertical: 4,
    },
    captainPillText: { color: theme.accentInk, fontFamily: fonts.semibold, fontSize: 12 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 12 },
    chip: {
      backgroundColor: theme.successBg,
      borderColor: theme.successBorder,
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingHorizontal: 12,
      paddingVertical: 4,
    },
    chipText: { color: theme.accentInk, fontFamily: fonts.medium, fontSize: 12 },
    chipMuted: { backgroundColor: theme.surface2, borderColor: theme.border },
    chipMutedText: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 12 },
    editBtn: {
      marginTop: 22,
      borderWidth: 1,
      borderColor: theme.accent,
      borderRadius: 14,
      paddingVertical: 12,
      alignItems: 'center',
    },
    editBtnText: { color: theme.accentInk, fontFamily: fonts.semibold, fontSize: 14 },
    sectionTitle: {
      color: theme.textSecondary,
      fontFamily: fonts.semibold,
      fontSize: 12,
      textTransform: 'uppercase',
      letterSpacing: 0.7,
      marginTop: 26,
      marginBottom: 10,
    },
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      paddingHorizontal: 15,
      ...cardShadow,
    },
    cardBody: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, paddingVertical: 2 },
    aboutRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 11 },
    divider: { borderTopWidth: 1, borderTopColor: theme.border },
    aboutLabel: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
    aboutValue: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 13, flexShrink: 1, textAlign: 'right' },
    cardRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      backgroundColor: theme.background,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    cardRowTitle: { color: theme.textPrimary, fontFamily: fonts.semibold, fontSize: 14 },
    cardRowSub: { color: theme.accentInk, fontFamily: fonts.regular, fontSize: 11 },
    remove: { color: theme.danger, fontFamily: fonts.medium, fontSize: 12 },
    secondaryBtn: {
      backgroundColor: theme.successBg,
      borderColor: theme.successBorder,
      borderWidth: 1,
      borderRadius: radius.btn,
      paddingVertical: 11,
      alignItems: 'center',
    },
    secondaryBtnText: { color: theme.accentInk, fontFamily: fonts.semibold, fontSize: 14 },
    disabledCard: {
      backgroundColor: theme.surface2,
      borderColor: theme.border,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderRadius: radius.card,
      padding: 18,
      alignItems: 'center',
      opacity: 0.6,
    },
    disabledTitle: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 13, marginBottom: 3 },
    disabledBlurb: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, textAlign: 'center' },
    primaryBtn: { marginTop: 26, backgroundColor: theme.accent, borderRadius: radius.btn, paddingVertical: 14, alignItems: 'center' },
    primaryBtnText: { color: '#fff', fontFamily: fonts.bold, fontSize: 14 },
    signOut: {
      marginTop: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 14,
      paddingVertical: 12,
    },
    signOutText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 14 },
  });
