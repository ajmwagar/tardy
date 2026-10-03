import { TardyApiError } from '@/data/api';
import { MOCK_AGENT_CLAIM_CODE, MockTardyApi } from '@/data/mock/mock-api';
import { POSTS } from '@/data/mock/fixtures';

import { matchRank, searchRanked } from '../search';
import { contextGrant, lastUsed, promotionNotice, shareSections, threadKind } from '../sections';
import { share, shareThreadSets } from '../send';
import { threadLabel } from '../thread-label';

const api = () => new MockTardyApi({ latencyMs: 0 });
/** Fixture accounts as thread participants. */
const p = (...ids: string[]) => ids.map((id) => ({ id, kind: (id.startsWith('a-') ? 'agent' : 'human') as 'agent' | 'human' }));
const publicPost = POSTS.find((p) => p.authorId === 'a-opus-be')!.id;

describe('matchRank', () => {
  const avery = { handle: 'avery', name: 'Avery Wagar' };
  it('ranks handle prefix, then name word prefix, then substring', () => {
    expect(matchRank(avery, 'av')).toBe(0);
    expect(matchRank(avery, '@AV')).toBe(0);
    expect(matchRank(avery, 'wag')).toBe(1);
    expect(matchRank(avery, 'ery')).toBe(2);
    expect(matchRank(avery, 'zz')).toBeNull();
    expect(matchRank(avery, '  ')).toBe(0);
  });

  it('keeps input order within a rank', () => {
    const list = [
      { handle: 'x-bob', name: 'Bob' },
      { handle: 'bob', name: 'Robert' },
      { handle: 'bobby', name: 'Bobby' },
    ];
    expect(searchRanked(list, 'bob').map((a) => a.handle)).toEqual(['bob', 'bobby', 'x-bob']);
  });
});

describe('shareThreadSets', () => {
  it('makes one group, or one thread per recipient, without duplicates', () => {
    const ids = (sets: { id: string }[][]) => sets.map((set) => set.map((x) => x.id));
    expect(ids(shareThreadSets(p('a', 'b', 'a'), 'group'))).toEqual([['a', 'b']]);
    expect(ids(shareThreadSets(p('a', 'b'), 'separately'))).toEqual([['a'], ['b']]);
    expect(shareThreadSets([], 'group')).toEqual([]);
  });
});

describe('MockTardyApi.openThread', () => {
  it('returns the existing 1:1 thread instead of a duplicate', async () => {
    const client = api();
    expect((await client.openThread(p('avery'))).id).toBe('t-avery');
    expect((await client.openThread(p('me', 'avery'))).id).toBe('t-avery');
  });

  it('gives groups their own identity even when membership matches', async () => {
    const client = api();
    const group = await client.openThread(p('avery', 'a-opus-be'), 'Feed launch');
    expect(group.title).toBe('Feed launch');
    expect([...group.participantIds].sort()).toEqual(['a-opus-be', 'avery', 'me']);
    expect((await client.openThread(p('a-opus-be', 'avery'), 'Second room')).id).not.toBe(group.id);
  });

  it('renames groups and mutates membership without replacing the thread', async () => {
    const client = api();
    const group = await client.openThread(p('avery'), 'Draft');
    const renamed = await client.renameThread(group.id, 'Ship Room');
    expect(renamed).toMatchObject({ id: group.id, title: 'Ship Room' });
    await expect(client.addThreadParticipant(group.id, 'a-opus-be')).rejects.toEqual(expect.objectContaining({ code: 'invalid' }));
    const expanded = await client.addAgent(group.id, 'a-opus-be');
    expect(expanded.participantIds).toContain('a-opus-be');
    const reduced = await client.removeThreadParticipant(group.id, 'a-opus-be');
    expect(reduced.id).toBe(group.id);
    expect(reduced.participantIds).not.toContain('a-opus-be');
  });

  it('hides an empty new thread from the inbox until it has a message', async () => {
    const client = api();
    const group = await client.openThread(p('avery', 'a-fw'));
    expect((await client.threads()).some((t) => t.id === group.id)).toBe(false);
    await client.sendMessage(group.id, 'hi');
    expect((await client.threads())[0].id).toBe(group.id);
  });

  it('rejects a thread with no one else', async () => {
    await expect(api().openThread(p('me'))).rejects.toEqual(expect.objectContaining({ code: 'invalid' }) as TardyApiError);
  });
});

