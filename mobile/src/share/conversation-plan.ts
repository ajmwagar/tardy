import type { ThreadParticipant } from '@/data/types';

/**
 * How to build a thread on the server (`POST /v1/social/conversations` takes one recipient;
 * agents join after through `POST .../agents`). A person is the recipient when there is one,
 * so the thread starts as their DM and is then promoted; with only agents, the first agent is
 * the recipient and the thread is `work` from the start.
 *
 * More than one other person is a human group, which the server cannot build yet: that is
 * `unsupported`, and the caller must say so rather than silently drop someone.
 */
export type ConversationPlan =
  { ok: true; recipientId: string; addAgentIds: string[] } | { ok: false; reason: 'nobody' | 'unsupported' };

export function conversationPlan(participants: readonly ThreadParticipant[], viewerId: string | undefined): ConversationPlan {
  const seen = new Set<string>();
  const others = participants.filter((p) => p.id !== viewerId && !seen.has(p.id) && seen.add(p.id));
  const people = others.filter((p) => p.kind !== 'agent');
  const agents = others.filter((p) => p.kind === 'agent');
  if (others.length === 0) return { ok: false, reason: 'nobody' };
  if (people.length > 1) return { ok: false, reason: 'unsupported' };
  const recipient = people[0] ?? agents[0];
  return { ok: true, recipientId: recipient.id, addAgentIds: agents.filter((a) => a.id !== recipient.id).map((a) => a.id) };
}

/** True when `participantIds` is exactly the viewer plus `others` (order-free). */
export function sameMembers(participantIds: readonly string[], viewerId: string, others: readonly string[]): boolean {
  const want = new Set([viewerId, ...others]);
  const have = new Set(participantIds);
  return want.size === have.size && [...want].every((id) => have.has(id));
}
