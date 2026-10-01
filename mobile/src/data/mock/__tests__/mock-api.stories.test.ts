import { isGroupBoosted, isGroupSeen, orderStoryTray } from '@/stories/boost';

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

  it('keeps fixture order for unboosted groups, with fully seen groups at the back', async () => {
    const groups = await new MockTardyApi({ viewerId: 'me', latencyMs: 0 }).stories();
    const served = groups.slice(1);
    const fixtureOrder = [...new Set(STORIES.map((s) => s.authorId))].filter((id) => served.some((g) => g.authorId === id));
    const seen = new Set(served.filter((g) => isGroupSeen(g)).map((g) => g.authorId));
    expect(served.map((g) => g.authorId)).toEqual([
      ...fixtureOrder.filter((id) => !seen.has(id)),
      ...fixtureOrder.filter((id) => seen.has(id)),
    ]);
  });
});