describe('MockTardyApi.sendMessage with a post', () => {
  it('carries the shared post, and needs text or a post', async () => {
    const client = api();
    const message = await client.sendMessage('t-fw', '', { sharedPostId: publicPost });
    expect(message.sharedPost).toEqual({ status: 'available', postId: publicPost });
    await expect(client.sendMessage('t-fw', '  ')).rejects.toEqual(expect.objectContaining({ code: 'invalid' }) as TardyApiError);
  });
});

describe('MockTardyApi.searchAccounts', () => {
  it('suggests recent conversations first and never the viewer', async () => {
    const results = await api().searchAccounts('');
    expect(results[0].id).toBe('a-opus-be');
    expect(results.some((a) => a.id === 'me')).toBe(false);
  });

  it('finds accounts beyond the viewer’s circle when they type', async () => {
    const results = await api().searchAccounts('ave');
    expect(results[0].handle).toBe('avery');
  });
});

describe('share', () => {
  it('sends to each recipient separately', async () => {
    const client = api();
    const result = await share(client, {
      recipients: p('avery', 'a-fw'),
      mode: 'separately',
      attachment: { sharedPostId: publicPost },
      note: 'look',
    });
    expect(result.sent.map((t) => t.id)).toEqual(['t-avery', 't-fw']);
    expect(result.failed).toEqual([]);
    const last = (await client.messages('t-avery')).at(-1)!;
    expect(last).toEqual(expect.objectContaining({ text: 'look', sharedPost: { status: 'available', postId: publicPost } }));
  });

  it('sends once into a new group', async () => {
    const client = api();
    const result = await share(client, {
      recipients: p('avery', 'a-fw'),
      mode: 'group',
      attachment: { sharedPostId: publicPost },
      title: 'Crew',
    });
    expect(result.sent).toHaveLength(1);
    expect(result.sent[0].title).toBe('Crew');
    expect(await client.messages(result.sent[0].id)).toHaveLength(1);
  });

  it('reports a failed recipient and still delivers to the rest', async () => {
    const client = api();
    const result = await share(client, {
      recipients: p('avery', 'nobody'),
      mode: 'separately',
      attachment: { sharedPostId: publicPost },
    });
    expect(result.sent.map((t) => t.id)).toEqual(['t-avery']);
    expect(result.failed).toEqual([{ participantIds: ['nobody'], error: expect.stringMatching(/nobody/) }]);
  });

  it('only opens the thread when there is nothing to send', async () => {
    const client = api();
    const result = await share(client, { recipients: p('a-bom', 'a-fw'), mode: 'group' });
    expect(await client.messages(result.sent[0].id)).toEqual([]);
  });
});

describe('threadLabel', () => {
  const handle = (id: string) => ({ a: 'avery', b: 'opus-be', c: 'fw', d: 'bom' })[id];
  it('uses the title, then handles, then a +N tail', () => {
    expect(threadLabel({ id: 't', participantIds: ['me', 'a'], title: 'Crew' }, 'me', handle)).toBe('Crew');
    expect(threadLabel({ id: 't', participantIds: ['me', 'a'] }, 'me', handle)).toBe('avery');
    expect(threadLabel({ id: 't', participantIds: ['me', 'a', 'b'] }, 'me', handle)).toBe('avery, opus-be');
    expect(threadLabel({ id: 't', participantIds: ['me', 'a', 'b', 'c', 'd'] }, 'me', handle)).toBe('avery, opus-be +2');
  });
});

describe('share into an existing group', () => {
  it('sends into the picked group and to new recipients in one go', async () => {
    const client = api();
    const crew = await client.thread('t-crew');
    const result = await share(client, {
      recipients: p('a-fw'),
      threads: [crew],
      mode: 'group',
      attachment: { sharedPostId: publicPost },
    });
    expect(result.sent.map((t) => t.id)).toEqual(['t-crew', 't-fw']);
    expect((await client.messages('t-crew')).at(-1)!.sharedPost).toEqual({ status: 'available', postId: publicPost });
  });
});

