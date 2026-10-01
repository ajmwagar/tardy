import type { Account } from '@/data/types';

const HANDLE = /(^|[^\w.@])@([a-z0-9_.]{1,32})/gi;

/**
 * The `@word` being typed at the end of `text`, for autocomplete, or null. Only the tail
 * counts: suggestions follow the caret, which the composer keeps at the end.
 */
export function mentionQuery(text: string): string | null {
  const match = /(?:^|[^\w.@])@([a-z0-9_.]{0,32})$/i.exec(text);
  return match ? match[1].toLowerCase() : null;
}

/** Replaces the trailing `@partial` with the chosen handle and a space. */
export function completeMention(text: string, handle: string): string {
  return text.replace(/@([a-z0-9_.]{0,32})$/i, `@${handle} `);
}

/**
 * The accounts `text` mentions, resolved by the composer against accounts it already knows
 * (picked from suggestions, or loaded on screen). Unknown handles are not mentions: the
 * server never parses text, and the client never guesses. Deduplicated, in order.
 */
export function resolveMentions(text: string, byHandle: (handle: string) => Pick<Account, 'id'> | undefined): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(HANDLE)) {
    const id = byHandle(match[2].toLowerCase().replace(/\.$/, ''))?.id;
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
