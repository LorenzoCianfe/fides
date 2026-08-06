import { radius, spacing } from '@fides/ui-tokens';
import * as React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, View, type ViewProps } from 'react-native';
import { useTheme } from './theme';

/** Keys of the shared spacing scale, so a gap can only be a scale step. */
export type StackGap = keyof typeof spacing;

export interface StackProps extends ViewProps {
  gap?: StackGap;
}

/** Vertical flow with a token-scaled gap. */
export function Stack({ gap = 4, style, ...props }: StackProps): React.JSX.Element {
  return <View style={[{ gap: spacing[gap] }, style]} {...props} />;
}

/** Elevated surface for grouped content. */
export function Card({ style, ...props }: ViewProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        style,
      ]}
      {...props}
    />
  );
}

export interface ScreenProps extends ViewProps {
  /**
   * Scrolls the content. On by default because a form on a small device with
   * the keyboard raised is otherwise unreachable below the fold.
   */
  scroll?: boolean;
}

/** Screen shell: safe area, background, and consistent padding. */
export function Screen({
  scroll = true,
  style,
  children,
  ...props
}: ScreenProps): React.JSX.Element {
  const theme = useTheme();
  const content = (
    <View style={[styles.content, style]} {...props}>
      {children}
    </View>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    padding: spacing[5],
    gap: spacing[6],
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing[5],
  },
});
