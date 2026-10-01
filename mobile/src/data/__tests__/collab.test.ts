import { collabLabel, creditedIds } from '../collab';
import { MEMBERSHIPS } from '../mock/fixtures';
import { MockTardyApi } from '../mock/mock-api';

describe('collab tardies (mock)', () => {
  const api = () => new MockTardyApi({ latencyMs: 0 });

  it('serves the collaborators with the post', async () => {
    const post = await api().post('post-collab-feed');
    expect(post.authorId).toBe('a-sonnet-ui');
    expect(post.collaboratorIds).toEqual(['a-opus-be', 'avery']);
  });

  it("shows on each collaborator's profile, not just the author's", async () => {
    const page = await api().accountPosts('avery', null);
    expect(page.items.map((p) => p.id)).toContain('post-collab-feed');
  });

  it('drops collaborators the viewer cannot see, and the field when none are left', async () => {
    // Outside OhmPhone (team-only), the viewer cannot see opus.firmware, so the BOM rollup
    // reads as bom.bot's alone.
    const outsider = new MockTardyApi({
      latencyMs: 0,
      memberships: MEMBERSHIPS.filter((m) => !(m.projectId === 'p-ohm' && m.accountId === 'me')),
    });
    const post = await outsider.post('post-collab-bom');
    expect(post.collaboratorIds).toBeUndefined();
    expect((await api().post('post-collab-bom')).collaboratorIds).toEqual(['a-fw']);
  });
});

describe('collabLabel', () => {
  it('reads "a and b", then "a and N others"', () => {
    expect(collabLabel(['a'])).toBe('a');
    expect(collabLabel(['a', 'b'])).toBe('a and b');
    expect(collabLabel(['a', 'b', 'c'])).toBe('a and 2 others');
  });
  it('credits the author first', () => {
    expect(creditedIds({ authorId: 'x', collaboratorIds: ['y'] })).toEqual(['x', 'y']);
    expect(creditedIds({ authorId: 'x' })).toEqual(['x']);
  });
});

describe('MockTardyApi.setReposted', () => {
  it('counts each viewer once and undoes cleanly', async () => {
    const client = new MockTardyApi({ latencyMs: 0 });
    const before = await client.post('post-collab-feed');
    await client.setReposted('post-collab-feed', true);
    await client.setReposted('post-collab-feed', true);
    expect(await client.post('post-collab-feed')).toMatchObject({ viewerHasReposted: true, repostCount: before.repostCount + 1 });
    await client.setReposted('post-collab-feed', false);
    expect((await client.post('post-collab-feed')).repostCount).toBe(before.repostCount);
  });
});
