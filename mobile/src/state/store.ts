import { useSyncExternalStore } from 'react';

import type { TardyApi } from '@/data/api';
import { faults, withFaults } from '@/data/mock/faults';
import { MockTardyApi } from '@/data/mock/mock-api';
import { keychainSlot } from '@/auth/keychain';
import type { Account, EngagementAction, Post } from '@/data/types';

/**
 * Client-side state shared across screens: the account cache, optimistic post
 * interactions, follows, seen stories, and the batched engagement log.
 *
 * Interactions apply locally first (instant UI), then sync to the API; a failed sync
 * rolls the change back and surfaces the error via `lastError`.
 */

// Starts signed out; the mock server's sessions survive relaunch in the keychain.
const backend: TardyApi = new MockTardyApi({ viewerId: null, persistence: keychainSlot('tardy.mock-server') });

/** Wrapped for dev-only fault injection (`data/mock/faults.ts`); a no-op in production. */
export const api: TardyApi = withFaults(backend, faults);

/**
 * True while the app talks to the in-app mock rather than a real server. Derived from the
 * backend itself, so developer shortcuts gated on it (the sign-in bypass) disappear the
 * moment a real backend is wired in, with nothing to remember to switch off.
 */
export const usesMockBackend = backend instanceof MockTardyApi;

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The `lastError` text for a write that failed and was undone locally. */
const rolledBack = (what: string, error: unknown) => `Couldn't ${what}, so we put it back. (${describe(error)})`;

type PostState = { liked: boolean; saved: boolean; likeCount: number; alarm: boolean; alarmCount: number };

type State = {
  accounts: ReadonlyMap<string, Account>;
  posts: ReadonlyMap<string, PostState>;
  following: ReadonlySet<string>;
  seenStories: ReadonlySet<string>;
  lastError: string | null;
  /** Feed and reels share one mute switch, like Instagram. */
  muted: boolean;
  /** Viral posts for the breaking ticker. */
  trending: Post[];
  /** Tab badge counts. Derived from the server's read watermarks; refresh after reads. */
  unread: { messages: number; notifications: number };
};

const initialState = (): State => ({
  accounts: new Map(),
  posts: new Map(),
  following: new Set(),
  seenStories: new Set(),
  lastError: null,
  muted: true,
  trending: [],
  unread: { messages: 0, notifications: 0 },
});

let state: State = initialState();

const listeners = new Set<() => void>();

