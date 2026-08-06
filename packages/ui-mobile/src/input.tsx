import { radius, spacing, typography } from '@fides/ui-tokens';
import * as React from 'react';
import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native';
import { useTheme } from './theme';
import { Typography } from './text';

export interface InputProps extends TextInputProps {
  label: string;
  hint?: string;
  error?: string;
}

/**
 * A labelled text field. The label is always rendered rather than used as a
 * placeholder: placeholder-as-label disappears exactly when the user is typing
 * and needs it, and screen readers treat the two very differently.
 */
export function Input({ label, hint, error, style, ...props }: InputProps): React.JSX.Element {
  const theme = useTheme();

  return (
    <View style={styles.group}>
      <Typography variant="label" tone="secondary">
        {label}
      </Typography>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.colors.textMuted}
        style={[
          styles.field,
          {
            backgroundColor: theme.colors.surface,
            borderColor: error ? theme.colors.negative : theme.colors.border,
            color: theme.colors.textPrimary,
          },
          style,
        ]}
        {...props}
      />
      {error ? (
        <Typography variant="caption" tone="negative">
          {error}
        </Typography>
      ) : hint ? (
        <Typography variant="caption" tone="muted">
          {hint}
        </Typography>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: spacing[2],
  },
  field: {
    height: 48,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    fontSize: typography.scale.body.fontSize,
  },
});
