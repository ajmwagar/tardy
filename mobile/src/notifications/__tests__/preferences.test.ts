import { MockTardyApi } from '@/data/mock/mock-api';
import { TardyApiError } from '@/data/api';
import type { Account, NotificationKind, NotificationPreferences } from '@/data/types';

import {
  decidePush,
  DEFAULT_PREFERENCES,
  eventProjectId,
  NOTIFICATION_KINDS,
  WORK_KINDS,
  withDefault,
  withOverride,
  type PushDecision,
} from '../preferences';

const LOB = 'p-lob';
const prefs = (defaults: Partial<Record<NotificationKind, boolean>> = {}, overrides: NotificationPreferences['overrides'] = []) => ({
  defaults: { ...DEFAULT_PREFERENCES.defaults, ...defaults },
  overrides,
});

describe('defaults', () => {
  it('cover every kind: work on, social off', () => {
    expect(Object.keys(DEFAULT_PREFERENCES.defaults).sort()).toEqual([...NOTIFICATION_KINDS].sort());
    for (const kind of NOTIFICATION_KINDS) {
      expect(DEFAULT_PREFERENCES.defaults[kind]).toBe(WORK_KINDS.includes(kind));
    }
  });

  it.each(NOTIFICATION_KINDS)('%s with no project or alarm follows the default', (kind) => {
    expect(decidePush(DEFAULT_PREFERENCES, { kind, alarmed: false }).push).toBe(WORK_KINDS.includes(kind));
  });
});

describe('decidePush: default × project override × alarm', () => {
  type Row = [boolean, boolean | undefined, boolean, PushDecision];
  // [default, override on LOB, alarmed, expected], for a work kind.
  const work: Row[] = [
    [true, undefined, false, { push: true, because: 'default' }],
    [true, undefined, true, { push: true, because: 'alarm' }],
    [true, true, false, { push: true, because: 'project_override' }],
    [true, true, true, { push: true, because: 'alarm' }],
    [true, false, false, { push: false, because: 'project_override' }],
    // The alarm on this post beats "not for this project".
    [true, false, true, { push: true, because: 'alarm' }],
    // A default of off is a global mute: an alarm cannot lift it...
    [false, undefined, false, { push: false, because: 'muted' }],
    [false, undefined, true, { push: false, because: 'muted' }],
    // ...but an explicit "on for this project" can.
    [false, true, false, { push: true, because: 'project_override' }],
    [false, true, true, { push: true, because: 'alarm' }],
    [false, false, false, { push: false, because: 'project_override' }],
    [false, false, true, { push: false, because: 'project_override' }],
  ];

  describe.each(WORK_KINDS)('%s', (kind) => {
    it.each(work)('default %p, override %p, alarm %p', (fallback, override, alarmed, expected) => {
      const p = prefs({ [kind]: fallback }, override === undefined ? [] : [{ projectId: LOB, kind, enabled: override }]);
      expect(decidePush(p, { kind, projectId: LOB, alarmed })).toEqual(expected);
    });
  });

  it('an alarm does not opt into social kinds', () => {
    const p = prefs({ comment: true }, [{ projectId: LOB, kind: 'comment', enabled: false }]);
    expect(decidePush(p, { kind: 'comment', projectId: LOB, alarmed: true })).toEqual({ push: false, because: 'project_override' });
  });

  it('a social kind can be turned on for one project only', () => {
    const p = prefs({}, [{ projectId: LOB, kind: 'comment', enabled: true }]);
    expect(decidePush(p, { kind: 'comment', projectId: LOB, alarmed: false }).push).toBe(true);
    expect(decidePush(p, { kind: 'comment', projectId: 'p-ohm', alarmed: false }).push).toBe(false);
  });

  it('overrides are per project and per kind: blocked on LOB, shipped off', () => {
    const p = withOverride(withOverride(DEFAULT_PREFERENCES, LOB, 'shipped', false), LOB, 'blocked', true);
    expect(decidePush(p, { kind: 'blocked', projectId: LOB, alarmed: false }).push).toBe(true);
    expect(decidePush(p, { kind: 'shipped', projectId: LOB, alarmed: false }).push).toBe(false);
    expect(decidePush(p, { kind: 'shipped', projectId: 'p-tardy', alarmed: false }).push).toBe(true);
    expect(decidePush(p, { kind: 'shipped', alarmed: false }).push).toBe(true);
  });

  it('fails loud on a kind with no default', () => {
    const p = { defaults: {}, overrides: [] } as unknown as NotificationPreferences;
    expect(() => decidePush(p, { kind: 'blocked', alarmed: false })).toThrow(/no default for kind blocked/);
  });
});

