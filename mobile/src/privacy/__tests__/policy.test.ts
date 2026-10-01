import type { Account, Post, ProjectMembership, Visibility } from '@/data/types';

import {
  allows,
  canSetVisibility,
  canView,
  canViewPost,
  isWidening,
  policyWorld,
  type ViewTarget,
} from '../policy';

const account = (id: string, kind: Account['kind'], extra: Partial<Account> = {}): Account => ({
  id,
  kind,
  handle: id,
  name: id,
  avatarUrl: '',
  bio: '',
  verified: false,
  followers: 0,
  following: 0,
  postCount: 0,
  ...extra,
});

const post = (id: string, authorId: string, projectId?: string): Post => ({
  id,
  authorId,
  projectId,
  format: 'photo',
  media: [],
  caption: id,
  links: [],
  createdAt: '2026-09-30T12:00:00Z',
  likeCount: 0,
  alarmCount: 0,
  commentCount: 0,
  shareCount: 0,
  viewerHasLiked: false,
  viewerHasAlarm: false,
  viewerHasSaved: false,
});

const VISIBILITIES: Visibility[] = ['public', 'team', 'private'];
type Relationship = 'owner' | 'member' | 'follower' | 'stranger';

// One project per visibility, each with one agent. The follower follows everything,
// which must grant nothing: following is not a role.
const projects = VISIBILITIES.map((v) => account(`p-${v}`, 'project', { visibility: v }));
const agents = VISIBILITIES.map((v) => account(`a-${v}`, 'agent', { projectId: `p-${v}` }));
const viewers = (['owner', 'member', 'follower', 'stranger'] as const).map((r) => account(r, 'human'));
const memberships: ProjectMembership[] = VISIBILITIES.flatMap((v) => [
  { projectId: `p-${v}`, accountId: 'owner', role: 'owner' as const },
  { projectId: `p-${v}`, accountId: 'member', role: 'member' as const },
]);
const world = policyWorld([...projects, ...agents, ...viewers], memberships);

/** The spec, as a table: which relationships see each visibility. */
const EXPECTED: Record<Visibility, Record<Relationship, boolean>> = {
  public: { owner: true, member: true, follower: true, stranger: true },
  team: { owner: true, member: true, follower: false, stranger: false },
  private: { owner: true, member: false, follower: false, stranger: false },
};

const targets = (v: Visibility): [string, ViewTarget][] => [
  ['project', { kind: 'account', account: projects.find((p) => p.visibility === v)! }],
  ['agent', { kind: 'account', account: agents.find((a) => a.projectId === `p-${v}`)! }],
  ['post by the agent', { kind: 'post', post: post(`post-${v}`, `a-${v}`, `p-${v}`) }],
  ['post naming the project', { kind: 'post', post: post(`post-h-${v}`, 'owner', `p-${v}`) }],
];

const cases = VISIBILITIES.flatMap((v) =>
  targets(v).flatMap(([label, target]) =>
    (Object.keys(EXPECTED[v]) as Relationship[]).map((rel) => [v, rel, label, target, EXPECTED[v][rel]] as const),
  ),
);

describe('canView', () => {
  test.each(cases)('%s × %s × %s → %s', (_v, rel, _label, target, expected) => {
    expect(canView(rel, target, world)).toBe(expected);
  });

  test('humans, channels, and project-less agents are public', () => {
    for (const a of [account('h', 'human'), account('c', 'channel'), account('free', 'agent')]) {
      expect(canView('stranger', { kind: 'account', account: a }, world)).toBe(true);
    }
  });

  test('a post is never wider than its author or its project (intersection)', () => {
    // A public agent posting about a private project: hidden from non-owners.
    expect(canViewPost('stranger', post('x', 'a-public', 'p-private'), world)).toBe(false);
    expect(canViewPost('owner', post('x', 'a-public', 'p-private'), world)).toBe(true);
    // A private agent posting with no projectId still inherits its own project.
    expect(canViewPost('member', post('y', 'a-private'), world)).toBe(false);
  });

  test('fails closed: a project missing its visibility is private', () => {
    const bare = account('p-bare', 'project');
    const w = policyWorld([bare, ...viewers], [{ projectId: 'p-bare', accountId: 'owner', role: 'owner' }]);
    expect(canView('owner', { kind: 'account', account: bare }, w)).toBe(true);
    expect(canView('stranger', { kind: 'account', account: bare }, w)).toBe(false);
  });

  test('fails loud on dangling references', () => {
    expect(() => canView('owner', { kind: 'account', account: account('a-x', 'agent', { projectId: 'p-gone' }) }, world)).toThrow(
      /unknown project p-gone/,
    );
    expect(() => canViewPost('owner', post('z', 'ghost'), world)).toThrow(/unknown author/);
    expect(() => canViewPost('owner', post('z', 'owner', 'a-public'), world)).toThrow(/not a project/);
  });
});

describe('canSetVisibility', () => {
  test.each([
    ['owner', true],
    ['member', false],
    ['follower', false],
    ['stranger', false],
  ] as const)('%s → %s', (rel, expected) => {
    for (const p of projects) expect(canSetVisibility(rel, p, world)).toBe(expected);
  });

  test('only projects have visibility to set', () => {
    expect(canSetVisibility('owner', agents[0], world)).toBe(false);
  });
});

describe('policyWorld invariants', () => {
  const p = account('p', 'project', { visibility: 'team' });
  const h = account('h', 'human');

  test('every project needs an owner', () => {
    expect(() => policyWorld([p, h], [{ projectId: 'p', accountId: 'h', role: 'member' }])).toThrow(/no owner/);
  });

  test('one role per account per project', () => {
    const dup: ProjectMembership[] = [
      { projectId: 'p', accountId: 'h', role: 'owner' },
      { projectId: 'p', accountId: 'h', role: 'member' },
    ];
    expect(() => policyWorld([p, h], dup)).toThrow(/duplicate/);
  });

  test('memberships name real projects and accounts', () => {
    expect(() => policyWorld([p, h], [{ projectId: 'h', accountId: 'h', role: 'owner' }])).toThrow(/not a project/);
    expect(() => policyWorld([p], [{ projectId: 'p', accountId: 'nobody', role: 'owner' }])).toThrow(/unknown account/);
  });
});

test('allows and isWidening agree on the ordering private < team < public', () => {
  expect(allows('team', undefined)).toBe(false);
  expect(isWidening('private', 'public')).toBe(true);
  expect(isWidening('team', 'public')).toBe(true);
  expect(isWidening('public', 'team')).toBe(false);
  expect(isWidening('team', 'team')).toBe(false);
});
