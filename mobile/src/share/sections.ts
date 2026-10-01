import type { Account, Thread, ThreadKind, ThreadRef } from '@/data/types';

/** Anything the share sheet can offer: an account, or an existing group chat. */
export type ShareCandidate = {
  kind: Account['kind'] | 'group';
  ownedByViewer?: boolean;
  /** When the viewer last messaged them (ms), for recency order. */
  lastUsedMs?: number;
};

/**
 * The share sheet's layout: your own agents first (Tardy is where you talk to them), then
 * everyone and everything else in one grid: friends, group chats, brands, other agents, mixed.
 * With no query both are ordered most recently used first, so the people you message most
 * are a tap away; never-messaged candidates keep their incoming order after them. While
 * searching, the incoming order (relevance) is kept instead.
 */
export function shareSections<T extends ShareCandidate>(candidates: readonly T[], { byRecency }: { byRecency: boolean }) {
  const order = (list: T[]) =>
    byRecency
      ? list
          .map((item, index) => ({ item, index }))
          .sort((a, b) => (b.item.lastUsedMs ?? -1) - (a.item.lastUsedMs ?? -1) || a.index - b.index)
          .map(({ item }) => item)
      : list;
  const mine = (c: T) => c.kind === 'agent' && !!c.ownedByViewer;
  const sections: { title: 'Your agents' | 'Recent'; items: T[] }[] = [
    { title: 'Your agents', items: order(candidates.filter(mine)) },
    { title: 'Recent', items: order(candidates.filter((c) => !mine(c))) },
  ];
  return sections.filter((s) => s.items.length > 0);
}

/**
 * When the viewer last messaged each account and group: a 1:1 thread dates the other person,
 * a group dates itself (keyed `g:<thread id>`). Feeds `ShareCandidate.lastUsedMs`.
 */
export function lastUsed(
  threads: readonly Pick<Thread, 'id' | 'participantIds' | 'lastMessage'>[],
  viewerId: string | undefined,
) {
  const at = new Map<string, number>();
  for (const t of threads) {
    const ms = Date.parse(t.lastMessage.createdAt);
    const others = t.participantIds.filter((id) => id !== viewerId);
    const key = others.length === 1 ? others[0] : `g:${t.id}`;
    at.set(key, Math.max(ms, at.get(key) ?? -Infinity));
  }
  return at;
}

/**
 * A conversation with an agent in it is `work`: the agent receives it. Everything else is a
 * quiet `dm` that no agent sees. Mirrors the server rule; the server's answer wins.
 */
export const threadKind = (participants: readonly Pick<Account, 'kind'>[]): ThreadKind =>
  participants.some((a) => a.kind === 'agent') ? 'work' : 'dm';

/**
 * What the picked agents will be able to read, shown before sending, or null when no agent
 * is picked. A new work thread starts at this share; nothing earlier is granted.
 */
export function contextGrant(agentHandles: readonly string[], sharing: 'post' | 'link' | null): string | null {
  if (agentHandles.length === 0) return null;
  const who =
    agentHandles.length === 1
      ? agentHandles[0]
      : `${agentHandles.slice(0, -1).join(', ')} and ${agentHandles[agentHandles.length - 1]}`;
  const verb = agentHandles.length === 1 ? 'gets' : 'get';
  const what = sharing === 'post' ? 'this tardy and ' : sharing === 'link' ? 'this link and ' : '';
  return `${who} ${verb} ${what}new messages in this chat. Nothing from your other DMs.`;
}

/** Work threads are labeled; a DM never is (it is never agent-visible). */
export const isWork = (thread: Pick<ThreadRef, 'kind'>) => thread.kind === 'work';

/**
 * The confirmation shown before adding an agent to a chat. It names the agent and exactly what
 * it gets (`docs/share-flow-frontend.md`): context starts now, never the earlier history. A DM
 * becoming a work chat is called out because it cannot be undone.
 */
export function promotionNotice(agentHandle: string, alreadyWork: boolean): { title: string; message: string } {
  return {
    title: `Add ${agentHandle} to this chat?`,
    message: [
      alreadyWork ? null : 'This becomes a work chat, which can’t be undone.',
      `${agentHandle} gets the chat’s first shared item and messages from now on. Nothing said before now.`,
    ]
      .filter(Boolean)
      .join(' '),
  };
}
