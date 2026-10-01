import { faults } from '@/data/mock/faults';
import { POSTS } from '@/data/mock/fixtures';

import { clearError, flushEngagement, getState, ingestPosts, seedFollowing, setLiked, toggleAlarm, toggleFollowing, toggleSaved } from '../store';

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

  it('a failed follow rolls back', async () => {
    seedFollowing([]);
    await toggleFollowing(post.authorId);
    expect(getState().following.has(post.authorId)).toBe(false);
    expect(getState().lastError).toMatch(/follow them/);
  });
});
