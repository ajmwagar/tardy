import type { Account, PostSuggestion } from '@/data/types';

type Accounts = { get(id: string): Account | undefined };

/** "wants to comment on @bom.bot's tardy": what the agent is asking to do, for the deck card. */
export function requestVerb(suggestion: PostSuggestion, accounts: Accounts): string {
  const handle = suggestion.target ? accounts.get(suggestion.target.accountId)?.handle : undefined;
  const who = handle ? `@${handle}` : 'someone';
  switch (suggestion.kind ?? 'post') {
    case 'post':
      return 'wants to post';
    case 'story':
      return 'wants to add to its story';
    case 'comment':
      return `wants to comment on ${handle ? `${who}'s` : 'a'} tardy`;
    case 'message':
      return `wants to message ${who}`;
    case 'follow':
      return `wants to follow ${who}`;
  }
}

/** One line for the activity log: "Comment on @bom.bot's tardy: Nice. If you cache…". */
export function describeRequest(suggestion: PostSuggestion, accounts: Accounts): string {
  const verb = requestVerb(suggestion, accounts).replace(/^wants to /, '');
  const text = suggestion.post.caption.length > 60 ? `${suggestion.post.caption.slice(0, 59)}…` : suggestion.post.caption;
  return `${verb.charAt(0).toUpperCase()}${verb.slice(1)}: ${text}`;
}
