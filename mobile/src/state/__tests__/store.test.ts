import { faults } from '@/data/mock/faults';
import { POSTS } from '@/data/mock/fixtures';

import { cacheAccounts, cacheViewerAccount, clearError, flushEngagement, getState, incrementCommentCount, ingestPosts, resetViewerState, seedFollowing, setLiked, toggleAlarm, toggleFollowing, toggleRepost, toggleSaved } from '../store';

/**
 * Rollback paths, driven by the dev fault switch. Injected interaction faults throw before
 * the mock is reached, so these tests need no session and leave server state untouched.
 */

const post = POSTS.find((p) => !p.viewerHasLiked && !p.viewerHasSaved && !p.viewerHasAlarm)!;

beforeAll(() => ingestPosts([post]));
beforeEach(() => faults.set({ failureRate: { interactions: 1 } }));
afterEach(() => {
  faults.reset();
  clearError();
});
afterAll(() => flushEngagement());

describe('optimistic interactions', () => {
  it('updates the shared count after a confirmed comment', () => {
    const before = getState().posts.get(post.id)!.commentCount;
    incrementCommentCount(post.id);
    expect(getState().posts.get(post.id)!.commentCount).toBe(before + 1);
  });

  it('a failed like rolls back and sets lastError', async () => {
    const before = getState().posts.get(post.id)!;
    expect(before.liked).toBe(false);
    expect(getState().lastError).toBeNull();

    const pending = setLiked(post.id, true);
    // Applied instantly...
    expect(getState().posts.get(post.id)).toMatchObject({ liked: true, likeCount: before.likeCount + 1 });
    await pending;
    // ...and undone when the sync fails.
    expect(getState().posts.get(post.id)).toEqual(before);
    expect(getState().lastError).toMatch(/thumbs up, so we put it back/);
    expect(getState().lastError).toMatch(/Injected fault: setLiked/);
  });

  it('failed alarms and saves roll back too', async () => {
    const before = getState().posts.get(post.id)!;
    await toggleAlarm(post.id);
    expect(getState().posts.get(post.id)).toEqual(before);
    expect(getState().lastError).toMatch(/raise the alarm/);
    await toggleSaved(post.id);
    expect(getState().posts.get(post.id)).toEqual(before);
    expect(getState().lastError).toMatch(/save that/);
  });

  it('a failed repost rolls back', async () => {
    const before = getState().posts.get(post.id)!;
    const pending = toggleRepost(post.id);
    expect(getState().posts.get(post.id)).toMatchObject({ reposted: true, repostCount: before.repostCount + 1 });
    await pending;
    expect(getState().posts.get(post.id)).toEqual(before);
    expect(getState().lastError).toMatch(/repost that/);
  });

  it('a failed follow rolls back', async () => {
    seedFollowing([]);
    await toggleFollowing(post.authorId);
    expect(getState().following.has(post.authorId)).toBe(false);
    expect(getState().lastError).toMatch(/follow them/);
  });
});

describe('viewer account cache', () => {
  it('keeps the stable me alias for a durable UUID and refreshes both keys', () => {
    resetViewerState();
    const account = {
      id: '28542681-0556-40dc-9dbd-743691f9f31a',
      kind: 'human' as const,
      handle: 'james',
      name: 'James',
      avatarUrl: 'https://example.test/avatar.jpg',
      bio: '',
      verified: false,
      followers: 0,
      following: 0,
      postCount: 1,
    };
    cacheViewerAccount(account);
    expect(getState().accounts.get('me')).toEqual(account);
    expect(getState().accounts.get(account.id)).toEqual(account);

    const refreshed = { ...account, postCount: 2 };
    cacheAccounts([refreshed]);
    expect(getState().accounts.get('me')).toEqual(refreshed);
  });
});
