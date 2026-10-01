/**
 * Tap-backs: one reaction per account per message or comment, iMessage-style. Tapping the
 * one you already left removes it; tapping another replaces it.
 *
 * The last two exist for agents: `seen` (👀, "on it") the moment an agent picks up a request,
 * `done` (✅) when it finishes, so its status shows on your own message instead of as
 * "On it." filler messages. A reaction is never an approval: agents must not treat a 👍
 * as permission for anything risky.
 *
 * Kinds are a closed set on the wire (snake_case names, not emoji); clients ignore kinds
 * they don't know, so the set can grow.
 */

export type ReactionKind = 'like' | 'love' | 'laugh' | 'emphasize' | 'question' | 'seen' | 'done';

export const REACTIONS: readonly { kind: ReactionKind; emoji: string; label: string }[] = [
  { kind: 'like', emoji: '👍', label: 'Like' },
  { kind: 'love', emoji: '❤️', label: 'Love' },
  { kind: 'laugh', emoji: '😂', label: 'Haha' },
  { kind: 'emphasize', emoji: '‼️', label: 'Emphasize' },
  { kind: 'question', emoji: '❓', label: 'Question' },
  { kind: 'seen', emoji: '👀', label: 'On it' },
  { kind: 'done', emoji: '✅', label: 'Done' },
];

export const REACTION_KINDS: readonly ReactionKind[] = REACTIONS.map((r) => r.kind);

export const emojiFor = (kind: ReactionKind) => REACTIONS.find((r) => r.kind === kind)!.emoji;

/** Who left which reaction, in `REACTIONS` order; kinds nobody left are omitted. */
export type ReactionSummary = { kind: ReactionKind; accountIds: string[] }[];

/** The viewer's current reaction, if any. */
export const reactionOf = (summary: ReactionSummary | undefined, accountId: string): ReactionKind | null =>
  summary?.find((r) => r.accountIds.includes(accountId))?.kind ?? null;

/**
 * Sets `accountId`'s reaction to `kind` (null clears it), keeping one per account. Pure, for
 * optimistic updates on the client and the mock server alike.
 */
export function applyReaction(
  summary: ReactionSummary | undefined,
  accountId: string,
  kind: ReactionKind | null,
): ReactionSummary {
  const without = (summary ?? []).map((r) => ({ kind: r.kind, accountIds: r.accountIds.filter((id) => id !== accountId) }));
  const next = kind ? without.map((r) => (r.kind === kind ? { ...r, accountIds: [...r.accountIds, accountId] } : r)) : without;
  if (kind && !next.some((r) => r.kind === kind)) next.push({ kind, accountIds: [accountId] });
  return next
    .filter((r) => r.accountIds.length > 0)
    .sort((a, b) => REACTION_KINDS.indexOf(a.kind) - REACTION_KINDS.indexOf(b.kind));
}

/** What tapping `kind` does for someone whose current reaction is `current`: toggle or replace. */
export const nextReaction = (current: ReactionKind | null, kind: ReactionKind): ReactionKind | null =>
  current === kind ? null : kind;
