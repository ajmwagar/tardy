import { MOCK_AGENT_CLAIM_CODE, MockTardyApi } from '@/data/mock/mock-api';

const api = (plan?: 'free' | 'builder' | 'studio') => new MockTardyApi({ latencyMs: 0, plan });

describe('MockTardyApi membership', () => {
  it('reports the plan, card payment, and usage by hosting', async () => {
    const m = await api().membership();
    expect(m).toMatchObject({ plan: 'builder', paidWith: 'stripe', usage: { managed: 1, connected: 1 }, autopay: null });
    expect(Date.parse(m.paidThrough!)).toBeGreaterThan(Date.now());
  });

  it('lets an approved agent renew by x402, and nothing else', async () => {
    const client = api();
    await expect(client.simulateAutopayRun()).rejects.toMatchObject({ code: 'forbidden' });
    const before = Date.parse((await client.membership()).paidThrough!);
    await client.approveAutopay({ plan: 'builder', payerAgentId: 'a-opus-be', maxCentsPerMonth: 2_500 });
    const after = await client.simulateAutopayRun();
    expect(after.paidWith).toBe('x402');
    expect(Date.parse(after.paidThrough!)).toBeGreaterThan(before);
    await client.revokeAutopay();
    await expect(client.simulateAutopayRun()).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses approvals for agents you do not own, Free, or a cap under the price', async () => {
    const client = api();
    await expect(client.approveAutopay({ plan: 'builder', payerAgentId: 'a-fw', maxCentsPerMonth: 2_500 })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(client.approveAutopay({ plan: 'free', payerAgentId: 'a-opus-be', maxCentsPerMonth: 0 })).rejects.toMatchObject({ code: 'invalid' });
    await expect(client.approveAutopay({ plan: 'studio', payerAgentId: 'a-opus-be', maxCentsPerMonth: 2_500 })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('runs the Free demo once', async () => {
    const client = api('free');
    expect((await client.membership()).demo).toEqual({ status: 'available' });
    const running = await client.startManagedDemo();
    expect(running.demo).toMatchObject({ status: 'running' });
    await expect(client.startManagedDemo()).rejects.toMatchObject({ code: 'invalid' });
    await expect(api().startManagedDemo()).rejects.toMatchObject({ code: 'invalid' });
  });

  it('blocks a claim past the plan limit with the reason', async () => {
    // Free allows one connected agent; the fixture viewer already runs sonnet.ui.
    await expect(api('free').claimAgent(MOCK_AGENT_CLAIM_CODE)).rejects.toMatchObject({ code: 'forbidden', message: expect.stringMatching(/Free includes 1 connected agent/) });
    await expect(api('builder').claimAgent(MOCK_AGENT_CLAIM_CODE)).resolves.toBeUndefined();
  });
});
