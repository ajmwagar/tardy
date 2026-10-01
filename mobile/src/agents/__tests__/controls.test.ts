import {
  controlsProblem,
  controlsSummary,
  dailyLimitFromKey,
  dailyLimitKey,
  decideAgentAction,
  DEFAULT_AGENT_CONTROLS,
  inQuietHours,
  type AgentControls,
} from '../controls';

const NOON = new Date(2026, 9, 1, 12, 0);
const LATE = new Date(2026, 9, 1, 23, 30);
const auto: AgentControls = { ...DEFAULT_AGENT_CONTROLS, posts: 'auto', stories: 'auto', comments: 'auto', messages: 'auto', follows: 'auto', quietHours: false };

describe('decideAgentAction', () => {
  it('asks first by default for anything public-facing, and never messages people', () => {
    expect(decideAgentAction(DEFAULT_AGENT_CONTROLS, { kind: 'post', audience: 'followers', at: NOON })).toEqual({ outcome: 'ask', reason: 'mode' });
    expect(decideAgentAction(DEFAULT_AGENT_CONTROLS, { kind: 'comment', at: NOON })).toEqual({ outcome: 'ask', reason: 'mode' });
    expect(decideAgentAction(DEFAULT_AGENT_CONTROLS, { kind: 'message', at: NOON })).toEqual({ outcome: 'deny', reason: 'off' });
    expect(decideAgentAction(DEFAULT_AGENT_CONTROLS, { kind: 'reaction', at: NOON })).toEqual({ outcome: 'allow' });
  });

  it('pausing beats every other setting', () => {
    const paused = { ...auto, paused: true };
    for (const kind of ['post', 'story', 'comment', 'message', 'follow', 'reaction'] as const) {
      expect(decideAgentAction(paused, { kind, at: NOON })).toEqual({ outcome: 'deny', reason: 'paused' });
    }
  });

  it('lets automatic actions through', () => {
    expect(decideAgentAction(auto, { kind: 'post', audience: 'followers', autoPostsToday: 0, at: NOON })).toEqual({ outcome: 'allow' });
    expect(decideAgentAction(auto, { kind: 'follow', at: NOON })).toEqual({ outcome: 'allow' });
  });

  it('asks when an automatic post would reach wider than allowed', () => {
    expect(decideAgentAction(auto, { kind: 'post', audience: 'public', at: NOON })).toEqual({ outcome: 'ask', reason: 'audience' });
    expect(decideAgentAction({ ...auto, autoAudience: 'public' }, { kind: 'post', audience: 'public', at: NOON })).toEqual({ outcome: 'allow' });
  });

  it('asks once the daily cap is used, unless there is no cap', () => {
    expect(decideAgentAction(auto, { kind: 'story', autoPostsToday: 10, at: NOON })).toEqual({ outcome: 'ask', reason: 'daily_limit' });
    expect(decideAgentAction({ ...auto, dailyLimit: null }, { kind: 'story', autoPostsToday: 500, at: NOON })).toEqual({ outcome: 'allow' });
  });

  it('asks during quiet hours, but a "never" still wins', () => {
    const quiet = { ...auto, quietHours: true };
    expect(decideAgentAction(quiet, { kind: 'follow', at: LATE })).toEqual({ outcome: 'ask', reason: 'quiet_hours' });
    expect(decideAgentAction({ ...quiet, follows: 'off' }, { kind: 'follow', at: LATE })).toEqual({ outcome: 'deny', reason: 'off' });
    expect(decideAgentAction(quiet, { kind: 'follow', at: NOON })).toEqual({ outcome: 'allow' });
  });

  it('turns off tap-backs', () => {
    expect(decideAgentAction({ ...auto, reactions: 'off' }, { kind: 'reaction', at: NOON })).toEqual({ outcome: 'deny', reason: 'off' });
  });
});

describe('inQuietHours', () => {
  it('runs from 10 pm to 8 am', () => {
    expect(inQuietHours(new Date(2026, 0, 1, 21, 59))).toBe(false);
    expect(inQuietHours(new Date(2026, 0, 1, 22, 0))).toBe(true);
    expect(inQuietHours(new Date(2026, 0, 1, 7, 59))).toBe(true);
    expect(inQuietHours(new Date(2026, 0, 1, 8, 0))).toBe(false);
  });
});

describe('controlsSummary', () => {
  it('says how much the agent does without you', () => {
    expect(controlsSummary(DEFAULT_AGENT_CONTROLS)).toBe('Asks first');
    expect(controlsSummary(auto)).toBe('Fully automatic');
    expect(controlsSummary({ ...DEFAULT_AGENT_CONTROLS, posts: 'auto' })).toBe('Some automatic');
    expect(controlsSummary({ ...auto, paused: true })).toBe('Paused');
  });
});

describe('controlsProblem', () => {
  it('accepts valid patches', () => {
    expect(controlsProblem({ posts: 'auto', paused: true, dailyLimit: null, monthlySpendCents: 2500, autoAudience: 'public', reactions: 'off' })).toBeNull();
  });

  it('rejects unknown keys and wrong values', () => {
    expect(controlsProblem({ posts: 'sometimes' })).toMatch(/posts/);
    expect(controlsProblem({ reactions: 'ask' })).toMatch(/reactions/);
    expect(controlsProblem({ dailyLimit: 0 })).toMatch(/dailyLimit/);
    expect(controlsProblem({ monthlySpendCents: -1 })).toMatch(/monthlySpendCents/);
    expect(controlsProblem({ paused: 'yes' })).toMatch(/paused/);
    expect(controlsProblem({ admin: true })).toMatch(/Unknown/);
  });
});

describe('daily limit keys', () => {
  it('round-trip between presets and numbers', () => {
    expect(dailyLimitKey(null)).toBe('none');
    expect(dailyLimitFromKey(dailyLimitKey(10))).toBe(10);
    expect(dailyLimitFromKey('none')).toBeNull();
  });
});
