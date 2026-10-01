import { router, Stack, type Href } from 'expo-router';

import { Icon, PressableScale } from './ui';

/**
 * A back button for screens opened with nothing behind them (a link, a push notification, a
 * deep link from the Approvals deck): the header's own back arrow only appears when there's a
 * screen to return to. This one replaces the screen with `to`, so back always goes somewhere.
 */
export function BackFallback({ to }: { to: Href }) {
  if (router.canGoBack()) return null;
  return (
    <Stack.Screen
      options={{
        headerLeft: () => (
          <PressableScale onPress={() => router.replace(to)} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}>
            <Icon name="chevron.left" size={22} weight="semibold" />
          </PressableScale>
        ),
      }}
    />
  );
}
