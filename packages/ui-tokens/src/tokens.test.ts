import { describe, expect, it } from 'vitest';
import { themeToCss, themeToCssVars } from './css';
import { spacing } from './scales';
import { darkTheme, lightTheme } from './theme';

describe('themes', () => {
  it('define the same set of color roles', () => {
    expect(Object.keys(lightTheme.colors).sort()).toEqual(Object.keys(darkTheme.colors).sort());
  });

  it('differentiate the accent between light and dark', () => {
    expect(lightTheme.colors.accent).not.toBe(darkTheme.colors.accent);
  });
});

describe('css generation', () => {
  it('maps color roles to kebab-cased custom properties', () => {
    const vars = themeToCssVars(lightTheme);
    expect(vars['--color-background']).toBe(lightTheme.colors.background);
    expect(vars['--color-text-primary']).toBe(lightTheme.colors.textPrimary);
    expect(vars['--color-focus-ring']).toBe(lightTheme.colors.focusRing);
  });

  it('renders a selector block with spacing tokens', () => {
    const css = themeToCss(darkTheme, ':root');
    expect(css.startsWith(':root {')).toBe(true);
    expect(css).toContain('--color-accent:');
    expect(css).toContain('--space-4: 16px;');
  });
});

describe('spacing scale', () => {
  it('is strictly increasing', () => {
    const values = Object.values(spacing);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1] as number);
    }
  });
});
