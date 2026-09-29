// Team Settings — the mobile port of app/my-team/settings/page.tsx and its
// panels (TeamDetailsPanel, InviteLinkPanel, CoCaptainsPanel, the joining fee).
//
// For the captain and co-captains (loadLeadership().canManage). Everything that
// writes is shared and unchanged: saveTeamDetails / loadTeamDetails and the
// option lists (lib/team-options.ts), the invite-code RPCs, setCoCaptain and
// loadSquadForAppointment (lib/team-leadership.ts), and the joining fee is the
// same single update to teams.joining_fee_pence — whose trigger moves the whole
// squad (and the captain) onto the new fee, exactly as on the web.
//
// Two differences from the web, both forced by the platform:
//   • the invite link is built from the website's address, not
//     window.location (a phone has none) — a link shared from the app must
//     open the website, where /join/<code> lives;
//   • sharing uses the phone's share sheet, which includes Copy.

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  loadLeadership,
  loadSquadForAppointment,
  setCoCaptain,
  type CoCaptainRow,
} from '@/lib/team-leadership';
import { TEAM_FORMATS, TEAM_LEVELS, loadTeamDetails, saveTeamDetails, teamFormats } from '@/lib/team-options';
import { fonts, radius, cardShadow } from '~/theme';
import { useTheme } from '~/use-theme';

// The deployed website — where /join/<code> is served. Not the API base URL,
// which points at a local server while payments are being tested.
const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://unitr-omega.vercel.app';

type TeamRow = {
  id: string;
  name: string;
  location: string | null;
  level: string | null;
  description: string | null;
  format: string | null;
  formats?: string[] | null;
  joining_fee_pence?: number | null;
};

export default function TeamSettings() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { user } = useAuth();
  const [teamId, setTeamId] = useState<string | null | undefined>(undefined);
  const [isCaptain, setIsCaptain] = useState(false);
  const [teamName, setTeamName] = useState('');

  useEffect(() => {
    if (!user) return;
    void loadLeadership(user.id).then((led) => {
      if (!led?.canManage) {
        setTeamId(null);
        return;
      }
      setIsCaptain(led.isCaptain);
      setTeamId(led.teamId);
    });
  }, [user]);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
        <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      <Text style={styles.heading}>Team Settings</Text>
      <Text style={styles.sub}>
        {teamName ? `Details, invite link and joining fee for ${teamName}` : 'Details, invite link and joining fee'}
      </Text>

      {teamId === undefined ? (
        <ActivityIndicator color={theme.accent} style={{ marginTop: 30 }} />
      ) : teamId === null ? (
        <Text style={styles.muted}>Only the team captain or a co-captain can edit team settings.</Text>
      ) : (
        <>
          <Details teamId={teamId} onName={setTeamName} styles={styles} theme={theme} />
          <InviteLink teamId={teamId} teamName={teamName} styles={styles} theme={theme} />
          {isCaptain ? (
            <CoCaptains teamId={teamId} styles={styles} theme={theme} />
          ) : (
            <View style={[styles.card, { opacity: 0.6 }]}>
              <Text style={styles.cardTitle}>Co-captains</Text>
              <Text style={styles.cardBody}>
                Only {teamName || 'the team'}&apos;s captain can appoint or remove co-captains. Everything else
                on this page is yours to change.
              </Text>
            </View>
          )}
          <JoiningFee teamId={teamId} styles={styles} theme={theme} />
        </>
      )}
    </ScrollView>
  );
}

type Styles = ReturnType<typeof makeStyles>;
type Theme = ReturnType<typeof useTheme>;

