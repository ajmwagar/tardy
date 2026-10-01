import { isGroupBoosted, orderStoryTray } from '@/stories/boost';

import { BOOSTED_STORY_AUTHOR, STORIES } from '../fixtures';
import { MockTardyApi } from '../mock-api';

describe('mock stories()', () => {
  it('serves the tray in boost order: the boosted fixture group first, with a red-ring boost', async () => {
    const groups = await new MockTardyApi({ viewerId: 'me', latencyMs: 0 }).stories();
    const now = Date.now();
    expect(groups[0].authorId).toBe(BOOSTED_STORY_AUTHOR);
    expect(isGroupBoosted(groups[0], now)).toBe(true);
    expect(groups.slice(1).some((g) => isGroupBoosted(g, now))).toBe(false);
    expect(orderStoryTray(groups, now)).toEqual(groups);
  });

  it('keeps the fixture order for unboosted groups', async () => {
    const groups = await new MockTardyApi({ viewerId: 'me', latencyMs: 0 }).stories();
    const fixtureOrder = [...new Set(STORIES.map((s) => s.authorId))].filter((id) => id !== BOOSTED_STORY_AUTHOR);
    const served = groups.slice(1).map((g) => g.authorId);
    expect(served).toEqual(fixtureOrder.filter((id) => served.includes(id)));
  });
});
