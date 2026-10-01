import { TardyApiError } from '../api';
import { MockTardyApi } from '../mock/mock-api';
import { normalizeProfilePatch, PROFILE_LIMITS, profileProblem } from '../profile';

describe('profile rules', () => {
  it('trims fields and leaves omitted ones out', () => {
    expect(normalizeProfilePatch({ name: '  James  ' })).toEqual({ name: 'James' });
    expect(normalizeProfilePatch({})).toEqual({});
  });

  it('rejects an empty name and over-long fields', () => {
    expect(profileProblem({ name: '' })).toMatch(/empty/);
    expect(profileProblem({ name: 'x'.repeat(PROFILE_LIMITS.name + 1) })).toMatch(/max/);
    expect(profileProblem({ bio: 'x'.repeat(PROFILE_LIMITS.bio + 1) })).toMatch(/max/);
    expect(profileProblem({ name: 'James', bio: '' })).toBeNull();
  });
});

describe('MockTardyApi.updateProfile', () => {
  const api = () => new MockTardyApi({ latencyMs: 0 });

  it('updates only the fields given, trimmed', async () => {
    const client = api();
    const before = await client.me();
    const after = await client.updateProfile({ bio: '  Shipping agents.  ' });
    expect(after.bio).toBe('Shipping agents.');
    expect(after.name).toBe(before.name);
    expect((await client.me()).bio).toBe('Shipping agents.');
  });

  it('rejects invalid patches with `invalid` and changes nothing', async () => {
    const client = api();
    const before = await client.me();
    await expect(client.updateProfile({ name: '   ' })).rejects.toEqual(
      expect.objectContaining({ name: 'TardyApiError', code: 'invalid' }) as TardyApiError,
    );
    expect((await client.me()).name).toBe(before.name);
  });
});

describe('MockTardyApi.generateAvatar', () => {
  it('gives a fresh, never-blank picture each time and keeps it', async () => {
    const client = new MockTardyApi({ latencyMs: 0 });
    const before = (await client.me()).avatarUrl;
    const first = await client.generateAvatar();
    const second = await client.generateAvatar();
    expect(first.avatarUrl).toBeTruthy();
    expect(first.avatarUrl).not.toBe(before);
    expect(second.avatarUrl).not.toBe(first.avatarUrl);
    expect((await client.me()).avatarUrl).toBe(second.avatarUrl);
  });
});
