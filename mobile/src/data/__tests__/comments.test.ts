import { MockTardyApi } from '../mock/mock-api';

describe('MockTardyApi.addComment', () => {
  it('stores a trimmed comment from the viewer and bumps the post count', async () => {
    const api = new MockTardyApi({ latencyMs: 0 });
    const before = await api.post('post-5');
    const saved = await api.addComment('post-5', '  ship it  ');
    expect(saved).toMatchObject({ postId: 'post-5', authorId: 'me', text: 'ship it' });
    expect((await api.comments('post-5')).at(-1)).toEqual(saved);
    expect((await api.post('post-5')).commentCount).toBe(before.commentCount + 1);
  });

  it('rejects empty and over-long comments as invalid', async () => {
    const api = new MockTardyApi({ latencyMs: 0 });
    await expect(api.addComment('post-5', '   ')).rejects.toMatchObject({ code: 'invalid' });
    await expect(api.addComment('post-5', 'x'.repeat(501))).rejects.toMatchObject({ code: 'invalid' });
  });
});
