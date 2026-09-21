// Brand tokens — mirrors tailwind.config.ts / app/globals.css exactly, not a
// mobile reinterpretation of them. Same source (the rebrand artboards), same
// names where RN has a use for them, so a color changed on web is a color to
// change here too, not a design decision to make twice.
//
// One thing does NOT carry over as a straight copy: web's --background /
// --surface pair (bg #F4F6FB, cards #FFFFFF) is light-mode only — the web app
// has no dark mode to branch on. This file adds that branch, because a phone
// user's OS dark mode is a real, common state a browser tab mostly avoids.
// Every color below still traces back to a tailwind.config.ts token; dark is
// an extension of the same palette, not a departure from it.
export const colors = {
  light: {
    accent: '#008000',
    accent2: '#335FFF',
    accentInk: '#0E7A3C',
    background: '#F4F6FB',
    surface: '#FFFFFF',
    surface2: '#E9EDF6',
    border: '#DCE2EF',
    textPrimary: '#0B1526',
    textSecondary: '#5A6478',
    danger: '#E23D3D',
    panel: '#F9FAFD',
    successBg: '#EAF6EC',
    successBorder: '#BFE3C7',
    // Tinted navy rather than pure black, so a sheet reads as sitting over the
    // app instead of over a void — the web comment on this token, kept.
    scrim: 'rgba(11,21,38,0.55)',
  },
  dark: {
    accent: '#00E676', // the brighter green the web app reserves for the home-screen icon; used as the accent fill here because #008000 reads as near-black on a dark surface
    accent2: '#5B7FFF',
    accentInk: '#3ED17B',
    background: '#0B1120',
    surface: '#141B2E',
    surface2: '#1B2438',
    border: '#2A3450',
    textPrimary: '#F4F6FB',
    textSecondary: '#9AA7C7',
    danger: '#FF6B6B',
    panel: '#111826',
    successBg: '#123322',
    successBorder: '#1F5C3A',
    scrim: 'rgba(0,0,0,0.6)',
  },
} as const;

// tailwind.config.ts fixes exactly three radii and nothing else — reused
// verbatim rather than picking new numbers for RN.
export const radius = { btn: 12, card: 16, pill: 999 } as const;

// The rebrand's one card shadow. Deliberately near-invisible — the border does
// the separating work, matching the web comment on this token almost word for
// word.
export const cardShadow = {
  shadowColor: '#0B1526',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.04,
  shadowRadius: 2,
  elevation: 1,
} as const;

// Poppins 400–800, matching app/layout.tsx's next/font/google config. Loaded
// via expo-font in _layout.tsx; these are the family names registered there.
export const fonts = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
  extrabold: 'Poppins_800ExtraBold',
} as const;
