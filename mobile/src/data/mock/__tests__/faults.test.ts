import { TardyApiError } from '../../api';
import { BROKEN_VIDEO_URL, FaultSwitch, faults, InjectedFault, NO_FAULTS, withFaults } from '../faults';
import { POSTS } from '../fixtures';
import { MockTardyApi } from '../mock-api';

const mock = () => new MockTardyApi({ latencyMs: 0 });

function setup(random?: () => number) {
  const inner = mock();
  const sw = new FaultSwitch(true);
  return { inner, sw, api: withFaults(inner, sw, random) };
}

describe('fault injection: off by default', () => {
  it('the app switch starts with no faults', () => {
    expect(faults.current).toEqual(NO_FAULTS);
    expect(faults.active).toBe(false);
  });

  it('a fresh switch passes every call straight through', async () => {
    const { api, sw } = setup();
    expect(sw.active).toBe(false);
    const [wrapped, raw] = await Promise.all([api.homeFeed(null), mock().homeFeed(null)]);
    expect(wrapped.items.map((p) => p.id)).toEqual(raw.items.map((p) => p.id));
    expect(wrapped.items.length).toBeGreaterThan(0);
    await expect(api.setLiked(wrapped.items[0].id, true)).resolves.toBeUndefined();
    const reels = await api.reelsFeed(null);
    expect(reels.items.flatMap((p) => p.media).some((m) => m.url === BROKEN_VIDEO_URL)).toBe(false);
  });

  it('cannot be enabled when unavailable (production builds)', () => {
    const inner = mock();
    const prod = new FaultSwitch(false);
    expect(withFaults(inner, prod)).toBe(inner); // no proxy installed at all
    expect(() => prod.set({ failureRate: { interactions: 1 } })).toThrow(/dev-only/);
    expect(prod.current).toEqual(NO_FAULTS);
  });

  it('rejects nonsense rates instead of silently clamping', () => {
    const sw = new FaultSwitch(true);
    expect(() => sw.set({ failureRate: { firstPage: 2 } })).toThrow(RangeError);
    expect(() => sw.set({ latencyMs: -1 })).toThrow(RangeError);
  });
});

describe('fault injection: each failure mode', () => {
  it('latency delays every call', async () => {
    const { api, sw } = setup();
    sw.set({ latencyMs: 60 });
    const start = Date.now();
    await api.me();
    expect(Date.now() - start).toBeGreaterThanOrEqual(55);
  });

  it('firstPage fails only the first page of a feed', async () => {
    const { api, sw, inner } = setup();
    sw.set({ failureRate: { firstPage: 1 } });
    await expect(api.homeFeed(null)).rejects.toBeInstanceOf(InjectedFault);
    await expect(api.reelsFeed(null)).rejects.toThrow('Injected fault: reelsFeed');
    const first = await inner.homeFeed(null);
    await expect(api.homeFeed(first.nextCursor)).resolves.toHaveProperty('items');
    await expect(api.me()).resolves.toHaveProperty('id', 'me');
  });

  it('nextPage fails later pages but not the first', async () => {
    const { api, sw } = setup();
    sw.set({ failureRate: { nextPage: 1 } });
    const first = await api.homeFeed(null);
    expect(first.nextCursor).not.toBeNull();
    await expect(api.homeFeed(first.nextCursor)).rejects.toBeInstanceOf(InjectedFault);
  });

  it('interactions fail before reaching the server, so nothing changes there', async () => {
    const { api, sw, inner } = setup();
    const spy = jest.spyOn(inner, 'setLiked');
    sw.set({ failureRate: { interactions: 1 } });
    for (const write of [
      () => api.setLiked(POSTS[0].id, true),
      () => api.setSaved(POSTS[0].id, true),
      () => api.setAlarm(POSTS[0].id, true),
      () => api.setFollowing(POSTS[0].authorId, false),
    ]) {
      await expect(write()).rejects.toBeInstanceOf(InjectedFault);
    }
    expect(spy).not.toHaveBeenCalled();
    await expect(api.homeFeed(null)).resolves.toHaveProperty('items');
  });

  it('fractional rates use the injected random source', async () => {
    let roll = 0.5;
    const { api, sw } = setup(() => roll);
    sw.set({ failureRate: { other: 0.3 } });
    await expect(api.me()).resolves.toHaveProperty('id');
    roll = 0.2;
    await expect(api.me()).rejects.toBeInstanceOf(InjectedFault);
  });

  it('emptyFeeds empties feeds and nothing else', async () => {
    const { api, sw } = setup();
    sw.set({ emptyFeeds: true });
    await expect(api.homeFeed(null)).resolves.toEqual({ items: [], nextCursor: null });
    await expect(api.reelsFeed(null)).resolves.toEqual({ items: [], nextCursor: null });
    expect((await api.trending()).length).toBeGreaterThan(0);
  });

  it('brokenVideo points every served video at an unloadable URL', async () => {
    const { api, sw } = setup();
    sw.set({ brokenVideo: true });
    const videos = (await api.reelsFeed(null)).items.flatMap((p) => p.media).filter((m) => m.type === 'video');
    expect(videos.length).toBeGreaterThan(0);
    expect(videos.every((m) => m.url === BROKEN_VIDEO_URL)).toBe(true);
  });

  it("preserves the API's own errors (privacy, not found)", async () => {
    const { api, sw } = setup();
    sw.set({ brokenVideo: true, latencyMs: 1 });
    const error = await api.post('no-such-post').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TardyApiError);
    expect((error as TardyApiError).code).toBe('not_found');
  });

  it('reset turns everything off again', async () => {
    const { api, sw } = setup();
    sw.set({ failureRate: { firstPage: 1, nextPage: 1, interactions: 1, other: 1 } });
    sw.reset();
    expect(sw.active).toBe(false);
    await expect(api.homeFeed(null)).resolves.toHaveProperty('items');
  });
});
