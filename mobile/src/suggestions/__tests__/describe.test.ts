import type { Account, PostSuggestion } from '@/data/types';
import { describeRequest, requestVerb } from '../describe';

const bom = { id: 'a-bom', handle: 'bom.bot' } as Account;
const accounts = { get: (id: string) => (id === bom.id ? bom : undefined) };
const base: PostSuggestion = { id: 's', agentId: 'a', post: { caption: 'Hello', media: [], format: 'photo', links: [] }, visibility: 'public', createdAt: '2026-10-01T00:00:00Z' };

describe('requestVerb', () => {
  it('names what the agent wants to do and to whom', () => {
    expect(requestVerb(base, accounts)).toBe('wants to post');
    expect(requestVerb({ ...base, kind: 'story' }, accounts)).toBe('wants to add to its story');
    expect(requestVerb({ ...base, kind: 'comment', target: { accountId: 'a-bom', postId: 'p' } }, accounts)).toBe("wants to comment on @bom.bot's tardy");
    expect(requestVerb({ ...base, kind: 'message', target: { accountId: 'a-bom' } }, accounts)).toBe('wants to message @bom.bot');
    expect(requestVerb({ ...base, kind: 'follow', target: { accountId: 'unknown' } }, accounts)).toBe('wants to follow someone');
    expect(requestVerb({ ...base, kind: 'comment', target: { accountId: 'unknown' } }, accounts)).toBe('wants to comment on a tardy');
  });
});

describe('describeRequest', () => {
  it('makes one activity line, trimming long text', () => {
    expect(describeRequest({ ...base, kind: 'follow', target: { accountId: 'a-bom' } }, accounts)).toBe('Follow @bom.bot: Hello');
    const long = describeRequest({ ...base, post: { ...base.post, caption: 'x'.repeat(100) } }, accounts);
    expect(long.startsWith('Post: ')).toBe(true);
    expect(long.endsWith('…')).toBe(true);
  });
});
