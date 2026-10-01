import { rankForYou } from '@/ranking/for-you';

import { TardyApiError } from '../../api';
import type { Page, Post } from '../../types';
import { ACCOUNTS, MEMBERSHIPS, POSTS } from '../fixtures';
import { MockTardyApi } from '../mock-api';

/**
 * Leak tests: whatever the mock serves, nothing from a project the viewer may not see.
 * The allowed set is computed straight from the fixtures, not via the policy module, so
 * these tests check the enforcement independently of the rules' implementation.
 */

const projectOf = (accountId: string) => {
  const a = ACCOUNTS.find((x) => x.id === accountId)!;
  return a.kind === 'project' ? a.id : a.kind === 'agent' ? a.projectId : undefined;
};

function visibleProjects(viewerId: string): Set<string> {
  return new Set(
    ACCOUNTS.filter((p) => p.kind === 'project').filter((p) => {
      const role = MEMBERSHIPS.find((m) => m.projectId === p.id && m.accountId === viewerId)?.role;
      return p.visibility === 'public' || (p.visibility === 'team' && role !== undefined) || role === 'owner';
    }).map((p) => p.id),
  );
}

const SCENARIOS = [
  // Follows the team projects (p-lob, p-ohm) and their agents, but belongs to none.
  { viewerId: 'c-ugc', hidden: ['p-lob', 'p-ohm', 'p-pan'] as string[] },
  // Member of the team projects, outside private Panopticon.
  { viewerId: 'me', hidden: ['p-pan'] as string[] },
];

const api = (viewerId: string) => new MockTardyApi({ viewerId, latencyMs: 0 });

