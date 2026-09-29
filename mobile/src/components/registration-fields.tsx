// The registration questions — the mobile port of components/RegistrationFields.tsx,
// shared by Register (email + password + these) and Welcome (these alone, for
// an account that exists without a profile). Option lists come from the web's
// lib/profile-options.ts and the answers from lib/register-profile.ts's
// PlayerDetails, so the two apps can't ask different questions.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import {
  AGE_GROUPS,
  EXPERIENCE_LEVELS,
  FOOTBALL_TYPES,
  GENDERS,
  PLAY_FREQUENCIES,
  POSITIONS,
  type Option,
} from '@/lib/profile-options';
import type { AccountType, PlayerDetails } from '@/lib/register-profile';
import { fonts, radius } from '~/theme';
import { useTheme } from '~/use-theme';

export function AccountTypeCards({ value, onChange }: { value: AccountType | null; onChange: (t: AccountType) => void }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const card = (type: AccountType, icon: keyof typeof Ionicons.glyphMap, title: string, sub: string) => {
    const on = value === type;
    return (
      <Pressable onPress={() => onChange(type)} style={[styles.typeCard, on && styles.typeCardOn]}>
        <Ionicons name={icon} size={22} color={on ? theme.accentInk : theme.textSecondary} />
        <Text style={[styles.typeTitle, on && { color: theme.accentInk }]}>{title}</Text>
        <Text style={styles.typeSub}>{sub}</Text>
      </Pressable>
    );
  };
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>I am a…</Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {card('player', 'football-outline', 'Player', 'Join teams, find matches')}
        {card('venue_manager', 'location-outline', 'Venue manager', 'List your pitch, manage bookings')}
      </View>
    </View>
  );
}

export function VenueNextStepsNote() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  return (
    <View style={styles.note}>
      <Text style={styles.noteTitle}>What happens next</Text>
      <Text style={styles.noteBody}>
        Venue tools are on the website. After signing up, use the web app to register your pitch, set
        availability and take bookings.
      </Text>
    </View>
  );
}

export function PlayerDetailsFields({ value, onChange }: { value: PlayerDetails; onChange: (patch: Partial<PlayerDetails>) => void }) {
  return (
    <View style={{ gap: 16 }}>
      <Select label="Age group" options={AGE_GROUPS} value={value.ageGroup} onChange={(v) => onChange({ ageGroup: v })} />
      <Select label="Gender" options={GENDERS} value={value.gender} onChange={(v) => onChange({ gender: v })} />
      <Select
        label="Main position"
        hint="You can add more positions later from your profile."
        options={POSITIONS.map((p) => ({ value: p, label: p }))}
        value={value.position}
        onChange={(v) => onChange({ position: v })}
      />
      <Select
        label="Experience"
        options={EXPERIENCE_LEVELS.map((e) => ({ value: e, label: e }))}
        value={value.experience}
        onChange={(v) => onChange({ experience: v })}
      />
      <Select label="How often you play" options={PLAY_FREQUENCIES} value={value.gamesPerMonth} onChange={(v) => onChange({ gamesPerMonth: v })} />
      <Select label="Looking for" options={FOOTBALL_TYPES} value={value.footballType} onChange={(v) => onChange({ footballType: v })} />
    </View>
  );
}

function Select({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  options: Option[];
  value: string;
  onChange: (v: string) => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{label}</Text>
      {!!hint && <Text style={styles.hint}>{hint}</Text>}
      <View style={styles.chips}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable key={o.value} onPress={() => onChange(o.value)} style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    label: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 13 },
    hint: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 11, marginTop: -4 },
    typeCard: {
      flex: 1,
      gap: 6,
      borderWidth: 2,
      borderColor: theme.border,
      backgroundColor: theme.surface2,
      borderRadius: 16,
      padding: 14,
    },
    typeCardOn: { borderColor: theme.accent, backgroundColor: theme.successBg },
    typeTitle: { color: theme.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
    typeSub: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 11 },
    note: { backgroundColor: theme.successBg, borderColor: theme.successBorder, borderWidth: 1, borderRadius: 12, padding: 12, gap: 3 },
    noteTitle: { color: theme.accentInk, fontFamily: fonts.semibold, fontSize: 12 },
    noteBody: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1, borderColor: theme.border, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: theme.surface },
    chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    chipText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 12 },
    chipTextOn: { color: '#fff' },
  });
