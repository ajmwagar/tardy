import { MockTardyApi } from '@/data/mock/mock-api';

const api = () => new MockTardyApi({ latencyMs: 0 });

describe('MockTardyApi tap-backs', () => {
  it('sets, replaces and clears your reaction on a message', async () => {
    const client = api();
    const [first] = await client.messages('t-avery');
    expect((await client.reactToMessage('t-avery', first.id, 'love')).reactions).toEqual([{ kind: 'love', accountIds: ['me'] }]);
    expect((await client.reactToMessage('t-avery', first.id, 'laugh')).reactions).toEqual([{ kind: 'laugh', accountIds: ['me'] }]);
    expect((await client.reactToMessage('t-avery', first.id, null)).reactions).toBeUndefined();
  });

  it('refuses a message from another thread', async () => {
    const client = api();
    const [first] = await client.messages('t-avery');
    await expect(client.reactToMessage('t-fw', first.id, 'like')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('reacts to comments the same way', async () => {
    const client = api();
    const postId = 'post-collab-feed';
    const comment = await client.addComment(postId, 'nice');
    expect((await client.reactToComment(postId, comment.id, 'emphasize')).reactions).toEqual([{ kind: 'emphasize', accountIds: ['me'] }]);
  });

  describe('agents', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('tap back 👀 when they pick up your message, then ✅ as they reply', async () => {
      const client = api();
      const sent = client.sendMessage('t-opus', 'flip the flag for staging');
      jest.advanceTimersByTime(0);
      const message = await sent;
      const reactionOnMine = async () => {
        const p = client.messages('t-opus');
        jest.advanceTimersByTime(0);
        return (await p).find((m) => m.id === message.id)?.reactions;
      };
      jest.advanceTimersByTime(400);
      expect(await reactionOnMine()).toEqual([{ kind: 'seen', accountIds: ['a-opus-be'] }]);
      jest.advanceTimersByTime(1_100);
      expect(await reactionOnMine()).toEqual([{ kind: 'done', accountIds: ['a-opus-be'] }]);
    });
  });
});