async function drain(fetch: (cursor: string | null) => Promise<Page<Post>>, maxPages = 20): Promise<Post[]> {
  const out: Post[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const page: Page<Post> = await fetch(cursor);
    out.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return out;
}

const forbidden = expect.objectContaining({ name: 'TardyApiError', code: 'forbidden' });

test('the fixture scenarios are what the tests assume', () => {
  for (const { viewerId, hidden } of SCENARIOS) {
    const visible = visibleProjects(viewerId);
    expect(hidden.filter((p) => visible.has(p))).toEqual([]);
    expect(POSTS.some((p) => hidden.includes(projectOf(p.authorId) ?? ''))).toBe(true);
  }
});

describe.each(SCENARIOS)('as $viewerId', ({ viewerId, hidden }) => {
  const allowed = visibleProjects(viewerId);
  const leaks = (post: Post) => {
    const projects = [post.projectId, projectOf(post.authorId)].filter((p): p is string => p !== undefined);
    return projects.some((p) => !allowed.has(p));
  };
  const hiddenPosts = POSTS.filter(leaks);
  const hiddenAgents = ACCOUNTS.filter((a) => a.kind === 'agent' && hidden.includes(a.projectId ?? ''));

  test('homeFeed, reelsFeed, and trending never include hidden posts', async () => {
    const m = api(viewerId);
    const home = await drain((c) => m.homeFeed(c));
    const reels = await drain((c) => m.reelsFeed(c), 5);
    const trending = await m.trending();
    expect(home.length).toBeGreaterThan(0);
    expect(reels.length).toBeGreaterThan(0);
    expect([...home, ...reels, ...trending].filter(leaks)).toEqual([]);
    // Not over-blocking: the feed is exactly what the ranker admits from the visible set
    // (it applies its own age filter on top).
    const admitted = rankForYou(POSTS.filter((p) => !leaks(p)), {
      id: viewerId,
      following: new Set(),
      mutuals: new Set(),
      history: [],
    });
    expect(new Set(home.map((p) => p.id))).toEqual(new Set(admitted.map((r) => r.post.id)));
  });

  test('profiles and posts of hidden projects throw forbidden', async () => {
    const m = api(viewerId);
    for (const projectId of hidden) {
      const project = ACCOUNTS.find((a) => a.id === projectId)!;
      await expect(m.account(projectId)).rejects.toEqual(forbidden);
      await expect(m.accountByHandle(project.handle)).rejects.toEqual(forbidden);
      await expect(m.accounts(['avery', projectId])).rejects.toEqual(forbidden);
      await expect(m.accountPosts(projectId, null)).rejects.toEqual(forbidden);
    }
    for (const agent of hiddenAgents) {
      await expect(m.account(agent.id)).rejects.toEqual(forbidden);
      await expect(m.accountPosts(agent.id, null)).rejects.toEqual(forbidden);
    }
    for (const post of hiddenPosts) {
      await expect(m.post(post.id)).rejects.toEqual(forbidden);
      await expect(m.comments(post.id)).rejects.toEqual(forbidden);
      await expect(m.setLiked(post.id, true)).rejects.toEqual(forbidden);
      await expect(m.setAlarm(post.id, true)).rejects.toEqual(forbidden);
    }
    await expect(m.setFollowing(hidden[0], true)).rejects.toBeInstanceOf(TardyApiError);
  });

  test('visible profiles never list hidden posts', async () => {
    const m = api(viewerId);
    for (const id of ['p-tardy', 'p-quo', 'a-opus-be', 'avery']) {
      expect((await drain((c) => m.accountPosts(id, c))).filter(leaks)).toEqual([]);
    }
  });

  test('comments, stories, notifications, and follows omit hidden accounts', async () => {
    const m = api(viewerId);
    const hiddenIds = new Set([...hidden, ...hiddenAgents.map((a) => a.id)]);
    const visiblePosts = POSTS.filter((p) => !leaks(p));
    const comments = (await Promise.all(visiblePosts.map((p) => m.comments(p.id)))).flat();
    expect(comments.filter((c) => hiddenIds.has(c.authorId))).toEqual([]);

    const stories = await m.stories();
    expect(stories.filter((s) => hiddenIds.has(s.authorId))).toEqual([]);

    const notifications = await m.notifications();
    const hiddenPostIds = new Set(hiddenPosts.map((p) => p.id));
    expect(notifications.filter((n) => hiddenIds.has(n.actorId) || (n.postId && hiddenPostIds.has(n.postId)))).toEqual([]);

    expect((await m.followingIds()).filter((id) => hiddenIds.has(id))).toEqual([]);
  });
});

describe('DMs', () => {
  test('a shared post the reader cannot see arrives as unavailable, with no id', async () => {
    const m = api('me');
    const messages = await m.messages('t-avery');
    const shares = messages.filter((x) => x.sharedPost);
    expect(shares).toHaveLength(1);
    expect(shares[0].sharedPost).toEqual({ status: 'unavailable' });
    const panPostIds = POSTS.filter((p) => p.projectId === 'p-pan').map((p) => p.id);
    expect(panPostIds.some((id) => JSON.stringify(messages).includes(`"${id}"`))).toBe(false);
  });

  test('a shared post the reader can see stays available', async () => {
    const messages = await api('me').messages('t-sonnet');
    expect(messages[0].sharedPost).toEqual({ status: 'available', postId: expect.any(String) });
  });

  test('threads with a participant the viewer cannot see are hidden and throw', async () => {
    // Without membership, the BOM and firmware agents (team projects) are hidden from me.
    const outsider = new MockTardyApi({ latencyMs: 0, memberships: MEMBERSHIPS.filter((x) => x.accountId !== 'me') });
    const ids = (await outsider.threads()).map((t) => t.id);
    expect(ids).not.toContain('t-bom');
    expect(ids).not.toContain('t-fw');
    await expect(outsider.messages('t-bom')).rejects.toEqual(forbidden);
    await expect(outsider.sendMessage('t-bom', 'hi')).rejects.toEqual(forbidden);
  });
});

describe('setVisibility', () => {
  test('owners can change it, and the response says they own it', async () => {
    const m = api('me');
    const updated = await m.setVisibility('p-tardy', 'team');
    expect(updated).toMatchObject({ id: 'p-tardy', visibility: 'team', viewerRole: 'owner' });
    expect(await m.account('p-tardy')).toMatchObject({ visibility: 'team' });
  });

  test('members and outsiders get forbidden, and nothing changes', async () => {
    const m = api('me');
    await expect(m.setVisibility('p-lob', 'public')).rejects.toEqual(forbidden);
    await expect(m.setVisibility('p-quo', 'private')).rejects.toEqual(forbidden);
    await expect(m.setVisibility('p-pan', 'public')).rejects.toEqual(forbidden);
    expect(await m.account('p-lob')).toMatchObject({ visibility: 'team', viewerRole: 'member' });
    expect(await m.account('p-quo')).toMatchObject({ visibility: 'public' });
  });

  test('non-projects are not found', async () => {
    await expect(api('me').setVisibility('a-opus-be', 'private')).rejects.toEqual(
      expect.objectContaining({ code: 'not_found' }),
    );
  });

});
