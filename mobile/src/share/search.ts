import type { Account } from '@/data/types';

/**
 * How well an account matches a search, lower is better, or null for no match. Handle
 * prefixes win (people type handles), then the start of any word in the name, then any
 * substring. Case-insensitive; a leading "@" is ignored.
 */
export function matchRank(account: Pick<Account, 'handle' | 'name'>, query: string): number | null {
  const q = normalizeQuery(query);
  if (!q) return 0;
  const handle = account.handle.toLowerCase();
  const name = account.name.toLowerCase();
  if (handle.startsWith(q)) return 0;
  if (name.split(/\s+/).some((word) => word.startsWith(q))) return 1;
  if (handle.includes(q) || name.includes(q)) return 2;
  return null;
}

export const normalizeQuery = (query: string) => query.trim().replace(/^@/, '').toLowerCase();

/**
 * Filters `accounts` to matches, best first. Ties keep their input order, so callers pass
 * accounts already in suggestion order (recent conversations, then follows).
 */
export function searchRanked<A extends Pick<Account, 'handle' | 'name'>>(accounts: readonly A[], query: string): A[] {
  return accounts
    .map((account, index) => ({ account, index, rank: matchRank(account, query) }))
    .filter((m): m is { account: A; index: number; rank: number } => m.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((m) => m.account);
}
