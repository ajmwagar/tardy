import { autopayCovers, canAdd, limitMessage, PLANS, planFeatures, priceLabel } from '../plans';

describe('plans', () => {
  it('prices and limits match the pricing James set', () => {
    expect([PLANS.free, PLANS.builder, PLANS.studio].map((p) => [priceLabel(p), p.managed, p.connected])).toEqual([
      ['Free', 0, 1],
      ['$25/mo', 1, 3],
      ['$250/mo', 5, null],
    ]);
  });

  it('describes what each plan includes', () => {
    expect(planFeatures(PLANS.free)).toEqual(['1 agent you run yourself', 'Try a managed agent free for 24 hours']);
    expect(planFeatures(PLANS.studio)).toEqual(['5 managed agents, hosted by Tardy', 'Unlimited agents you run yourself']);
  });

  it('enforces limits, counting a running demo as one managed slot', () => {
    expect(canAdd(PLANS.builder, { managed: 0, connected: 3 }, 'connected')).toBe(false);
    expect(canAdd(PLANS.studio, { managed: 5, connected: 999 }, 'connected')).toBe(true);
    expect(canAdd(PLANS.free, { managed: 0, connected: 0 }, 'managed')).toBe(false);
    expect(canAdd(PLANS.free, { managed: 0, connected: 0 }, 'managed', true)).toBe(true);
  });

  it('says why, and which plan has room', () => {
    expect(limitMessage(PLANS.builder, { managed: 1, connected: 0 }, 'managed')).toBe('Builder includes 1 managed agent. Studio ($250/mo) includes more.');
    expect(limitMessage(PLANS.studio, { managed: 5, connected: 0 }, 'managed')).toBe('Studio includes 5 managed agents.');
    expect(limitMessage(PLANS.builder, { managed: 0, connected: 0 }, 'connected')).toBeNull();
  });

  it('lets an agent pay only what the human approved', () => {
    const mandate = { plan: 'builder' as const, payerAgentId: 'a1', maxCentsPerMonth: 2_500 };
    expect(autopayCovers(mandate, { plan: 'builder', payerAgentId: 'a1', cents: 2_500 })).toBe(true);
    expect(autopayCovers(mandate, { plan: 'builder', payerAgentId: 'a1', cents: 2_501 })).toBe(false);
    expect(autopayCovers(mandate, { plan: 'studio', payerAgentId: 'a1', cents: 2_500 })).toBe(false);
    expect(autopayCovers(mandate, { plan: 'builder', payerAgentId: 'a2', cents: 2_500 })).toBe(false);
    expect(autopayCovers(null, { plan: 'builder', payerAgentId: 'a1', cents: 1 })).toBe(false);
  });
});
