// The phone's men's/women's controls — components/GenderControls.tsx on the
// web. Labels and rules come from the shared lib/gender.ts.

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GENDER_CATEGORIES, GENDER_FILTERS, genderCategoryLabel, type GenderCategory, type GenderFilter } from '@/lib/gender';
import { fonts, radius } from '~/theme';
import { useTheme } from '~/use-theme';

/** Men's · Women's · All — a feed's view, opening on the viewer's own. */
export function GenderFilterChips({ value, onChange }: { value: GenderFilter; onChange: (v: GenderFilter) => void }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  return (
    <View style={styles.segment} accessibilityRole="radiogroup">
      {GENDER_FILTERS.map((g) => {
        const on = value === g.value;
        return (
          <Pressable
            key={g.value}
            onPress={() => onChange(g.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            style={[styles.segmentItem, on && styles.segmentItemOn]}>
            <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{g.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Men's / Women's — which competition a team belongs to. */
export function GenderCategoryPicker({
  value,
  onChange,
}: {
  value: GenderCategory | null;
  onChange: (v: GenderCategory) => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  return (
    <View style={styles.pickerRow}>
      {GENDER_CATEGORIES.map((g) => {
        const on = value === g.value;
        return (
          <Pressable key={g.value} onPress={() => onChange(g.value)} style={[styles.pick, on && styles.pickOn]}>
            <Text style={[styles.pickText, on && styles.pickTextOn]}>{g.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The small "Men's" / "Women's" label on a card. */
export function GenderBadge({ category }: { category: GenderCategory }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{genderCategoryLabel(category)}</Text>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    segment: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      backgroundColor: theme.surface2,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.pill,
      padding: 2,
    },
    segmentItem: { borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7 },
    segmentItemOn: { backgroundColor: theme.accent },
    segmentText: { color: theme.textSecondary, fontFamily: fonts.bold, fontSize: 12 },
    segmentTextOn: { color: '#fff' },
    pickerRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    pick: {
      borderRadius: radius.btn,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface2,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    pickOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    pickText: { color: theme.textSecondary, fontFamily: fonts.medium, fontSize: 14 },
    pickTextOn: { color: '#fff' },
    badge: {
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    badgeText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 10 },
  });
