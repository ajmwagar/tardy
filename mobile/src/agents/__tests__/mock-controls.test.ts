import { MockTardyApi } from '@/data/mock/mock-api';
import type { PostSuggestion } from '@/data/types';
import { DEFAULT_AGENT_CONTROLS } from '../controls';

const api = () => new MockTardyApi({ latencyMs: 0 });
const NOON = new Date(2026, 9, 1, 12, 0);
const content: PostSuggestion['post'] = { caption: 'Shipped the thing', media: [], format: 'photo', links: [] };

describe('MockTardyApi agent controls', () => {
  it('starts every agent at the safe defaults and keeps changes', async () => {
    const client = api();
    expect(await client.agentControls('a-opus-be')).toEqual(DEFAULT_AGENT_CONTROLS);
    const next = await client.updateAgentControls('a-opus-be', { posts: 'auto', dailyLimit: null });
    expect(next).toMatchObject({ posts: 'auto', dailyLimit: null });
    expect((await client.agentControls('a-opus-be')).posts).toBe('auto');
    expect((await client.agentControls('a-sonnet-ui')).posts).toBe('ask');
  });

  it("refuses other people's agents and bad values", async () => {
    const client = api();
    await expect(client.agentControls('a-bom')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(client.updateAgentControls('a-bom', { paused: true })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(client.updateAgentControls('a-opus-be', { posts: 'always' as never })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('queues a post for approval when posts ask first', async () => {
    const client = api();
    const result = client.agentPosts('a-opus-be', content, 'followers', NOON);
    expect(result.outcome).toBe('queued');
    expect((await client.postSuggestions()).some((s) => s.post.caption === 'Shipped the thing')).toBe(true);
  });

  it('posts on its own when allowed, and logs it', async () => {
    const client = api();
    await client.updateAgentControls('a-opus-be', { posts: 'auto', quietHours: false });
    const result = client.agentPosts('a-opus-be', content, 'followers', NOON);
    expect(result.outcome).toBe('posted');
    const log = await client.agentActivity('a-opus-be');
    expect(log[0]).toMatchObject({ kind: 'post', how: 'auto', summary: 'Posted: Shipped the thing' });
  });

  it('asks instead once the daily cap is reached', async () => {
    const client = api();
    await client.updateAgentControls('a-opus-be', { posts: 'auto', quietHours: false, dailyLimit: 3 });
    const outcomes = [1, 2, 3, 4].map(() => client.agentPosts('a-opus-be', content, 'followers', new Date()).outcome);
    expect(outcomes).toEqual(['posted', 'posted', 'posted', 'queued']);
  });

  it('refuses a paused agent and logs the attempt', async () => {
    const client = api();
    await client.updateAgentControls('a-opus-be', { paused: true });
    expect(() => client.agentPosts('a-opus-be', content, 'followers', NOON)).toThrow(expect.objectContaining({ code: 'forbidden' }));
    expect((await client.agentActivity('a-opus-be'))[0]).toMatchObject({ how: 'blocked' });
  });

  it('logs approvals and rejections from the deck, by kind', async () => {
    const client = api();
    await client.decideSuggestion('sug-comment-bom', 'approve');
    await client.decideSuggestion('sug-follow-avery', 'reject');
    expect((await client.agentActivity('a-opus-be'))[0]).toMatchObject({ kind: 'comment', how: 'approved' });
    expect((await client.agentActivity('a-sonnet-ui'))[0]).toMatchObject({ kind: 'follow', how: 'rejected', summary: expect.stringContaining('@avery') });
  });

  it('an approved comment shows up on the tardy as the agent', async () => {
    const client = api();
    const suggestion = (await client.postSuggestions()).find((s) => s.id === 'sug-comment-bom')!;
    await client.decideSuggestion(suggestion.id, 'approve');
    const comments = await client.comments(suggestion.target!.postId!);
    expect(comments.some((c) => c.authorId === 'a-opus-be' && c.text === suggestion.post.caption)).toBe(true);
  });
});
