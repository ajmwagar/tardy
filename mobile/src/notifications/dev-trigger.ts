import { MockTardyApi, type SimulatedPush } from '@/data/mock/mock-api';
import { NOTIFICATIONS } from '@/data/mock/fixtures';
import type { Notification } from '@/data/types';
import { api } from '@/state/store';

import { notificationsModule, pushStatus } from './push';

/**
 * DEV ONLY: exercise the whole push flow without a server. The mock decides exactly as
 * the server will (privacy first, then preferences), and if it would push, the same
 * title, body, and data are shown as a local notification. Tapping it goes through the
 * real routing.
 *
 * Runbook (what this automates): pick a notification event, check the viewer can see its
 * actor and post, apply their preferences (`decidePush`), send the push with the encoded
 * payload, tap it, confirm the screen it opens.
 */

export const devPushAvailable = () => __DEV__ && api instanceof MockTardyApi;

/** Every fixture event, including ones the viewer can't see (so refusal can be tried too). */
export const devPushEvents = (): readonly Notification[] => NOTIFICATIONS;

export type DevPushResult = { sent: boolean; push: SimulatedPush };

/**
 * Emits fixture notification `id` as a local notification after `delaySeconds` (use a
 * delay to background or kill the app and test the cold-start tap). Throws
 * `TardyApiError('forbidden')` when the viewer can't see the event: no push, ever.
 * Resolves `sent: false` when their preferences mute it.
 */
export async function emitDevPush(id: string, { delaySeconds = 0 } = {}): Promise<DevPushResult> {
  if (!__DEV__) throw new Error('emitDevPush is development-only');
  if (!(api instanceof MockTardyApi)) throw new Error('emitDevPush needs the mock backend');
  const N = notificationsModule();
  if (!N) throw new Error(pushStatus().problem ?? 'Notifications are unavailable in this build');

  const push = await api.simulatePush(id);
  if (!push.decision.push) return { sent: false, push };
  if (pushStatus().permission !== 'granted') throw new Error('Turn on notifications first; the OS will not show them otherwise.');

  await N.scheduleNotificationAsync({
    content: { title: push.title, body: push.body, data: push.data },
    trigger: delaySeconds > 0 ? { type: N.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: delaySeconds } : null,
  });
  return { sent: true, push };
}