describe('shareSections', () => {
  const c = (id: string, kind: 'agent' | 'human' | 'project' | 'group', lastUsedMs?: number, ownedByViewer?: boolean) => ({
    id,
    kind,
    lastUsedMs,
    ownedByViewer,
  });
  const view = (sections: { title: string; items: { id: string }[] }[]) =>
    sections.map((s) => [s.title, s.items.map((i) => i.id)]);

  it('puts your agents first, then mixes everyone else most recently used first', () => {
    const candidates = [
      c('brand', 'project'),
      c('friend-old', 'human', 100),
      c('crew', 'group', 300),
      c('other-agent', 'agent', 200),
      c('mine-old', 'agent', 10, true),
      c('mine-new', 'agent', 50, true),
    ];
    expect(view(shareSections(candidates, { byRecency: true }))).toEqual([
      ['Your agents', ['mine-new', 'mine-old']],
      ['Recent', ['crew', 'other-agent', 'friend-old', 'brand']],
    ]);
  });

  it('keeps relevance order while searching, and drops empty sections', () => {
    const candidates = [c('b', 'human', 1), c('a', 'human', 999)];
    expect(view(shareSections(candidates, { byRecency: false }))).toEqual([['Recent', ['b', 'a']]]);
  });

  it('dates 1:1 threads by the other person and groups by themselves', () => {
    const at = (iso: string) => ({ createdAt: iso }) as never;
    const used = lastUsed(
      [
        { id: 't1', participantIds: ['me', 'h1'], lastMessage: at('1970-01-01T00:00:01Z') },
        { id: 't2', participantIds: ['me', 'h1', 'a1'], lastMessage: at('1970-01-01T00:00:02Z') },
      ],
      'me',
    );
    expect(used.get('h1')).toBe(1000);
    expect(used.get('g:t2')).toBe(2000);
  });

  it('makes a thread work only when an agent is in it', () => {
    expect(threadKind([{ kind: 'human' }, { kind: 'human' }])).toBe('dm');
    expect(threadKind([{ kind: 'human' }, { kind: 'agent' }])).toBe('work');
  });

  it('names exactly what picked agents will see', () => {
    expect(contextGrant([], 'post')).toBeNull();
    expect(contextGrant(['opus.backend'], 'post')).toBe(
      'opus.backend gets this tardy and new messages in this chat. Nothing from your other DMs.',
    );
    expect(contextGrant(['opus.backend'], 'link')).toMatch(/^opus.backend gets this link and/);
    expect(contextGrant(['a', 'b', 'c'], null)).toBe('a, b and c get new messages in this chat. Nothing from your other DMs.');
  });

  it('labels fixture threads by who is in them', async () => {
    const client = api();
    expect((await client.thread('t-avery')).kind).toBe('dm');
    expect((await client.thread('t-crew')).kind).toBe('work');
    expect((await client.openThread(p('avery', 'a-fw'))).kind).toBe('work');
  });
});

describe('promotionNotice', () => {
  it('names the agent and the context boundary, and warns a DM it is permanent', () => {
    const dm = promotionNotice('opus.backend', false);
    expect(dm.title).toBe('Add opus.backend to this chat?');
    expect(dm.message).toMatch(/can’t be undone/);
    expect(dm.message).toMatch(/Nothing said before now/);
    expect(promotionNotice('opus.backend', true).message).not.toMatch(/undone/);
  });
});

describe('MockTardyApi.addAgent', () => {
  it('promotes a DM to work with an owned agent, idempotently', async () => {
    const client = api();
    const once = await client.addAgent('t-avery', 'a-opus-be');
    expect(once.kind).toBe('work');
    expect(once.participantIds).toContain('a-opus-be');
    expect((await client.addAgent('t-avery', 'a-opus-be')).participantIds).toEqual(once.participantIds);
  });

  it('refuses an agent the viewer does not own, until they claim it', async () => {
    const client = api();
    await expect(client.addAgent('t-avery', 'a-fw')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(client.claimAgent('nope')).rejects.toMatchObject({ code: 'invalid' });
    await client.claimAgent(MOCK_AGENT_CLAIM_CODE.toLowerCase());
    expect((await client.account('a-fw')).ownedByViewer).toBe(true);
    await expect(client.addAgent('t-avery', 'a-fw')).resolves.toMatchObject({ kind: 'work' });
  });

  it('refuses a person', async () => {
    await expect(api().addAgent('t-avery', 'avery')).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('MockTardyApi.createSharedLink', () => {
  it('dedupes by canonical URL and rejects non-http', async () => {
    const client = api();
    const a = await client.createSharedLink('https://www.youtube.com/watch?v=1&utm_source=x');
    const b = await client.createSharedLink('https://youtube.com/watch?v=1');
    expect(b.id).toBe(a.id);
    expect(a).toMatchObject({ canonicalUrl: 'https://youtube.com/watch?v=1', provider: 'youtube', status: 'queued' });
    await expect(client.createSharedLink('ftp://x')).rejects.toMatchObject({ code: 'invalid' });
    const sent = await client.sendMessage('t-avery', '', { sharedLinkId: a.id });
    expect(sent.sharedLinkId).toBe(a.id);
  });
});
