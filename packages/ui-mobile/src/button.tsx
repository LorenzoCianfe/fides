import { radius, spacing, typography } from '@fides/ui-tokens';
import * as React from 'react';
import { ActivityIndicator, Pressable, type PressableProps, StyleSheet, Text } from 'react-native';
import { useTheme } from './theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  title: string;
  variant?: ButtonVariant;
  /** Shows a spinner in place of the label and blocks presses. */
  busy?: boolean;
}

/**
 * Primary action control, mapped to the same tokens as the web library.
 *
 * `busy` disables the button as well as showing the spinner: on a money-moving
 * screen, a second tap during an in-flight request is exactly the input that
 * turns one intent into two requests.
 */
export function Button({
  title,
  variant = 'primary',
  disabled = false,
  busy = false,
  ...props
}: ButtonProps): React.JSX.Element {
  const theme = useTheme();
  const blocked = disabled || busy;

  const background: Record<ButtonVariant, string> = {
    primary: theme.colors.accent,
    secondary: theme.colors.surfaceMuted,
    ghost: 'transparent',
  };
  const foreground: Record<ButtonVariant, string> = {
    primary: theme.colors.accentContrast,
    secondary: theme.colors.textPrimary,
    ghost: theme.colors.accent,
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy }}
      disabled={blocked}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: background[variant],
          borderColor: variant === 'ghost' ? 'transparent' : background[variant],
          opacity: blocked ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
      {...props}
    >
      {busy ? (
        <ActivityIndicator color={foreground[variant]} />
      ) : (
        <Text style={[styles.label, { color: foreground[variant] }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 48,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: typography.scale.label.fontSize,
    fontWeight: '500',
  },
});
