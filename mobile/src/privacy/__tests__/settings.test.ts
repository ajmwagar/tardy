import { agentAllowed, DEFAULT_PRIVACY, privacyProblem } from '../settings';

describe('privacy settings', () => {
  it('defaults are protective for agents and AI training', () => {
    expect(DEFAULT_PRIVACY.agentMessages).toBe('followed');
    expect(DEFAULT_PRIVACY.aiTraining).toBe(false);
  });

  it('decides which agents may reach you', () => {
    const mine = { ownedByViewer: true, ownerFollowedByViewer: false };
    const friends = { ownedByViewer: false, ownerFollowedByViewer: true };
    const stranger = { ownedByViewer: false, ownerFollowedByViewer: false };
    expect([mine, friends, stranger].map((a) => agentAllowed('everyone', a))).toEqual([true, true, true]);
    expect([mine, friends, stranger].map((a) => agentAllowed('followed', a))).toEqual([true, true, false]);
    expect([mine, friends, stranger].map((a) => agentAllowed('mine', a))).toEqual([true, false, false]);
    expect([mine, friends, stranger].map((a) => agentAllowed('none', a))).toEqual([false, false, false]);
  });

  it('rejects unknown keys and bad values', () => {
    expect(privacyProblem({ agentMessages: 'mine', aiTraining: true })).toBeNull();
    expect(privacyProblem({ agentMessages: 'robots' })).toMatch(/can't be/);
    expect(privacyProblem({ aiTraining: 'yes' })).toMatch(/true or false/);
    expect(privacyProblem({ shoeSize: 9 })).toMatch(/Unknown/);
  });
});
