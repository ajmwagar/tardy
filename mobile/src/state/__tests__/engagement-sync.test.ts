import { POSTS } from '@/data/mock/fixtures';
import { api, flushEngagement, getState, loadFeedPage, logEngagement, resetViewerState } from '../store';

jest.mock('@/data/mock/faults', () => ({
  ...jest.requireActual('@/data/mock/faults'),
  withFaults: (backend: unknown) => backend,
}));

beforeEach(() => { jest.useFakeTimers(); resetViewerState(); });
afterEach(() => { resetViewerState(); jest.restoreAllMocks(); jest.useRealTimers(); });

it('never overlaps engagement requests while scrolling', async () => {
  let finish!: () => void;
  const send = jest.spyOn(api, 'logEngagement').mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
  logEngagement({ type: 'video_open', postId: 'first' });
  const pending = flushEngagement();
  for (let i = 0; i < 30; i++) logEngagement({ type: 'video_open', postId: `post-${i}` });
  await flushEngagement();
  expect(send).toHaveBeenCalledTimes(1);
  finish(); await pending;
  await jest.advanceTimersByTimeAsync(2000);
  expect(send).toHaveBeenCalledTimes(2);
});

it('backs off after failure even when new actions cross the batch threshold', async () => {
  const send = jest.spyOn(api, 'logEngagement').mockRejectedValueOnce(new Error('outage')).mockResolvedValue(undefined);
  logEngagement({ type: 'video_open', postId: 'first' });
  await flushEngagement();
  for (let i = 0; i < 30; i++) logEngagement({ type: 'video_open', postId: `post-${i}` });
  await flushEngagement();
  expect(send).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(2000);
  expect(send).toHaveBeenCalledTimes(2);
});

it('never restores a previous viewer’s failed batch after sign-out', async () => {
  let fail!: (error: Error) => void;
  const send = jest.spyOn(api, 'logEngagement').mockImplementationOnce(() => new Promise<void>((_, reject) => { fail = reject; }));
  logEngagement({ type: 'video_open', postId: 'private-old-viewer' });
  const pending = flushEngagement();
  resetViewerState();
  fail(new Error('outage')); await pending;
  await jest.advanceTimersByTimeAsync(30000);
  expect(send).toHaveBeenCalledTimes(1);
  expect(getState().lastError).toBeNull();
});

it('shows feed posts before slow author hydration completes', async () => {
  let finish!: () => void;
  const hydrate = jest.spyOn(api, 'accounts').mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve([]); }));
  const post = POSTS[0];
  const result = await loadFeedPage(Promise.resolve({ items: [post], nextCursor: null }));
  expect(result.items[0].id).toBe(post.id);
  expect(getState().posts.has(post.id)).toBe(true);
  expect(hydrate).toHaveBeenCalledTimes(1);
  finish();
  await Promise.resolve();
});
