import { router, useRootNavigationState, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '@/state/auth';
import { api, getState, onUserFollow } from '@/state/store';

import {
  configureForegroundPresentation,
  notificationsModule,
  refreshPushStatus,
  registerPushToken,
  requestPushPermission,
  shouldAskForPush,
} from './push';
import { routeForPushData, type NotificationRoute } from './routing';

/** Navigates to a resolved route, saying so out loud when it had to fall back. */
function go(route: NotificationRoute) {
  router.push(route.href as Href);
  if (route.notice) Alert.alert('Notification', route.notice);
}

/** The user just followed `accountId`; if it's a project and we've never asked, ask now. */
async function askAfterProjectFollow(accountId: string) {
  const account = getState().accounts.get(accountId) ?? (await api.account(accountId));
  if (account.kind !== 'project') return;
  if (await shouldAskForPush()) await requestPushPermission();
}

/**
 * Everything push needs at the app root, mounted with one line in `app/_layout.tsx`:
 * foreground presentation, token registration when permission already exists (it never
 * prompts on launch), the permission ask after the user's first project follow, and
 * routing taps, including the tap that cold-started the app, to the right screen.
 */
export function usePushNotifications() {
  const navigationReady = useRootNavigationState()?.key !== undefined;
  // Tokens belong to a signed-in user, so registration waits for a session.
  const signedIn = useAuth((s) => s.status) === 'signed_in';
  const pending = useRef<NotificationRoute | null>(null);
  const handled = useRef(new Set<string>());
  const ready = useRef(false);

  useEffect(() => {
    ready.current = navigationReady;
    if (navigationReady && pending.current) {
      const route = pending.current;
      pending.current = null;
      go(route);
    }
  }, [navigationReady]);

  useEffect(() => {
    if (!signedIn || !notificationsModule()) return;
    refreshPushStatus().catch((e: unknown) => console.warn('[push] status refresh failed', e));
  }, [signedIn]);

  useEffect(() => {
    const unfollow = onUserFollow((id) => {
      askAfterProjectFollow(id).catch((e: unknown) => console.warn('[push] permission ask failed', e));
    });
    const N = notificationsModule();
    if (!N) return unfollow;

    configureForegroundPresentation(N);

    const open = (response: import('expo-notifications').NotificationResponse) => {
      const id = response.notification.request.identifier;
      if (handled.current.has(id)) return;
      handled.current.add(id);
      void routeForPushData(response.notification.request.content.data, api).then((route) => {
        if (ready.current) go(route);
        else pending.current = route;
      });
    };

    const taps = N.addNotificationResponseReceivedListener(open);
    // The tap that launched the app arrives before any listener exists.
    const launch = N.getLastNotificationResponse();
    if (launch) {
      open(launch);
      N.clearLastNotificationResponse();
    }
    const rotations = N.addPushTokenListener(() => {
      registerPushToken().catch((e: unknown) => console.warn('[push] re-registration failed', e));
    });

    return () => {
      unfollow();
      taps.remove();
      rotations.remove();
    };
  }, []);
}
