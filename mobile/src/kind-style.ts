// The React Native counterpart to KIND_STYLE in lib/calendar-entries.ts.
//
// That constant has to stay web-only because it names Tailwind CLASSES
// ("bg-[#E7F8EC]", "text-accent-ink"), which mean nothing to RN. The VALUES,
// though, are the same rebrand tints, so they are transcribed here rather than
// re-chosen — every light-mode hex below is the literal colour that class
// resolves to, including the palette steps (indigo-700 = #4338CA and so on).
//
// Everything else about a calendar entry — which kind it is, its badge, its
// ordering — comes from the shared module. This file is presentation only.
//
// If a tint changes in lib/calendar-entries.ts, change it here too. It is the
// one place the two clients can drift on colour, which is why it is a single
// small table rather than tints scattered through the screens.

export type KindTint = {
  /** Badge text, and the entry's accent colour. */
  text: string;
  /** Pale badge outline, pairing with `bg`. */
  border: string;
  /** Pale badge fill. */
  bg: string;
  /** Solid hue: the card's left rule and the month-grid dot. */
  rule: string;
};

const LIGHT = {
  friendly: { text: '#0E7A3C', border: '#B7E8C6', bg: '#E7F8EC', rule: '#008000' },
  tournament: { text: '#B07400', border: '#F5DCA6', bg: '#FFF6E3', rule: '#F0A500' },
  my_post: { text: '#4338CA', border: '#C7D2FE', bg: '#EEF2FF', rule: '#6366F1' },
  ringer: { text: '#C2410C', border: '#FED7AA', bg: '#FFF7ED', rule: '#F97316' },
  booking: { text: '#335FFF', border: '#C6D4FF', bg: '#EAF0FF', rule: '#335FFF' },
} as const;

// Dark mode has no web counterpart to copy — the web app has no dark theme.
// Each kind keeps its identifying hue (so a tournament is still amber and a
// booking still blue) but lightened enough to read on a dark surface, over a
// low-alpha fill of that same hue instead of the pale tint, which would glare.
const DARK = {
  friendly: { text: '#4ADE80', border: '#1F5C3A', bg: 'rgba(74,222,128,0.12)', rule: '#00E676' },
  tournament: { text: '#FBBF24', border: '#6B4E00', bg: 'rgba(251,191,36,0.12)', rule: '#F0A500' },
  my_post: { text: '#A5B4FC', border: '#3730A3', bg: 'rgba(165,180,252,0.12)', rule: '#818CF8' },
  ringer: { text: '#FDBA74', border: '#7C2D12', bg: 'rgba(253,186,116,0.12)', rule: '#FB923C' },
  booking: { text: '#93B4FF', border: '#1E3A8A', bg: 'rgba(147,180,255,0.12)', rule: '#5B7FFF' },
} as const;

export function kindTints(dark: boolean): Record<keyof typeof LIGHT, KindTint> {
  return dark ? DARK : LIGHT;
}