function set(update: (s: State) => Partial<State>) {
  state = { ...state, ...update(state) };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

export const getState = () => state;

// MARK: accounts

const inflight = new Map<string, Promise<void>>();

/** Resolves once every id is in the cache. Call before rendering items that name them. */
export async function ensureAccounts(ids: Iterable<string | undefined>): Promise<void> {
  const missing = [...new Set(ids)].filter((id): id is string => !!id && !state.accounts.has(id));
  const fresh = missing.filter((id) => !inflight.has(id));
  if (fresh.length > 0) {
    const request = api.accounts(fresh).then((accounts) => {
      set((s) => {
        const next = new Map(s.accounts);
        accounts.forEach((a) => next.set(a.id, a));
        return { accounts: next };
      });
    });
    fresh.forEach((id) => inflight.set(id, request));
    request.finally(() => fresh.forEach((id) => inflight.delete(id)));
  }
  await Promise.all(missing.map((id) => inflight.get(id)));
}

export function useAccount(id: string | undefined): Account | undefined {
  return useStore((s) => (id ? s.accounts.get(id) : undefined));
}

/** Seeds the follow graph and viewer account. Runs on every sign-in (see `state/auth.ts`). */
export async function bootstrap() {
  const [me, following] = await Promise.all([api.me(), api.followingIds()]);
  seedFollowing(following);
  set((s) => ({ accounts: new Map(s.accounts).set(me.id, me) }));
}

// MARK: posts

/** Registers server state for posts without clobbering local optimistic state. */
export function ingestPosts(posts: Post[]) {
  set((s) => {
    const next = new Map(s.posts);
    for (const p of posts) {
      if (!next.has(p.id)) {
        next.set(p.id, {
          liked: p.viewerHasLiked,
          saved: p.viewerHasSaved,
          likeCount: p.likeCount,
          alarm: p.viewerHasAlarm,
          alarmCount: p.alarmCount,
        });
      }
    }
    return { posts: next };
  });
}

export async function loadFeedPage(page: Promise<{ items: Post[]; nextCursor: string | null }>) {
  const result = await page;
  await ensureAccounts(result.items.flatMap((p) => [p.authorId, p.projectId]));
  ingestPosts(result.items);
  return result;
}

export function usePostState(id: string): PostState | undefined {
  return useStore((s) => s.posts.get(id));
}

function patchPost(id: string, patch: (p: PostState) => PostState) {
  set((s) => {
    const current = s.posts.get(id);
    if (!current) return {};
    return { posts: new Map(s.posts).set(id, patch(current)) };
  });
}

/** `what` finishes "Couldn't …" in the rollback message, e.g. "save that". */
async function optimistic(id: string, what: string, patch: (p: PostState) => PostState, sync: () => Promise<void>) {
  const before = state.posts.get(id);
  if (!before) return;
  patchPost(id, patch);
  try {
    await sync();
  } catch (error) {
    patchPost(id, () => before);
    set(() => ({ lastError: rolledBack(what, error) }));
  }
}

export function setLiked(id: string, liked: boolean) {
  const current = state.posts.get(id);
  if (!current || current.liked === liked) return;
  logEngagement({ type: liked ? 'favorite' : 'unfavorite', postId: id });
  return optimistic(
    id,
    liked ? 'give that a thumbs up' : 'take back your thumbs up',
    (p) => ({ ...p, liked, likeCount: p.likeCount + (liked ? 1 : -1) }),
    () => api.setLiked(id, liked),
  );
}

export const toggleLiked = (id: string) => setLiked(id, !state.posts.get(id)?.liked);

export function toggleSaved(id: string) {
  const saved = !state.posts.get(id)?.saved;
  return optimistic(id, saved ? 'save that' : 'unsave that', (p) => ({ ...p, saved }), () => api.setSaved(id, saved));
}

export function toggleAlarm(id: string) {
  const on = !state.posts.get(id)?.alarm;
  logEngagement({ type: on ? 'alarm' : 'unalarm', postId: id });
  return optimistic(
    id,
    on ? 'raise the alarm' : 'stand down the alarm',
    (p) => ({ ...p, alarm: on, alarmCount: p.alarmCount + (on ? 1 : -1) }),
    () => api.setAlarm(id, on),
  );
}

// MARK: follows & stories

export function useIsFollowing(accountId: string) {
  return useStore((s) => s.following.has(accountId));
}

export function seedFollowing(ids: Iterable<string>) {
  set(() => ({ following: new Set(ids) }));
}

const followListeners = new Set<(accountId: string) => void>();

/**
 * Called after the user follows an account (a confirmed tap, not the bootstrap seed).
 * Push setup uses it to ask for notification permission at a moment that explains itself.
 */
export function onUserFollow(listener: (accountId: string) => void) {
  followListeners.add(listener);
  return () => void followListeners.delete(listener);
}

export async function toggleFollowing(accountId: string) {
  const following = !state.following.has(accountId);
  const apply = (on: boolean) =>
    set((s) => {
      const next = new Set(s.following);
      if (on) next.add(accountId);
      else next.delete(accountId);
      return { following: next };
    });

  apply(following);
  logEngagement({ type: following ? 'follow_author' : 'unfollow_author', authorId: accountId });
  try {
    await api.setFollowing(accountId, following);
    if (following) followListeners.forEach((l) => l(accountId));
  } catch (error) {
    apply(!following);
    set(() => ({ lastError: rolledBack(following ? 'follow them' : 'unfollow them', error) }));
  }
}

export function markStoriesSeen(ids: string[]) {
  set((s) => ({ seenStories: new Set([...s.seenStories, ...ids]) }));
}

/** Refreshes the breaking ticker. Failures leave the last headlines up and set `lastError`. */
export async function loadTrending() {
  try {
    const posts = await api.trending();
    await ensureAccounts(posts.map((p) => p.authorId));
    ingestPosts(posts);
    set(() => ({ trending: posts }));
  } catch (error) {
    set(() => ({ lastError: `Trending failed: ${error instanceof Error ? error.message : String(error)}` }));
  }
}

/** Recomputes the tab badges from the server (the source of truth for read state). */
export async function refreshUnread() {
  try {
    const [threads, notifications] = await Promise.all([api.threads(), api.notifications()]);
    set(() => ({
      unread: {
        messages: threads.reduce((n, t) => n + t.unreadCount, 0),
        notifications: notifications.filter((n) => !n.read).length,
      },
    }));
  } catch (error) {
    reportError(`Couldn't refresh badges: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const toggleMuted = () => set((s) => ({ muted: !s.muted }));

export const clearError = () => set(() => ({ lastError: null }));

/** Surfaces a non-blocking failure in the app-wide error toast (`ErrorToast`). */
export const reportError = (message: string) => set(() => ({ lastError: message }));

// MARK: engagement

let queue: EngagementAction[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Queues an engagement action; flushed in batches so logging never blocks a frame. */
export function logEngagement(action: EngagementAction) {
  queue.push(action);
  if (queue.length >= 20) void flushEngagement();
  else flushTimer ??= setTimeout(flushEngagement, 2000);
}

export async function flushEngagement() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  try {
    await api.logEngagement(batch);
  } catch (error) {
    queue = [...batch, ...queue];
    set(() => ({ lastError: `Engagement sync failed: ${error instanceof Error ? error.message : String(error)}` }));
  }
}

// MARK: session

/** Replaces cached accounts with fresher copies from the server (e.g. after a handle change). */
export function cacheAccounts(accounts: Account[]) {
  set((s) => {
    const next = new Map(s.accounts);
    accounts.forEach((a) => next.set(a.id, a));
    return { accounts: next };
  });
}

/** Drops everything that belonged to the signed-out viewer. */
export function resetViewerState() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  queue = [];
  set(() => initialState());
}
