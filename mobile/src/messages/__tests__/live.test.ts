import { MockTardyApi } from '@/data/mock/mock-api';

import { LIVE_FAST_MS, LIVE_QUIET_MS, lastSequence, mergeMessages, nextCheckMs, quickCheckCursor } from '../live';

const m = (id: string, sequence: number, text = id) => ({ id, threadId: 't', senderId: 'a', text, createdAt: '1970-01-01T00:00:00.000Z', sequence });

describe('live chat cadence', () => {
  it('checks fast while the chat is moving and slower when quiet', () => {
    expect(nextCheckMs(1_000, 5_000)).toBe(LIVE_FAST_MS);
    expect(nextCheckMs(1_000, 60_000)).toBe(LIVE_QUIET_MS);
    expect(LIVE_FAST_MS).toBeLessThan(1_000);
  });

  it('merges new messages and updated ones in order', () => {
    const merged = mergeMessages([m('a', 1), m('b', 2)], [m('b', 2, 'b with reaction'), m('c', 3)]);
    expect(merged.map((x) => [x.id, x.text])).toEqual([
      ['a', 'a'],
      ['b', 'b with reaction'],
      ['c', 'c'],
    ]);
    expect(lastSequence(merged)).toBe(3);
    expect(lastSequence([])).toBe(0);
  });

  it('quick checks re-read the newest few messages for reactions', () => {
    expect(quickCheckCursor(12)).toBe(7);
    expect(quickCheckCursor(3)).toBe(0);
  });

  it('fetches only what is new after a cursor', async () => {
    const client = new MockTardyApi({ latencyMs: 0 });
    const all = await client.messages('t-opus');
    const cursor = lastSequence(all);
    expect(await client.messages('t-opus', cursor)).toEqual([]);
    await client.sendMessage('t-avery', 'unrelated');
    const sent = await client.sendMessage('t-opus', 'new one');
    const fresh = await client.messages('t-opus', cursor);
    expect(fresh.map((x) => x.id)).toEqual([sent.id]);
    expect(fresh[0].sequence).toBe(cursor + 1);
  });
});
