import * as React from 'react';
import { Pressable, type PressableProps, StyleSheet, Text } from 'react-native';
import { lightTheme, radius, spacing, typography } from '@fides/ui-tokens';

export interface ButtonProps extends Omit<PressableProps, 'children'> {
  title: string;
  variant?: 'primary' | 'secondary';
}

/**
 * Seed React Native button, mapped to the same tokens as the web library.
 * Static light theme for now; a token-driven ThemeProvider arrives with the app.
 */
export function Button({ title, variant = 'primary', ...props }: ButtonProps) {
  const backgroundColor =
    variant === 'primary' ? lightTheme.colors.accent : lightTheme.colors.surfaceMuted;
  const color =
    variant === 'primary' ? lightTheme.colors.accentContrast : lightTheme.colors.textPrimary;

  return (
    <Pressable accessibilityRole="button" style={[styles.base, { backgroundColor }]} {...props}>
      <Text style={[styles.label, { color }]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 48,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: typography.scale.label.fontSize,
    fontWeight: '500',
  },
});
