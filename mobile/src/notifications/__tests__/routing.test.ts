import { TardyApiError, type TardyApi } from '@/data/api';
import { MockTardyApi } from '@/data/mock/mock-api';
import { NOTIFICATIONS } from '@/data/mock/fixtures';
import type { NotificationKind } from '@/data/types';

import { encodePushPayload, parsePushPayload, payloadFor, type PushPayload } from '../payload';
import { NOTIFICATION_KINDS } from '../preferences';
import { DESTINATION, NOTIFICATIONS_HREF, routeForPayload, routeForPushData } from '../routing';

const mock = () => new MockTardyApi({ latencyMs: 0 });
const fixture = (id: string) => payloadFor(NOTIFICATIONS.find((n) => n.id === id)!);

describe('routeForPayload: every kind lands where it should', () => {
  const api = mock();

  const cases: [NotificationKind, PushPayload, unknown][] = [
    ['like', { notificationId: 'x', kind: 'like', actorId: 'avery', postId: 'post-1' }, { pathname: '/post/[postId]', params: { postId: 'post-1' } }],
    ['comment', { notificationId: 'x', kind: 'comment', actorId: 'avery', postId: 'post-5' }, { pathname: '/comments/[postId]', params: { postId: 'post-5' } }],
    ['mention', { notificationId: 'x', kind: 'mention', actorId: 'a-fw', postId: 'post-13' }, { pathname: '/comments/[postId]', params: { postId: 'post-13' } }],
    ['follow', { notificationId: 'x', kind: 'follow', actorId: 'a-quote' }, { pathname: '/profile/[handle]', params: { handle: 'fable.quotes' } }],
    ['shipped', { notificationId: 'x', kind: 'shipped', actorId: 'a-opus-be', postId: 'post-1' }, { pathname: '/post/[postId]', params: { postId: 'post-1' } }],
    ['blocked', { notificationId: 'x', kind: 'blocked', actorId: 'a-opus-be', postId: 'post-3' }, { pathname: '/post/[postId]', params: { postId: 'post-3' } }],
    ['review_requested', { notificationId: 'x', kind: 'review_requested', actorId: 'a-sonnet-ui', postId: 'post-6' }, { pathname: '/post/[postId]', params: { postId: 'post-6' } }],
  ];

  it('covers every kind', () => {
    expect(cases.map(([k]) => k).sort()).toEqual([...NOTIFICATION_KINDS].sort());
    expect(Object.keys(DESTINATION).sort()).toEqual([...NOTIFICATION_KINDS].sort());
  });

  it.each(cases)('%s', async (_kind, payload, href) => {
    await expect(routeForPayload(payload, api)).resolves.toEqual({ href });
  });

  it('routes the visible fixtures without a notice', async () => {
    for (const id of ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9']) {
      const route = await routeForPayload(fixture(id), api);
      expect(route.notice).toBeUndefined();
    }
  });
});

describe('routeForPayload: targets that are gone', () => {
  it('a deleted post lands on the notifications list with a notice', async () => {
    const route = await routeForPayload({ notificationId: 'x', kind: 'blocked', actorId: 'a-bom', postId: 'post-deleted' }, mock());
    expect(route).toEqual({ href: NOTIFICATIONS_HREF, notice: 'That tardy was deleted.' });
  });

  it('a post-kind push missing its post id lands on the list', async () => {
    const route = await routeForPayload({ notificationId: 'x', kind: 'review_requested', actorId: 'a-sonnet-ui' }, mock());
    expect(route.href).toBe(NOTIFICATIONS_HREF);
    expect(route.notice).toMatch(/has no post/);
  });

  it('a post the viewer can no longer see does not open', async () => {
    // n10 is from the private Panopticon project, which the fixture viewer is outside of
    // (say the project narrowed after the push went out). Its owner can still open it.
    const owner = new MockTardyApi({ latencyMs: 0, viewerId: 'avery' });
    await expect(routeForPayload(fixture('n10'), owner)).resolves.toMatchObject({ href: { pathname: '/post/[postId]' } });
    const route = await routeForPayload(fixture('n10'), mock());
    expect(route).toEqual({ href: NOTIFICATIONS_HREF, notice: 'You no longer have access to that tardy.' });
  });

  it('a follower who has since vanished lands on the list', async () => {
    const route = await routeForPayload({ notificationId: 'x', kind: 'follow', actorId: 'nobody' }, mock());
    expect(route).toEqual({ href: NOTIFICATIONS_HREF, notice: 'That profile was deleted.' });
  });

  it('a network failure still lands somewhere, and says why', async () => {
    const down: Pick<TardyApi, 'post' | 'account'> = {
      post: () => Promise.reject(new Error('offline')),
      account: () => Promise.reject(new TardyApiError('not_found', 'x')),
    };
    const route = await routeForPayload(fixture('n1'), down);
    expect(route).toEqual({ href: NOTIFICATIONS_HREF, notice: "Couldn't open that tardy: offline" });
  });
});

describe('push payload wire format', () => {
  it('round-trips through encode and parse', () => {
    for (const n of NOTIFICATIONS) {
      expect(parsePushPayload(encodePushPayload(payloadFor(n)))).toEqual({ ok: true, payload: payloadFor(n) });
    }
  });

  it('is snake_case and versioned', () => {
    expect(encodePushPayload(fixture('n3'))).toEqual({ v: 1, notification_id: 'n3', kind: 'blocked', actor_id: 'a-opus-be', post_id: 'post-3' });
  });

  it.each([
    [null, 'push has no data'],
    [{ v: 2, notification_id: 'n', kind: 'like', actor_id: 'a' }, 'unsupported push payload version 2'],
    [{ v: 1, notification_id: 'n', kind: 'poke', actor_id: 'a' }, 'unknown notification kind poke'],
    [{ v: 1, notification_id: 'n', kind: 'like' }, 'push payload has no actor_id'],
    [{ v: 1, notification_id: 'n', kind: 'like', actor_id: 'a', post_id: 7 }, 'push payload has a malformed post_id'],
  ])('rejects %j', (data, reason) => {
    expect(parsePushPayload(data)).toEqual({ ok: false, reason });
  });

  it('malformed push data routes to the list with the reason', async () => {
    const route = await routeForPushData({ v: 1, kind: 'shipped' }, mock());
    expect(route).toEqual({ href: NOTIFICATIONS_HREF, notice: "Couldn't open that notification (push payload has no notification_id)." });
  });

  it('raw push data routes like the payload it encodes', async () => {
    const route = await routeForPushData(encodePushPayload(fixture('n5')), mock());
    expect(route).toEqual({ href: { pathname: '/profile/[handle]', params: { handle: 'fable.quotes' } } });
  });
});
