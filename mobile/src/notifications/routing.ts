import type { Href } from 'expo-router';

import { TardyApiError, type TardyApi } from '@/data/api';
import type { NotificationKind } from '@/data/types';

import { parsePushPayload, type PushPayload } from './payload';

/**
 * Where a tapped notification lands. `notice` is set when the tap could not go where it
 * pointed (deleted post, lost access, malformed push): the caller shows it, so a dead
 * tap is never silent.
 */
export type NotificationRoute = { href: Href; notice?: string };

/** Where taps fall back to: the list of everything, which never 404s. */
export const NOTIFICATIONS_HREF: Href = '/notifications';

type Destination = 'post' | 'comments' | 'profile' | 'conversation';

/** Every kind's destination. A `Record` so adding a kind fails typecheck until it's routed. */
export const DESTINATION: Record<NotificationKind, Destination> = {
  like: 'post',
  comment: 'comments',
  mention: 'comments',
  follow: 'profile',
  message: 'conversation',
  conversation_invite: 'conversation',
  // Work kinds open the post itself: its status pill and PR/issue links are the point.
  shipped: 'post',
  blocked: 'post',
  review_requested: 'post',
};

const fallback = (notice: string): NotificationRoute => ({ href: NOTIFICATIONS_HREF, notice });

function explain(error: unknown, what: 'post' | 'profile'): string {
  // A post is a "tardy" in the app's copy.
  const noun = what === 'post' ? 'tardy' : what;
  if (error instanceof TardyApiError) {
    return error.code === 'not_found'
      ? `That ${noun} was deleted.`
      : `You no longer have access to that ${noun}.`;
  }
  return `Couldn't open that ${noun}: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Resolves a push to a route. The target is re-fetched through the API, which applies
 * privacy now (not when the push was sent), so a post deleted or narrowed since then
 * lands on the notifications list with a notice instead of a broken screen.
 */
export async function routeForPayload(payload: PushPayload, api: Pick<TardyApi, 'post' | 'account'>): Promise<NotificationRoute> {
  const destination = DESTINATION[payload.kind];

  if (destination === 'profile') {
    try {
      const actor = await api.account(payload.actorId);
      return { href: { pathname: '/profile/[handle]', params: { handle: actor.handle } } };
    } catch (error) {
      return fallback(explain(error, 'profile'));
    }
  }

  if (destination === 'conversation') {
    return payload.conversationId
      ? { href: { pathname: '/messages/[threadId]', params: { threadId: payload.conversationId } } }
      : fallback(`That ${payload.kind.replace('_', ' ')} notification has no conversation.`);
  }

  if (payload.postId === undefined) return fallback(`That ${payload.kind.replace('_', ' ')} notification has no post.`);
  try {
    const post = await api.post(payload.postId);
    return destination === 'comments'
      ? { href: { pathname: '/comments/[postId]', params: { postId: post.id } } }
      : { href: { pathname: '/post/[postId]', params: { postId: post.id } } };
  } catch (error) {
    return fallback(explain(error, 'post'));
  }
}

/** Raw push `data` → route. Malformed pushes land on the notifications list, loudly. */
export async function routeForPushData(data: unknown, api: Pick<TardyApi, 'post' | 'account'>): Promise<NotificationRoute> {
  const parsed = parsePushPayload(data);
  if (!parsed.ok) return fallback(`Couldn't open that notification (${parsed.reason}).`);
  return routeForPayload(parsed.payload, api);
}
