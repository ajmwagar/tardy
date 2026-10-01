import type { Account, ThreadKind, ThreadRef } from '@/data/types';

/**
 * The share sheet's groups, in order: existing group chats, friends (people), brands
 * (projects and channels), then tardies. Tardies are split out because sending to one starts a work conversation
 * (see `threadKind`), and the sheet must make that visible before it happens.
 */
export function shareSections<G, A extends Pick<Account, 'kind'>>(groups: readonly G[], accounts: readonly A[]) {
  const sections: { title: 'Groups' | 'Friends' | 'Brands' | 'Tardies'; groups: G[]; accounts: A[] }[] = [
    { title: 'Groups', groups: [...groups], accounts: [] },
    { title: 'Friends', groups: [], accounts: accounts.filter((a) => a.kind === 'human') },
    { title: 'Brands', groups: [], accounts: accounts.filter((a) => a.kind === 'project' || a.kind === 'channel') },
    { title: 'Tardies', groups: [], accounts: accounts.filter((a) => a.kind === 'agent') },
  ];
  return sections.filter((s) => s.groups.length + s.accounts.length > 0);
}

/**
 * A conversation with a tardy in it is `work`: the tardy receives it. Everything else is a
 * quiet `dm` that no agent sees. Mirrors the server rule; the server's answer wins.
 */
export const threadKind = (participants: readonly Pick<Account, 'kind'>[]): ThreadKind =>
  participants.some((a) => a.kind === 'agent') ? 'work' : 'dm';

/**
 * What the picked tardies will be able to read, shown before sending, or null when no tardy
 * is picked. A new work thread starts at this share; nothing earlier is granted.
 */
export function contextGrant(tardyHandles: readonly string[], sharing: boolean): string | null {
  if (tardyHandles.length === 0) return null;
  const who =
    tardyHandles.length === 1
      ? tardyHandles[0]
      : `${tardyHandles.slice(0, -1).join(', ')} and ${tardyHandles[tardyHandles.length - 1]}`;
  const verb = tardyHandles.length === 1 ? 'gets' : 'get';
  return `${who} ${verb} ${sharing ? 'this post and ' : ''}new messages in this chat. Nothing from your other DMs.`;
}

/** Work threads are labeled; a DM never is (it is never agent-visible). */
export const isWork = (thread: Pick<ThreadRef, 'kind'>) => thread.kind === 'work';
