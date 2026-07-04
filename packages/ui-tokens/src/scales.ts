/**
 * Non-color primitive scales: typography, spacing, radius, elevation, motion,
 * and z-index. All values are theme-independent.
 */

export const typography = {
  fontFamilies: {
    sans: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  /** Applied to all monetary/numeric text so figures align in columns. */
  numericFeatureSettings: '"tnum" 1, "lnum" 1',
  scale: {
    display: { fontSize: 40, lineHeight: 48, fontWeight: 600, letterSpacing: -0.02 },
    title: { fontSize: 28, lineHeight: 34, fontWeight: 600, letterSpacing: -0.01 },
    heading: { fontSize: 20, lineHeight: 26, fontWeight: 600, letterSpacing: 0 },
    body: { fontSize: 16, lineHeight: 24, fontWeight: 400, letterSpacing: 0 },
    label: { fontSize: 14, lineHeight: 20, fontWeight: 500, letterSpacing: 0 },
    caption: { fontSize: 12, lineHeight: 16, fontWeight: 400, letterSpacing: 0 },
  },
} as const;

/** Spacing scale in pixels (4px base grid). */
export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

export const radius = {
  none: 0,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 9999,
} as const;

export const elevation = {
  none: 'none',
  sm: '0 1px 2px rgba(0, 0, 0, 0.06)',
  md: '0 2px 8px rgba(0, 0, 0, 0.08)',
  lg: '0 8px 24px rgba(0, 0, 0, 0.12)',
} as const;

export const motion = {
  duration: { fast: 120, base: 200, slow: 320 },
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    decelerate: 'cubic-bezier(0, 0, 0, 1)',
    accelerate: 'cubic-bezier(0.3, 0, 1, 1)',
  },
} as const;

export const zIndex = {
  base: 0,
  dropdown: 1000,
  sticky: 1100,
  overlay: 1200,
  modal: 1300,
  toast: 1400,
  tooltip: 1500,
} as const;
