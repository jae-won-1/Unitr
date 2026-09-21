// Brand tokens, mirroring the web app's palette.
//
// #008000 is the UI green the web app uses throughout; #00E676 is the brighter
// green reserved for the home-screen icon artwork, used here for accents and
// focus states where the darker green would disappear against a dark surface.
export const theme = {
  green: '#008000',
  greenBright: '#00E676',
  bg: '#0b0f0b',
  surface: '#141a14',
  border: '#243024',
  text: '#e8efe8',
  textDim: '#9aa79a',
  textFaint: '#7d887d',
  danger: '#ff6b6b',
} as const;
