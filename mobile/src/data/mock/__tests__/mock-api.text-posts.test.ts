import { TardyApiError } from '../../api';
import { MockTardyApi } from '../mock-api';

describe('mock createPost()', () => {
  it('publishes a text post the viewer can read back, idempotently per request id', async () => {
    const api = new MockTardyApi({ viewerId: 'me', latencyMs: 0 });
    const draft = { clientRequestId: 'r1', text: '  Shipped text posts.  ', audience: 'public' as const };
    const post = await api.createPost(draft);
    expect(post).toMatchObject({ authorId: 'me', format: 'text', media: [], caption: 'Shipped text posts.' });
    expect((await api.createPost(draft)).id).toBe(post.id);
    expect(await api.post(post.id)).toEqual(post);
  });

  it('rejects empty and over-200-character posts as invalid', async () => {
    const api = new MockTardyApi({ viewerId: 'me', latencyMs: 0 });
    for (const text of ['  ', 'a'.repeat(201)]) {
      await expect(api.createPost({ clientRequestId: text, text, audience: 'public' })).rejects.toBeInstanceOf(TardyApiError);
    }
  });
});
