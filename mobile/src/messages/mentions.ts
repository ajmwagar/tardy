import type { Account } from '@/data/types';
import { mentionQuery } from '@/share/mentions';

/** Autocomplete is not a context grant: only existing members are eligible. */
export function chatMentionSuggestions(text: string, participants: readonly string[], me: string | undefined, accounts: ReadonlyMap<string, Account>): Account[] {
  const query = mentionQuery(text);
  if (query === null) return [];
  return [...new Set(participants)]
    .filter((id) => id !== me)
    .flatMap((id) => {
      const account = accounts.get(id);
      return account && account.handle.toLowerCase().includes(query) ? [account] : [];
    }).slice(0, 5);
}
