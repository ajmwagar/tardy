import { conversationPlan, sameMembers } from '../conversation-plan';

const human = (id: string) => ({ id, kind: 'human' as const });
const agent = (id: string) => ({ id, kind: 'agent' as const });

describe('conversationPlan', () => {
  it('opens a DM with the person, then adds agents', () => {
    expect(conversationPlan([agent('a1'), human('h1'), agent('a2')], 'me')).toEqual({ ok: true, recipientId: 'h1', addAgentIds: ['a1', 'a2'] });
  });

  it('opens straight to the first agent when there is no person', () => {
    expect(conversationPlan([agent('a1'), agent('a2')], 'me')).toEqual({ ok: true, recipientId: 'a1', addAgentIds: ['a2'] });
  });

  it('ignores the viewer and duplicates', () => {
    expect(conversationPlan([human('me'), human('h1'), human('h1')], 'me')).toEqual({ ok: true, recipientId: 'h1', addAgentIds: [] });
  });

  it('refuses a human group and an empty thread instead of dropping anyone', () => {
    expect(conversationPlan([human('h1'), human('h2')], 'me')).toEqual({ ok: false, reason: 'unsupported' });
    expect(conversationPlan([human('me')], 'me')).toEqual({ ok: false, reason: 'nobody' });
  });
});

describe('sameMembers', () => {
  it('matches the exact set, order-free', () => {
    expect(sameMembers(['h1', 'me'], 'me', ['h1'])).toBe(true);
    expect(sameMembers(['h1', 'me', 'a1'], 'me', ['h1'])).toBe(false);
  });
});
