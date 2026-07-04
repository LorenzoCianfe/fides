import { radius, spacing } from './scales';
import type { Theme } from './theme';

function toKebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** Semantic color roles of a theme as CSS custom properties. */
export function themeToCssVars(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [role, value] of Object.entries(theme.colors)) {
    vars[`--color-${toKebab(role)}`] = value;
  }
  return vars;
}

/** Theme-independent spacing and radius tokens as CSS custom properties. */
export function staticTokensToCssVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(spacing)) {
    vars[`--space-${key}`] = `${value}px`;
  }
  for (const [key, value] of Object.entries(radius)) {
    vars[`--radius-${key}`] = `${value}px`;
  }
  return vars;
}

/** Render a full CSS variable block for a theme under `selector`. */
export function themeToCss(theme: Theme, selector = ':root'): string {
  const entries = { ...themeToCssVars(theme), ...staticTokensToCssVars() };
  const body = Object.entries(entries)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n');
  return `${selector} {\n${body}\n}`;
}
