import { palette } from './colors';

/**
 * Semantic color roles. Components reference these — never raw palette values —
 * so light/dark theming and rebranding stay centralized. Semantic direction
 * colors (positive/negative) are reserved for money direction and status.
 */
export interface ColorRoles {
  readonly background: string;
  readonly surface: string;
  readonly surfaceMuted: string;
  readonly border: string;
  readonly borderStrong: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly textMuted: string;
  readonly textInverse: string;
  readonly accent: string;
  readonly accentHover: string;
  readonly accentContrast: string;
  readonly positive: string;
  readonly negative: string;
  readonly warning: string;
  readonly info: string;
  readonly focusRing: string;
}

export type ThemeName = 'light' | 'dark';

export interface Theme {
  readonly name: ThemeName;
  readonly colors: ColorRoles;
}

export const lightTheme: Theme = {
  name: 'light',
  colors: {
    background: palette.gray[50],
    surface: palette.white,
    surfaceMuted: palette.gray[100],
    border: palette.gray[200],
    borderStrong: palette.gray[300],
    textPrimary: palette.ink,
    textSecondary: palette.gray[600],
    textMuted: palette.gray[500],
    textInverse: palette.white,
    accent: palette.green[600],
    accentHover: palette.green[700],
    accentContrast: palette.white,
    positive: palette.green[600],
    negative: palette.red[500],
    warning: palette.amber[500],
    info: palette.blue[500],
    focusRing: palette.green[600],
  },
};

export const darkTheme: Theme = {
  name: 'dark',
  colors: {
    background: '#0E0E0F',
    surface: '#161617',
    surfaceMuted: '#1E1E20',
    border: '#2A2A2C',
    borderStrong: '#3A3A3D',
    textPrimary: '#F3F3F1',
    textSecondary: palette.gray[300],
    textMuted: palette.gray[400],
    textInverse: palette.ink,
    accent: palette.green[500],
    accentHover: palette.green[400],
    accentContrast: palette.white,
    positive: palette.green[400],
    negative: palette.red[400],
    warning: palette.amber[400],
    info: palette.blue[400],
    focusRing: palette.green[400],
  },
};

export const themes: Readonly<Record<ThemeName, Theme>> = {
  light: lightTheme,
  dark: darkTheme,
};
