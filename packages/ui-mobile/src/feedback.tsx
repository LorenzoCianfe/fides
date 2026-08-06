import { radius, spacing } from '@fides/ui-tokens';
import * as React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTheme } from './theme';
import { Typography } from './text';

export type AlertTone = 'info' | 'success' | 'error';

export interface AlertProps {
  tone?: AlertTone;
  children: React.ReactNode;
}

/**
 * A message about the last action. `accessibilityLiveRegion` matters here: an
 * error that appears after a failed submit is announced rather than silently
 * drawn somewhere the user is not looking.
 */
export function Alert({ tone = 'info', children }: AlertProps): React.JSX.Element {
  const theme = useTheme();
  const accent: Record<AlertTone, string> = {
    info: theme.colors.info,
    success: theme.colors.positive,
    error: theme.colors.negative,
  };

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'}
      style={[styles.alert, { borderColor: accent[tone], backgroundColor: theme.colors.surface }]}
    >
      <Typography variant="label" tone={tone === 'error' ? 'negative' : 'primary'}>
        {children}
      </Typography>
    </View>
  );
}

export interface SpinnerProps {
  /** Announced to assistive tech; also shown beside the indicator. */
  label: string;
}

export function Spinner({ label }: SpinnerProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={styles.spinner} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={theme.colors.accent} />
      <Typography variant="label" tone="secondary">
        {label}
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  alert: {
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: radius.md,
    padding: spacing[4],
  },
  spinner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
});
