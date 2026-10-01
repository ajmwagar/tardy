import type { Notification, NotificationKind } from '@/data/types';

import { NOTIFICATION_KINDS } from './preferences';

/**
 * The data a push carries: just enough to route the tap, never content. Titles and bodies
 * are display text; anything the app shows after the tap is fetched fresh through the API,
 * which re-applies privacy. That way a post that went private after the push was sent
 * does not leak through the payload.
 *
 * Wire (the push's `data` object, snake_case like the API):
 * `{ v: 1, notification_id, kind, actor_id, post_id? }`. Unknown extra keys are ignored;
 * a `v` other than 1 is rejected so a future format change is a visible break, not a
 * silent misroute.
 */
export type PushPayload = {
  notificationId: string;
  kind: NotificationKind;
  actorId: string;
  postId?: string;
};

export const PUSH_PAYLOAD_VERSION = 1;

export function payloadFor(n: Notification): PushPayload {
  return { notificationId: n.id, kind: n.kind, actorId: n.actorId, ...(n.postId !== undefined && { postId: n.postId }) };
}

export function encodePushPayload(p: PushPayload): Record<string, string | number> {
  return {
    v: PUSH_PAYLOAD_VERSION,
    notification_id: p.notificationId,
    kind: p.kind,
    actor_id: p.actorId,
    ...(p.postId !== undefined && { post_id: p.postId }),
  };
}

export type ParsedPayload = { ok: true; payload: PushPayload } | { ok: false; reason: string };

const isKind = (k: unknown): k is NotificationKind => (NOTIFICATION_KINDS as readonly unknown[]).includes(k);
const nonEmpty = (s: unknown): s is string => typeof s === 'string' && s.length > 0;

/** Decodes a push's `data`. Returns a reason instead of throwing: taps must always land somewhere. */
export function parsePushPayload(data: unknown): ParsedPayload {
  if (typeof data !== 'object' || data === null) return { ok: false, reason: 'push has no data' };
  const d = data as Record<string, unknown>;
  if (d.v !== PUSH_PAYLOAD_VERSION) return { ok: false, reason: `unsupported push payload version ${String(d.v)}` };
  if (!nonEmpty(d.notification_id)) return { ok: false, reason: 'push payload has no notification_id' };
  if (!isKind(d.kind)) return { ok: false, reason: `unknown notification kind ${String(d.kind)}` };
  if (!nonEmpty(d.actor_id)) return { ok: false, reason: 'push payload has no actor_id' };
  if (d.post_id !== undefined && !nonEmpty(d.post_id)) return { ok: false, reason: 'push payload has a malformed post_id' };
  return {
    ok: true,
    payload: { notificationId: d.notification_id, kind: d.kind, actorId: d.actor_id, ...(d.post_id !== undefined && { postId: d.post_id }) },
  };
}
