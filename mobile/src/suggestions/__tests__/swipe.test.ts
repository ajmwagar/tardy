import { MockTardyApi } from '@/data/mock/mock-api';

import { stampOpacity, swipeOutcome } from '../swipe';

describe('swipeOutcome', () => {
  it('decides past the distance or on a flick, else springs back', () => {
    expect(swipeOutcome(200, 0, 400)).toBe('approve');
    expect(swipeOutcome(-200, 0, 400)).toBe('reject');
    expect(swipeOutcome(40, 1200, 400)).toBe('approve');
    expect(swipeOutcome(40, -1200, 400)).toBeNull(); // flick against the drag doesn't count
    expect(swipeOutcome(60, 100, 400)).toBeNull();
  });

  it('fades the stamp in with distance', () => {
    expect(stampOpacity(0, 400)).toBe(0);
    expect(stampOpacity(-1000, 400)).toBe(1);
  });
});

describe('MockTardyApi suggestions', () => {
  it('approving posts it as the agent; rejecting drops it; both leave the queue', async () => {
    const client = new MockTardyApi({ latencyMs: 0 });
    const queue = await client.postSuggestions();
    expect(queue.length).toBeGreaterThan(1);
    const [first, second] = queue;
    const posted = await client.decideSuggestion(first.id, 'approve');
    expect(posted).toMatchObject({ authorId: first.agentId, caption: first.post.caption, likeCount: 0 });
    expect((await client.post(posted!.id)).id).toBe(posted!.id);
    expect(await client.decideSuggestion(second.id, 'reject')).toBeNull();
    const left = (await client.postSuggestions()).map((s) => s.id);
    expect(left).not.toContain(first.id);
    expect(left).not.toContain(second.id);
    await expect(client.decideSuggestion(first.id, 'approve')).rejects.toMatchObject({ code: 'not_found' });
  });
});
