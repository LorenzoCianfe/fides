import { darkTheme, lightTheme, type Theme } from '@fides/ui-tokens';
import * as React from 'react';
import { useColorScheme } from 'react-native';

const ThemeContext = React.createContext<Theme | null>(null);

/**
 * Resolves the token theme from the OS appearance setting.
 *
 * Components read this rather than importing `lightTheme` directly, which is
 * what lets the same component render correctly in both appearances. `override`
 * exists so a screenshot or a test can pin an appearance without touching the
 * device setting.
 */
export function ThemeProvider({
  children,
  override,
}: {
  children: React.ReactNode;
  override?: Theme;
}): React.JSX.Element {
  const scheme = useColorScheme();
  const theme = override ?? (scheme === 'dark' ? darkTheme : lightTheme);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

/**
 * The active theme. Falls back to light rather than throwing: a missing
 * provider should render a readable screen, not a crash.
 */
export function useTheme(): Theme {
  return React.useContext(ThemeContext) ?? lightTheme;
}
