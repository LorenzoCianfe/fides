/**
 * Raw color palette. UI code never references these directly — it uses the
 * semantic roles in `theme.ts`, so rebranding or retheming is centralized.
 *
 * Direction (design.md): minimal and trustworthy. Warm near-black ink, off-white
 * surfaces, a single restrained deep-green accent, muted semantic colors.
 */
export const palette = {
  white: '#FFFFFF',
  black: '#0B0B0C',
  ink: '#111311', // warm near-black

  gray: {
    50: '#F7F7F6',
    100: '#EEEEEC',
    200: '#E2E2DF',
    300: '#CBCBC7',
    400: '#A6A6A1',
    500: '#7C7C77',
    600: '#5A5A56',
    700: '#3F3F3C',
    800: '#262625',
    900: '#161615',
  },

  green: {
    // restrained, confident accent
    100: '#C9E7DC',
    400: '#3FA588',
    500: '#0E7A5F',
    600: '#0B6650',
    700: '#094F3F',
  },

  red: { 100: '#F6E3E1', 400: '#D6706A', 500: '#B4453C' },
  amber: { 100: '#F7ECD6', 400: '#D9A441', 500: '#B7791F' },
  blue: { 100: '#DDE8F1', 400: '#6FA0C8', 500: '#2B5F8A' },
} as const;
