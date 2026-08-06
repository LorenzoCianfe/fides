import * as React from 'react';

/**
 * Navigation for eight linear screens.
 *
 * Deliberately not `expo-router`, which pulls roughly twenty packages for
 * file-based routing, deep links, and nested layouts this app has no use for —
 * a large surface to add immediately after ADR-0026 cleared 34 advisories. A
 * discriminated union gives the one property that actually matters here:
 * a screen cannot be reached without its parameters, checked at compile time.
 */
export type Route =
  | { name: 'welcome' }
  | { name: 'signUp' }
  | { name: 'verify'; email: string }
  | { name: 'passkey'; userId: string; enrolmentToken: string }
  | { name: 'signIn' }
  | { name: 'dashboard' }
  | { name: 'send' }
  | { name: 'activity'; walletId?: string };

export type RouteName = Route['name'];

interface NavigationValue {
  route: Route;
  /** Push a screen onto the stack. */
  navigate: (route: Route) => void;
  /** Pop back, or no-op at the root. */
  back: () => void;
  /** Replace the whole stack — used when signing in or out. */
  reset: (route: Route) => void;
  canGoBack: boolean;
}

const NavigationContext = React.createContext<NavigationValue | null>(null);

export function NavigationProvider({
  children,
  initial,
}: {
  children: React.ReactNode;
  initial: Route;
}): React.JSX.Element {
  const [stack, setStack] = React.useState<Route[]>([initial]);

  const value = React.useMemo<NavigationValue>(
    () => ({
      // The stack is never empty: every mutation below keeps at least one entry.
      route: stack[stack.length - 1] ?? initial,
      navigate: (route) => setStack((current) => [...current, route]),
      back: () => setStack((current) => (current.length > 1 ? current.slice(0, -1) : current)),
      reset: (route) => setStack([route]),
      canGoBack: stack.length > 1,
    }),
    [stack, initial],
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): NavigationValue {
  const value = React.useContext(NavigationContext);
  if (!value) throw new Error('useNavigation must be used inside a NavigationProvider');
  return value;
}

/**
 * The current route narrowed to one name. Screens take their parameters as
 * props instead, so this is only for the switch that renders them.
 */
export function useRoute(): Route {
  return useNavigation().route;
}
