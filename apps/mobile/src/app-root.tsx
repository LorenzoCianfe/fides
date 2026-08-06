import { Screen, Spinner, ThemeProvider } from '@fides/ui-mobile';
import { StatusBar } from 'expo-status-bar';
import * as React from 'react';
import { hasSession } from './api/client';
import { I18nProvider, useTranslations } from './i18n';
import { NavigationProvider, useNavigation, type Route } from './navigation';
import { ActivityScreen } from './screens/activity';
import { DashboardScreen } from './screens/dashboard';
import { PasskeyScreen } from './screens/passkey';
import { SendScreen } from './screens/send';
import { SignInScreen } from './screens/sign-in';
import { SignUpScreen } from './screens/sign-up';
import { VerifyScreen } from './screens/verify';
import { WelcomeScreen } from './screens/welcome';

/**
 * Renders the active route. The switch is exhaustive by construction: adding a
 * variant to `Route` without a case here is a compile error, which is the whole
 * reason routes are a discriminated union.
 */
function CurrentScreen(): React.JSX.Element {
  const { route } = useNavigation();

  switch (route.name) {
    case 'welcome':
      return <WelcomeScreen />;
    case 'signUp':
      return <SignUpScreen />;
    case 'verify':
      return <VerifyScreen email={route.email} />;
    case 'passkey':
      return <PasskeyScreen userId={route.userId} enrolmentToken={route.enrolmentToken} />;
    case 'signIn':
      return <SignInScreen />;
    case 'dashboard':
      return <DashboardScreen />;
    case 'send':
      return <SendScreen />;
    case 'activity':
      return <ActivityScreen walletId={route.walletId} />;
  }
}

function Loading(): React.JSX.Element {
  const t = useTranslations();
  return (
    <Screen scroll={false}>
      <Spinner label={t('app.name')} />
    </Screen>
  );
}

/**
 * Decides where the app opens. Reading the keystore is asynchronous, so the
 * first frame cannot know whether there is a session — showing the welcome
 * screen and then yanking a returning user to the dashboard would be worse
 * than a brief spinner.
 */
function Router(): React.JSX.Element {
  const [initial, setInitial] = React.useState<Route | null>(null);

  React.useEffect(() => {
    let active = true;
    hasSession()
      .then((signedIn) => {
        if (active) setInitial(signedIn ? { name: 'dashboard' } : { name: 'welcome' });
      })
      .catch(() => {
        // An unreadable keystore is not a reason to fail to start: treat it as
        // "no session" and let the user sign in again.
        if (active) setInitial({ name: 'welcome' });
      });
    return () => {
      active = false;
    };
  }, []);

  if (!initial) return <Loading />;
  return (
    <NavigationProvider initial={initial}>
      <CurrentScreen />
    </NavigationProvider>
  );
}

export function AppRoot(): React.JSX.Element {
  return (
    <ThemeProvider>
      <I18nProvider>
        <Router />
        <StatusBar style="auto" />
      </I18nProvider>
    </ThemeProvider>
  );
}