function Details({ teamId, onName, styles, theme }: { teamId: string; onName: (n: string) => void; styles: Styles; theme: Theme }) {
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [level, setLevel] = useState('');
  const [formats, setFormats] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void loadTeamDetails<TeamRow>(teamId, 'id, name, location, level, description, format').then((team) => {
      if (team) {
        setName(team.name ?? '');
        onName(team.name ?? '');
        setLocation(team.location ?? '');
        setLevel(team.level ?? '');
        setFormats(teamFormats(team));
        setDescription(team.description ?? '');
      }
      setLoaded(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  const valid = name.trim().length > 0 && location.trim().length > 0 && !!level && formats.length > 0;
  const touch = () => setSaved(false);

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    setNote(null);
    const res = await saveTeamDetails(teamId, {
      name: name.trim(),
      location: location.trim(),
      level,
      description: description.trim(),
      formats,
    });
    setSaving(false);
    if (res.error) {
      setError("Couldn't save your team details. Please try again.");
      return;
    }
    setSaved(true);
    onName(name.trim());
    if (!res.formatsSaved && formats.length > 1) {
      setNote('Saved — but only your first format was kept until a database update is run.');
    }
  };

  if (!loaded) {
    return (
      <View style={[styles.card, { alignItems: 'center', paddingVertical: 24 }]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Team details</Text>
      <Text style={styles.cardBody}>
        What you set when you registered the team. Players see this when they&apos;re looking for a squad.
      </Text>

      <Text style={styles.label}>Team name</Text>
      <TextInput value={name} onChangeText={(v) => { touch(); setName(v); }} style={styles.input} placeholder="e.g. Hackney United" placeholderTextColor={theme.textSecondary} />

      <Text style={styles.label}>Location</Text>
      <TextInput value={location} onChangeText={(v) => { touch(); setLocation(v); }} style={styles.input} placeholder="e.g. Hackney, London" placeholderTextColor={theme.textSecondary} />

      <Text style={styles.label}>Level</Text>
      <View style={styles.chips}>
        {TEAM_LEVELS.map((l) => (
          <Chip key={l} label={l} on={level === l} onPress={() => { touch(); setLevel(l); }} styles={styles} />
        ))}
      </View>

      <Text style={styles.label}>Players per side</Text>
      <Text style={styles.hint}>Pick every size you play. Your first pick sizes your tactics board.</Text>
      <View style={styles.chips}>
        {TEAM_FORMATS.map((f) => {
          const idx = formats.indexOf(f);
          return (
            <Chip
              key={f}
              label={idx === 0 ? `${f} · main` : f}
              on={idx >= 0}
              onPress={() => {
                touch();
                setFormats((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
              }}
              styles={styles}
            />
          );
        })}
      </View>

      <Text style={styles.label}>Description</Text>
      <TextInput
        value={description}
        onChangeText={(v) => { touch(); setDescription(v); }}
        style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
        multiline
        placeholder="Optional — who you are, when you play"
        placeholderTextColor={theme.textSecondary}
      />

      {!!error && <Text style={styles.error}>{error}</Text>}
      {!!note && <Text style={styles.note}>{note}</Text>}

      <Pressable onPress={save} disabled={!valid || saving} style={[styles.primary, (!valid || saving) && { opacity: 0.5 }]}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{saved ? 'Saved ✓' : 'Save team details'}</Text>}
      </Pressable>
    </View>
  );
}

function InviteLink({ teamId, teamName, styles, theme }: { teamId: string; teamName: string; styles: Styles; theme: Theme }) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);

  const describe = (message: string) =>
    /does not exist|schema cache/i.test(message)
      ? "Invite links aren't set up on this database yet."
      : /captain/i.test(message)
        ? 'Only the team captain can manage the invite link.'
        : "Couldn't load the invite link. Please try again.";

  useEffect(() => {
    let cancelled = false;
    // Minted on first view, same as the web panel.
    void supabase.rpc('ensure_team_invite_code', { p_team_id: teamId }).then(({ data, error: err }) => {
      if (cancelled) return;
      if (err) setError(describe(err.message));
      else setCode(data as string);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  const url = code ? `${WEB_URL}/join/${code}` : '';

  const share = async () => {
    if (!url) return;
    try {
      await Share.share({ message: `Join ${teamName || 'my team'} on Uniter: ${url}`, url });
    } catch {
      // Dismissing the sheet is not an error worth showing.
    }
  };

  // The code is a bearer token: resetting kills every copy already sent.
  const reset = () =>
    Alert.alert('Reset the invite link?', 'The old link stops working straight away. Anyone who hasn’t used it yet will need the new one.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          setResetting(true);
          const { data, error: err } = await supabase.rpc('rotate_team_invite_code', { p_team_id: teamId });
          setResetting(false);
          if (err) {
            setError(describe(err.message));
            return;
          }
          setCode(data as string);
          setError(null);
        },
      },
    ]);

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Invite link</Text>
      <Text style={styles.cardBody}>
        Send this to your players. Anyone who opens it joins {teamName || 'your team'} straight away — no
        join request for you to approve. They&apos;ll still owe any joining fee.
      </Text>
      {loading ? (
        <ActivityIndicator color={theme.accent} style={{ marginVertical: 12 }} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <>
          <View style={styles.linkBox}>
            <Text style={styles.linkText} selectable numberOfLines={2}>{url}</Text>
          </View>
          <Pressable onPress={share} style={styles.primary}>
            <Text style={styles.primaryText}>Share invite link</Text>
          </Pressable>
          <Pressable onPress={reset} disabled={resetting} style={styles.textBtn}>
            <Text style={styles.textBtnText}>{resetting ? 'Resetting…' : 'Reset link'}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function CoCaptains({ teamId, styles, theme }: { teamId: string; styles: Styles; theme: Theme }) {
  const [rows, setRows] = useState<CoCaptainRow[] | null | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(await loadSquadForAppointment(teamId));
  }, [teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (row: CoCaptainRow) => {
    setBusyId(row.playerId);
    setError(null);
    const res = await setCoCaptain(teamId, row.playerId, !row.isCoCaptain);
    setBusyId(null);
    if (!res.ok) {
      setError(res.error ?? "Couldn't save that. Try again.");
      return;
    }
    setRows((prev) => (prev ?? []).map((r) => (r.playerId === row.playerId ? { ...r, isCoCaptain: !r.isCoCaptain } : r)));
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Co-captains</Text>
      <Text style={styles.cardBody}>
        A co-captain can do everything you can — post games, manage matches, pick line-ups and enter
        tournaments. The one thing they can&apos;t do is appoint other co-captains.
      </Text>
      {rows === undefined ? (
        <ActivityIndicator color={theme.accent} style={{ marginVertical: 12 }} />
      ) : rows === null ? (
        <Text style={styles.muted}>Co-captains aren&apos;t set up on this database yet.</Text>
      ) : rows.length === 0 ? (
        <Text style={styles.muted}>No one in the squad yet — invite some players first.</Text>
      ) : (
        rows.map((r, i) => (
          <View key={r.playerId} style={[styles.switchRow, i > 0 && styles.divider]}>
            <Text style={styles.switchLabel} numberOfLines={1}>{r.name}</Text>
            {busyId === r.playerId ? (
              <ActivityIndicator color={theme.accent} />
            ) : (
              <Switch
                value={r.isCoCaptain}
                onValueChange={() => void toggle(r)}
                trackColor={{ true: theme.accent, false: theme.border }}
              />
            )}
          </View>
        ))
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

function JoiningFee({ teamId, styles, theme }: { teamId: string; styles: Styles; theme: Theme }) {
  const [value, setValue] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void supabase
      .from('teams')
      .select('joining_fee_pence')
      .eq('id', teamId)
      .maybeSingle()
      .then(({ data }) => {
        const pence = (data as { joining_fee_pence?: number } | null)?.joining_fee_pence ?? 0;
        setValue(pence > 0 ? (pence / 100).toFixed(2).replace(/\.00$/, '') : '');
        setLoaded(true);
      });
  }, [teamId]);

  const pence = value ? Math.round(parseFloat(value) * 100) : 0;
  const valid = Number.isFinite(pence) && pence >= 0;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    const { error: err } = await supabase.from('teams').update({ joining_fee_pence: pence }).eq('id', teamId);
    setSaving(false);
    if (err) {
      setError(/joining_fee_pence/.test(err.message) ? "The joining fee isn't set up on this database yet." : "Couldn't save the joining fee. Please try again.");
      return;
    }
    setSaved(true);
  };

  if (!loaded) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Joining fee</Text>
      <View style={styles.feeRow}>
        <Text style={styles.pound}>£</Text>
        <TextInput
          value={value}
          onChangeText={(v) => {
            setSaved(false);
            setValue(v.replace(/[^0-9.]/g, ''));
          }}
          keyboardType="decimal-pad"
          placeholder="0 — no joining fee"
          placeholderTextColor={theme.textSecondary}
          style={styles.feeInput}
        />
      </View>
      <Text style={styles.cardBody}>
        Paid once by every player, towards your pitch bookings and tournament entries. Changing it changes
        what the whole squad owes — players you already have move onto the new fee, keeping whatever
        they&apos;ve paid. You owe it too.
      </Text>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Pressable onPress={save} disabled={!valid || saving} style={[styles.primary, (!valid || saving) && { opacity: 0.5 }]}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{saved ? 'Saved ✓' : 'Save joining fee'}</Text>}
      </Pressable>
    </View>
  );
}

function Chip({ label, on, onPress, styles }: { label: string; on: boolean; onPress: () => void; styles: Styles }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.background },
    content: { padding: 20, paddingTop: 56, paddingBottom: 48, gap: 14 },
    back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
    backText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 15 },
    heading: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 24 },
    sub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, marginTop: -8, marginBottom: 4 },
    muted: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      padding: 15,
      gap: 8,
      ...cardShadow,
    },
    cardTitle: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 15 },
    cardBody: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
    label: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 13, marginTop: 8 },
    hint: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 11, marginTop: -4 },
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
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1, borderColor: theme.border, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7 },
    chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    chipText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 12 },
    chipTextOn: { color: '#fff' },
    error: { color: theme.danger, fontFamily: fonts.regular, fontSize: 12 },
    note: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
    primary: { backgroundColor: theme.accent, borderRadius: radius.btn, paddingVertical: 13, alignItems: 'center', marginTop: 6 },
    primaryText: { color: '#fff', fontFamily: fonts.bold, fontSize: 14 },
    textBtn: { alignItems: 'center', paddingVertical: 6 },
    textBtnText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 13 },
    linkBox: { backgroundColor: theme.background, borderWidth: 1, borderColor: theme.border, borderRadius: radius.btn, padding: 12 },
    linkText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 13 },
    switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 8 },
    divider: { borderTopWidth: 1, borderTopColor: theme.border },
    switchLabel: { flex: 1, color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 14 },
    feeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: radius.btn,
      paddingHorizontal: 14,
      backgroundColor: theme.background,
    },
    pound: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 14, marginRight: 6 },
    feeInput: { flex: 1, paddingVertical: 11, color: theme.textPrimary, fontFamily: fonts.regular, fontSize: 14 },
  });
