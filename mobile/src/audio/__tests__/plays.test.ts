import { duePlayEvents, soundScore, usesLabel } from '../plays';

describe('duePlayEvents', () => {
  const none = new Set<never>();
  it('starts on the first audible moment, never while muted', () => {
    expect(duePlayEvents(30_000, 0, none)).toEqual([]);
    expect(duePlayEvents(30_000, 100, none)).toEqual(['play_started']);
  });

  it('qualifies at 10 s, or half of a short clip', () => {
    expect(duePlayEvents(30_000, 10_000, new Set(['play_started']))).toEqual(['qualified_play']);
    expect(duePlayEvents(8_000, 4_000, new Set(['play_started']))).toEqual(['qualified_play']);
  });

  it('completes at 95%, and reports each kind once', () => {
    expect(duePlayEvents(8_000, 7_600, new Set(['play_started']))).toEqual(['qualified_play', 'play_completed']);
    expect(duePlayEvents(8_000, 8_000, new Set(['play_started', 'qualified_play', 'play_completed']))).toEqual([]);
  });
});

describe('soundScore', () => {
  it('weights uses 100, qualified plays 10, completions 20, as the server does', () => {
    expect(soundScore({ uses: 2, qualified: 3, completed: 1 })).toBe(250);
  });
});

describe('usesLabel', () => {
  it('reads naturally', () => {
    expect(usesLabel(1)).toBe('1 use');
    expect(usesLabel(1_250)).toBe('1.3K uses');
    expect(usesLabel(48_000)).toBe('48K uses');
  });
});
