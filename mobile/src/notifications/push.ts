import Constants from 'expo-constants';
import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';
import { useSyncExternalStore } from 'react';

import { api } from '@/state/store';

import { parsePushPayload } from './payload';
import { isWorkKind } from './preferences';

/**
 * Device-side push: permission, token registration, and foreground presentation. What
 * gets pushed is the server's decision; this module only makes the device reachable.
 *
 * `expo-notifications` is loaded lazily and guarded: if its native module is missing
 * (a client built without it), push reports `unavailable` with the reason instead of
 * crashing the app. Expo Go (SDK 57) does include it: local notifications work there,
 * but remote push tokens do not on Android, which is reported the same way.
 */

type NotificationsModule = typeof import('expo-notifications');

let loaded: { mod: NotificationsModule } | { mod: null; reason: string } | undefined;

/** The native module, or null with `pushStatus().problem` explaining why. */
export function notificationsModule(): NotificationsModule | null {
  if (!loaded && Platform.OS === 'web') {
    // expo-notifications' native methods (getLastNotificationResponse, permissions, tokens)
    // throw on web. Push is an iOS/Android feature here, so say so instead of crashing.
    loaded = { mod: null, reason: 'Push notifications are only available in the iOS and Android apps.' };
    setStatus({ permission: 'unavailable', problem: loaded.reason });
  }
  if (!loaded) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      loaded = { mod: require('expo-notifications') as NotificationsModule };
    } catch (error) {
      loaded = { mod: null, reason: `Notifications aren't available in this build (${error instanceof Error ? error.message : String(error)}).` };
      setStatus({ permission: 'unavailable', problem: loaded.reason });
    }
  }
  return loaded.mod;
}

// MARK: status

export type PushPermission = 'unknown' | 'undetermined' | 'granted' | 'denied' | 'unavailable';

export type PushStatus = {
  permission: PushPermission;
  /** False once the OS will no longer show the prompt; the only way back is system Settings. */
  canAskAgain: boolean;
  /** The token this device registered with the server, once it has. */
  token: string | null;
  /** Why push is not fully working, in words for the settings screen. Null when it is. */
  problem: string | null;
};

let status: PushStatus = { permission: 'unknown', canAskAgain: true, token: null, problem: null };
const listeners = new Set<() => void>();

function setStatus(patch: Partial<PushStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}

export const pushStatus = () => status;

export function usePushStatus(): PushStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

// MARK: permission & token

type Permissions = Awaited<ReturnType<NotificationsModule['getPermissionsAsync']>>;

function applyPermissions(p: Permissions) {
  setStatus({ permission: p.granted ? 'granted' : p.status === 'undetermined' ? 'undetermined' : 'denied', canAskAgain: p.canAskAgain });
}

/** Reads the current permission (never prompts) and registers the token if granted. */
export async function refreshPushStatus(): Promise<PushStatus> {
  const N = notificationsModule();
  if (!N) return status;
  applyPermissions(await N.getPermissionsAsync());
  if (status.permission === 'granted') await registerPushToken();
  return status;
}

/**
 * Shows the OS prompt if it still can, then registers the token. Call this at a moment
 * that explains itself (the user just followed a project, or tapped "Turn on" in
 * settings), never on launch.
 */
export async function requestPushPermission(): Promise<PushStatus> {
  const N = notificationsModule();
  if (!N) return status;
  applyPermissions(await N.requestPermissionsAsync());
  if (status.permission === 'granted') await registerPushToken();
  return status;
}

/** True when the OS prompt has never been shown; the only state where asking is free. */
export async function shouldAskForPush(): Promise<boolean> {
  const N = notificationsModule();
  if (!N) return false;
  const p = await N.getPermissionsAsync();
  return !p.granted && p.status === 'undetermined' && p.canAskAgain;
}

function easProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

/**
 * Gets this device's Expo push token and registers it with the server. Failures land in
 * `status.problem` (shown in settings) and the console, not thrown: a device that can't
 * get a remote token can still show local notifications.
 */
export async function registerPushToken(): Promise<void> {
  const N = notificationsModule();
  if (!N || status.permission !== 'granted') return;
  const fail = (problem: string) => {
    console.warn(`[push] ${problem}`);
    setStatus({ problem });
  };
  if (isRunningInExpoGo() && Platform.OS === 'android') {
    return fail('Expo Go on Android cannot receive remote pushes; use a development build. Local notifications still work.');
  }
  const projectId = easProjectId();
  if (!projectId) {
    return fail('No EAS project id configured (expo.extra.eas.projectId), so this device has no push token. Local notifications still work.');
  }
  try {
    const { data: token } = await N.getExpoPushTokenAsync({ projectId });
    await api.registerPushToken({ token, provider: 'expo', platform: Platform.OS === 'ios' ? 'ios' : 'android' });
    setStatus({ token, problem: null });
  } catch (error) {
    fail(`Couldn't register for push: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Removes this device from the server. Call on sign-out, before the session is dropped. */
export async function unregisterPush(): Promise<void> {
  if (!status.token) return;
  await api.unregisterPushToken(status.token);
  setStatus({ token: null });
}

// MARK: presentation

/**
 * How pushes show while the app is open. Every push is already one the user asked for
 * (the server applied their preferences), so all show as a banner; only blocked work and
 * review requests, which want a human now, make a sound.
 */
export function configureForegroundPresentation(N: NotificationsModule) {
  N.setNotificationHandler({
    handleNotification: async (notification) => {
      const parsed = parsePushPayload(notification.request.content.data);
      const urgent = parsed.ok && isWorkKind(parsed.payload.kind) && parsed.payload.kind !== 'shipped';
      return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: urgent, shouldSetBadge: false };
    },
  });
  if (Platform.OS === 'android') {
    void N.setNotificationChannelAsync('default', { name: 'Tardy work', importance: N.AndroidImportance.HIGH });
  }
}
