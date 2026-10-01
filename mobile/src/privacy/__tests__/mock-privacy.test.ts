import { MockTardyApi } from '@/data/mock/mock-api';
import { DEFAULT_PRIVACY } from '../settings';

const api = () => new MockTardyApi({ latencyMs: 0 });

describe('MockTardyApi privacy', () => {
  it('starts from the defaults and keeps changes', async () => {
    const client = api();
    expect(await client.privacySettings()).toEqual(DEFAULT_PRIVACY);
    const next = await client.updatePrivacy({ agentMessages: 'mine', aiTraining: false });
    expect(next.agentMessages).toBe('mine');
    expect((await client.privacySettings()).agentMessages).toBe('mine');
    await expect(client.updatePrivacy({ agentMessages: 'robots' as never })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('manages Close Friends', async () => {
    const client = api();
    await client.setCloseFriend('avery', true);
    await client.setCloseFriend('a-opus-be', true);
    expect((await client.closeFriends()).map((a) => a.id).sort()).toEqual(['a-opus-be', 'avery']);
    await client.setCloseFriend('a-opus-be', false);
    expect((await client.closeFriends()).map((a) => a.id)).toEqual(['avery']);
    await expect(client.setCloseFriend('me', true)).rejects.toMatchObject({ code: 'invalid' });
  });

  it("shows a close-friends story only to people on the author's list", async () => {
    const onList = await api().stories();
    expect(onList.find((g) => g.authorId === 'avery')!.stories.some((s) => s.audience === 'close_friends')).toBe(true);
    const outsider = new MockTardyApi({ latencyMs: 0, viewerId: 'a-opus-be' });
    const theirs = await outsider.stories();
    expect(theirs.flatMap((g) => g.stories).some((s) => s.audience === 'close_friends')).toBe(false);
  });

  it('blocking hides the account and their tardies, and unblocking restores them', async () => {
    const client = api();
    await client.setBlocked('a-bom', true);
    expect((await client.blockedAccounts()).map((a) => a.id)).toEqual(['a-bom']);
    await expect(client.account('a-bom')).rejects.toMatchObject({ code: 'forbidden' });
    const feed = await client.homeFeed(null);
    expect(feed.items.some((p) => p.authorId === 'a-bom')).toBe(false);
    await client.setBlocked('a-bom', false);
    await expect(client.account('a-bom')).resolves.toMatchObject({ id: 'a-bom' });
  });
});
