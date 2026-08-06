import { typography } from '@fides/ui-tokens';
import * as React from 'react';
import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';
import { useTheme } from './theme';

type Variant = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption';
type Tone = 'primary' | 'secondary' | 'muted' | 'negative' | 'positive';

export interface TypographyProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
}

/**
 * Text bound to the shared type scale and colour roles, so a screen never picks
 * a raw font size or hex value. `fontWeight` comes off the scale as a number
 * and React Native wants a string, hence the cast at the single point it is
 * needed rather than at every call site.
 */
export function Typography({
  variant = 'body',
  tone = 'primary',
  style,
  ...props
}: TypographyProps): React.JSX.Element {
  const theme = useTheme();
  const scale = typography.scale[variant];

  const color: Record<Tone, string> = {
    primary: theme.colors.textPrimary,
    secondary: theme.colors.textSecondary,
    muted: theme.colors.textMuted,
    negative: theme.colors.negative,
    positive: theme.colors.positive,
  };

  const base: TextStyle = {
    fontSize: scale.fontSize,
    lineHeight: scale.lineHeight,
    fontWeight: String(scale.fontWeight) as TextStyle['fontWeight'],
    letterSpacing: scale.letterSpacing,
    color: color[tone],
  };

  return <Text style={StyleSheet.compose(base, style)} {...props} />;
}
