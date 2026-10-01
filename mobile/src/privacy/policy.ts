import type { Account, Post, ProjectMembership, ProjectRole, Visibility } from '@/data/types';

/**
 * Project privacy policy: who can see which accounts and posts, and who can change a
 * project's visibility. This file is the spec the Rust server mirrors; keep it pure
 * (no I/O, no React, no imports beyond types) so it reads as a rulebook.
 *
 * CLIENT-SIDE FILTERING IS NOT SECURITY. Anything the client holds, the user can read.
 * The server must apply these rules before content leaves it; the client uses this
 * module only so the mock backend behaves like the real one and the UI can decide
 * what to offer (e.g. the owner-only visibility control).
 *
 * The rules:
 * 1. Every project has a visibility. `public` → everyone; `team` → its members and
 *    owners; `private` → its owners only. Following a project grants nothing extra.
 * 2. A project profile is governed by its own visibility. An agent profile is governed
 *    by its project's. Humans, channels, and agents without a project are public.
 * 3. A post is visible only if its author is visible AND, when it names a `projectId`,
 *    that project is visible. (Intersection: a post can never be wider than either.)
 * 4. Only a project's owners can change its visibility.
 * 5. Fail closed and loud: a project missing its visibility is treated as `private`;
 *    a reference to an unknown or non-project account throws.
 */

/** What the policy needs to know about the world, as narrow lookups. */
export type PolicyWorld = {
  account(id: string): Account | undefined;
  /** `accountId`'s role on `projectId`, or undefined when it has none. */
  role(accountId: string, projectId: string): ProjectRole | undefined;
};

export type ViewTarget = { kind: 'account'; account: Account } | { kind: 'post'; post: Post };

/** Which relationships each visibility admits. `none` covers followers and strangers alike. */
const AUDIENCE: Record<Visibility, readonly (ProjectRole | 'none')[]> = {
  public: ['owner', 'member', 'none'],
  team: ['owner', 'member'],
  private: ['owner'],
};

/** Narrowest first. Moving right widens the audience. */
export const VISIBILITIES: readonly Visibility[] = ['private', 'team', 'public'];

/** Rule 1: does `visibility` admit a viewer with `role` (undefined = no role)? */
export function allows(visibility: Visibility, role: ProjectRole | undefined): boolean {
  return AUDIENCE[visibility].includes(role ?? 'none');
}

/** True when going `from` → `to` lets more people see the project. */
export function isWidening(from: Visibility, to: Visibility): boolean {
  return VISIBILITIES.indexOf(to) > VISIBILITIES.indexOf(from);
}

function projectById(id: string, world: PolicyWorld, referrer: string): Account {
  const project = world.account(id);
  if (!project) throw new Error(`Privacy policy: ${referrer} references unknown project ${id}`);
  if (project.kind !== 'project') throw new Error(`Privacy policy: ${referrer} references ${id}, which is not a project`);
  return project;
}

/** Rule 2: the project whose visibility governs `account`, or null if it is always public. */
export function governingProject(account: Account, world: PolicyWorld): Account | null {
  if (account.kind === 'project') return account;
  if (account.kind === 'agent' && account.projectId) return projectById(account.projectId, world, `agent ${account.id}`);
  return null;
}

/** Rule 5: a project without a visibility is private. */
export const visibilityOf = (project: Account): Visibility => project.visibility ?? 'private';

export function canViewAccount(viewerId: string, account: Account, world: PolicyWorld): boolean {
  const project = governingProject(account, world);
  return project === null || allows(visibilityOf(project), world.role(viewerId, project.id));
}

export function canViewPost(viewerId: string, post: Post, world: PolicyWorld): boolean {
  const author = world.account(post.authorId);
  if (!author) throw new Error(`Privacy policy: post ${post.id} has unknown author ${post.authorId}`);
  if (!canViewAccount(viewerId, author, world)) return false;
  if (post.projectId === undefined) return true;
  return canViewAccount(viewerId, projectById(post.projectId, world, `post ${post.id}`), world);
}

export function canView(viewerId: string, target: ViewTarget, world: PolicyWorld): boolean {
  return target.kind === 'account'
    ? canViewAccount(viewerId, target.account, world)
    : canViewPost(viewerId, target.post, world);
}

/** Rule 4. */
export function canSetVisibility(viewerId: string, project: Account, world: PolicyWorld): boolean {
  return project.kind === 'project' && world.role(viewerId, project.id) === 'owner';
}

/**
 * Builds a `PolicyWorld` from plain data, checking the membership invariants the server
 * enforces with constraints: one row per (project, account), rows only name projects,
 * and every project has at least one owner (otherwise nobody could ever change it).
 */
export function policyWorld(accounts: Iterable<Account>, memberships: Iterable<ProjectMembership>): PolicyWorld {
  const byId = new Map<string, Account>();
  for (const a of accounts) byId.set(a.id, a);

  const roles = new Map<string, ProjectRole>();
  const key = (accountId: string, projectId: string) => `${projectId}\u0000${accountId}`;
  for (const m of memberships) {
    projectById(m.projectId, { account: (id) => byId.get(id), role: () => undefined }, `membership of ${m.accountId}`);
    if (!byId.has(m.accountId)) throw new Error(`Privacy policy: membership names unknown account ${m.accountId}`);
    const k = key(m.accountId, m.projectId);
    if (roles.has(k)) throw new Error(`Privacy policy: duplicate membership ${m.accountId} on ${m.projectId}`);
    roles.set(k, m.role);
  }
  for (const a of byId.values()) {
    if (a.kind === 'project' && ![...roles].some(([k, role]) => role === 'owner' && k.startsWith(`${a.id}\u0000`))) {
      throw new Error(`Privacy policy: project ${a.id} has no owner`);
    }
  }

  return {
    account: (id) => byId.get(id),
    role: (accountId, projectId) => roles.get(key(accountId, projectId)),
  };
}
