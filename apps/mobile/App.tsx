import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { Button, lightTheme, spacing } from '@fides/ui-mobile';

const appName = 'Fides';

export default function App() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.eyebrow}>{appName}</Text>
        <Text style={styles.title}>Money, made clear.</Text>
        <Text style={styles.body}>
          Phase 0 foundations are in place. This is the mobile shell, wired to the shared design
          tokens and component library.
        </Text>
        <Button title="Get started" />
      </View>
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: lightTheme.colors.background,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing[4],
    padding: spacing[6],
  },
  eyebrow: {
    color: lightTheme.colors.textMuted,
    textTransform: 'uppercase',
    fontSize: 12,
    letterSpacing: 1,
  },
  title: {
    color: lightTheme.colors.textPrimary,
    fontSize: 32,
    fontWeight: '600',
  },
  body: {
    color: lightTheme.colors.textSecondary,
    fontSize: 16,
    lineHeight: 24,
  },
});
