// What opens when a calendar entry is tapped.
//
// Basic detail for everyone, plus the availability answer for anything the
// viewer's squad is actually committed to, plus whichever management CTA they
// are entitled to. fixtureAction() from lib/calendar-entries decides that last
// part — shared, so the mobile sheet can never offer a captain something the
// web sheet would not, or miss something it would.
//
// The CTAs themselves route to screens that are not ported yet (Manage match,
// Submit result, Manage tournament, Edit post). They are shown GREYED with
// where to find them, rather than hidden: the house convention, and it also
// tells a captain the mobile app knows the action exists rather than implying
// the fixture has none.
//
// A z-index note that does not apply here: on the web every sheet is z-[60] to
// clear the nav. React Native's Modal renders above everything by construction,
// so there is nothing to coordinate.

import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import {
  fixtureAction,
  KIND_LABEL,
  type CalendarEntry,
} from '@/lib/calendar-entries';
import { fmtKickoff } from '@/lib/match-dates';
import { fonts, radius } from '~/theme';
import { kindTints } from '~/kind-style';
import { useIsDark, useTheme } from '~/use-theme';
import { AvailabilityButtons } from '~/components/availability-buttons';

const money = (pence: number) => `£${(pence / 100).toFixed(2).replace(/\.00$/, '')}`;

export function FixtureDetailSheet({
  entry,
  isCaptain,
  viewerId,
  viewerTeamId,
  onClose,
}: {
  entry: CalendarEntry | null;
  isCaptain: boolean;
  viewerId: string;
  viewerTeamId: string | null;
  onClose: () => void;
}) {
  const theme = useTheme();
  const dark = useIsDark();
  const styles = makeStyles(theme);

  if (!entry) return null;

  const tint = kindTints(dark)[entry.kind];
  const action = fixtureAction(entry, isCaptain);

  // Availability is asked for things the squad is committed to — a confirmed
  // friendly (keyed on match_id) or an entered tournament (open_match_id).
  // A tournament the team only HOSTS carries no answer: organising is not
  // entering, so `hosting` rules it out even when openMatchId is present.
  const availabilityTarget =
    entry.matchId || (entry.openMatchId && !entry.hosting)
      ? { matchId: entry.matchId, openMatchId: entry.hosting ? null : entry.openMatchId }
      : null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={onClose} />

        <View style={styles.sheet}>
          <View style={styles.grabber} />

          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <View style={styles.headRow}>
              <View style={[styles.badge, { backgroundColor: tint.bg, borderColor: tint.border }]}>
                <Text style={[styles.badgeText, { color: tint.text }]}>
                  {KIND_LABEL[entry.kind]}
                </Text>
              </View>
              <Pressable onPress={onClose} hitSlop={10}>
                <Ionicons name="close" size={22} color={theme.textSecondary} />
              </Pressable>
            </View>

            <Text style={styles.title}>{entry.title}</Text>
            {entry.subtitle && <Text style={styles.subtitle}>{entry.subtitle}</Text>}

            <View style={styles.facts}>
              <Fact icon="time-outline" theme={theme} styles={styles}>
                {fmtKickoff(entry.date, entry.time)}
              </Fact>
              {entry.pitch && (
                <Fact icon="football-outline" theme={theme} styles={styles}>
                  {entry.pitch}
                </Fact>
              )}
              {entry.address && (
                <Fact icon="location-outline" theme={theme} styles={styles}>
                  {entry.address}
                </Fact>
              )}
              {entry.pricePence != null && (
                <Fact icon="card-outline" theme={theme} styles={styles}>
                  {money(entry.pricePence)}
                </Fact>
              )}
              {entry.badge && (
                <Fact icon="information-circle-outline" theme={theme} styles={styles}>
                  {entry.badge}
                </Fact>
              )}
            </View>

            {entry.result && (
              <View style={styles.resultBox}>
                <Text style={styles.resultScore}>
                  {entry.result.teamScore} – {entry.result.opponentScore}
                </Text>
                <Text style={styles.resultNote}>
                  {entry.result.verified
                    ? 'Confirmed by both captains'
                    : 'Awaiting the other captain’s score'}
                </Text>
              </View>
            )}

            {availabilityTarget && viewerTeamId && entry.isUpcoming && (
              <View style={styles.availability}>
                <AvailabilityButtons
                  target={availabilityTarget}
                  playerId={viewerId}
                  teamId={viewerTeamId}
                />
              </View>
            )}

            {action && (
              // Greyed rather than hidden — the screen it opens is not ported.
              <View style={styles.ctaBox}>
                <View style={styles.ctaDisabled}>
                  <Text style={styles.ctaDisabledText}>{action.label}</Text>
                </View>
                <Text style={styles.ctaNote}>
                  Available on the web app for now.
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Fact({
  icon,
  children,
  theme,
  styles,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  children: string;
  theme: ReturnType<typeof useTheme>;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.factRow}>
      <Ionicons name={icon} size={16} color={theme.textSecondary} />
      <Text style={styles.factText}>{children}</Text>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: theme.scrim, justifyContent: 'flex-end' },
    backdropTap: { flex: 1 },
    sheet: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '85%',
      paddingBottom: 30,
    },
    grabber: {
      alignSelf: 'center',
      width: 38,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.border,
      marginTop: 10,
      marginBottom: 4,
    },
    body: { paddingHorizontal: 20, paddingTop: 10, gap: 4 },
    headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    badge: { borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
    badgeText: { fontFamily: fonts.semibold, fontSize: 11 },
    title: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 21, marginTop: 12 },
    subtitle: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 14, marginTop: 2 },
    facts: { gap: 9, marginTop: 18 },
    factRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
    factText: { color: theme.textPrimary, fontFamily: fonts.medium, fontSize: 14, flexShrink: 1 },
    resultBox: {
      backgroundColor: theme.panel,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.card,
      padding: 14,
      alignItems: 'center',
      marginTop: 18,
    },
    resultScore: { color: theme.textPrimary, fontFamily: fonts.extrabold, fontSize: 26 },
    resultNote: { color: theme.textSecondary, fontFamily: fonts.regular, fontSize: 12, marginTop: 3 },
    availability: {
      marginTop: 22,
      paddingTop: 18,
      borderTopWidth: 1,
      borderTopColor: theme.border,
    },
    ctaBox: {
      marginTop: 22,
      paddingTop: 18,
      borderTopWidth: 1,
      borderTopColor: theme.border,
      gap: 6,
    },
    ctaDisabled: {
      backgroundColor: theme.surface2,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.btn,
      paddingVertical: 14,
      alignItems: 'center',
    },
    ctaDisabledText: { color: theme.textSecondary, fontFamily: fonts.semibold, fontSize: 15 },
    ctaNote: {
      color: theme.textSecondary,
      fontFamily: fonts.regular,
      fontSize: 12,
      textAlign: 'center',
    },
  });
