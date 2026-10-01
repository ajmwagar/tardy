import { applyReaction, nextReaction, reactionOf, REACTIONS } from '../reactions';

describe('tap-backs', () => {
  it('has the agent states last: on it, done', () => {
    expect(REACTIONS.slice(-2).map((r) => [r.kind, r.emoji])).toEqual([
      ['seen', '👀'],
      ['done', '✅'],
    ]);
  });

  it('keeps one reaction per account, replacing and clearing', () => {
    let s = applyReaction(undefined, 'me', 'like');
    s = applyReaction(s, 'a1', 'seen');
    expect(s).toEqual([
      { kind: 'like', accountIds: ['me'] },
      { kind: 'seen', accountIds: ['a1'] },
    ]);
    s = applyReaction(s, 'a1', 'done');
    expect(reactionOf(s, 'a1')).toBe('done');
    expect(s.find((r) => r.kind === 'seen')).toBeUndefined();
    s = applyReaction(s, 'me', null);
    expect(s).toEqual([{ kind: 'done', accountIds: ['a1'] }]);
  });

  it('groups accounts that chose the same reaction', () => {
    const s = applyReaction(applyReaction(undefined, 'me', 'laugh'), 'avery', 'laugh');
    expect(s).toEqual([{ kind: 'laugh', accountIds: ['me', 'avery'] }]);
  });

  it('tapping your own reaction removes it; another replaces it', () => {
    expect(nextReaction('like', 'like')).toBeNull();
    expect(nextReaction('like', 'love')).toBe('love');
    expect(nextReaction(null, 'love')).toBe('love');
  });
});
