import { MockTardyApi } from '@/data/mock/mock-api';
import { POSTS } from '@/data/mock/fixtures';

const api = () => new MockTardyApi({ latencyMs: 0 });

describe('MockTardyApi sounds', () => {
  it('puts cleared sounds on reels', () => {
    const withSound = POSTS.filter((p) => p.sound);
    expect(withSound.length).toBeGreaterThan(0);
    expect(withSound.every((p) => p.format === 'reel')).toBe(true);
  });

  it('ranks trending by the server formula and counts a retried event once', async () => {
    const client = api();
    const before = await client.trendingSounds();
    expect(before.map((s) => s.score)).toEqual([...before.map((s) => s.score)].sort((a, b) => b - a));
    const last = before[before.length - 1];
    const play = { eventId: '11111111-1111-4111-8111-111111111111', kind: 'play_completed' as const, listenMs: 15_000 };
    await client.logSoundPlay(last.trackId, play);
    await client.logSoundPlay(last.trackId, play);
    const after = (await client.trendingSounds()).find((s) => s.trackId === last.trackId)!;
    expect(after.score - last.score).toBe(20);
  });

  it('rejects unknown tracks and a bad limit', async () => {
    await expect(api().logSoundPlay('nope', { eventId: 'e', kind: 'play_started', listenMs: 1 })).rejects.toMatchObject({ code: 'not_found' });
    await expect(api().trendingSounds(0)).rejects.toMatchObject({ code: 'invalid' });
  });
});