describe('edits', () => {
  it('withOverride keeps one row per (project, kind) and null removes it', () => {
    let p = withOverride(DEFAULT_PREFERENCES, LOB, 'shipped', false);
    p = withOverride(p, LOB, 'shipped', true);
    expect(p.overrides).toEqual([{ projectId: LOB, kind: 'shipped', enabled: true }]);
    expect(withOverride(p, LOB, 'shipped', null).overrides).toEqual([]);
    expect(DEFAULT_PREFERENCES.overrides).toEqual([]);
  });

  it('withDefault changes one kind', () => {
    expect(withDefault(DEFAULT_PREFERENCES, 'like', true).defaults).toEqual({ ...DEFAULT_PREFERENCES.defaults, like: true });
  });
});

describe('eventProjectId', () => {
  const account = (id: string, kind: Account['kind'], projectId?: string) => ({ id, kind, projectId }) as Account;
  it('prefers the post, then the agent, then the project itself', () => {
    expect(eventProjectId(account('a', 'agent', 'p-a'), { projectId: 'p-post' } as never)).toBe('p-post');
    expect(eventProjectId(account('a', 'agent', 'p-a'), undefined)).toBe('p-a');
    expect(eventProjectId(account('p', 'project'), undefined)).toBe('p');
    expect(eventProjectId(account('h', 'human'), undefined)).toBeUndefined();
  });
});

describe('mock delivery point', () => {
  const mock = () => new MockTardyApi({ latencyMs: 0 });

  it('starts every viewer on the defaults', async () => {
    await expect(mock().notificationPreferences()).resolves.toEqual(DEFAULT_PREFERENCES);
  });

  it('pushes blocked work by default and mutes social', async () => {
    const api = mock();
    await expect(api.simulatePush('n3')).resolves.toMatchObject({ decision: { push: true, because: 'default' }, data: { kind: 'blocked', post_id: 'post-3' } });
    await expect(api.simulatePush('n4')).resolves.toMatchObject({ decision: { push: false, because: 'muted' } });
  });

  it('applies a project override inferred from the agent post', async () => {
    const api = mock();
    // n7: BOM Bot blocked on Legion of BOM.
    await api.setNotificationOverride(LOB, 'blocked', false);
    await expect(api.simulatePush('n7')).resolves.toMatchObject({ decision: { push: false, because: 'project_override' } });
    // An alarm on that post brings it back.
    await api.setAlarm('post-9', true);
    await expect(api.simulatePush('n7')).resolves.toMatchObject({ decision: { push: true, because: 'alarm' } });
    // A global mute wins over the alarm.
    await api.setNotificationDefault('blocked', false);
    await expect(api.simulatePush('n7')).resolves.toMatchObject({ decision: { push: false, because: 'project_override' } });
  });

  it('refuses to push about a post the viewer cannot see', async () => {
    await expect(mock().simulatePush('n10')).rejects.toEqual(expect.objectContaining({ code: 'forbidden' }));
    await expect(mock().simulatePush('n10')).rejects.toBeInstanceOf(TardyApiError);
  });

  it('refuses overrides on projects the viewer cannot see', async () => {
    await expect(mock().setNotificationOverride('p-pan', 'shipped', true)).rejects.toEqual(expect.objectContaining({ code: 'forbidden' }));
  });

  it('keeps preferences and tokens per viewer', async () => {
    const api = mock();
    await api.setNotificationDefault('like', true);
    await api.registerPushToken({ token: 'ab'.repeat(32), environment: 'sandbox', topic: 'dev.fpl.tardy' });
    expect(api.registeredPushTokens()).toHaveLength(1);
    expect((await api.notificationPreferences()).defaults.like).toBe(true);
    await api.unregisterPushToken('ab'.repeat(32));
    expect(api.registeredPushTokens()).toEqual([]);
    await expect(new MockTardyApi({ latencyMs: 0, viewerId: 'avery' }).notificationPreferences()).resolves.toEqual(DEFAULT_PREFERENCES);
  });
});
