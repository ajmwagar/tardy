import type { ThreadParticipant } from '@/data/types';

/**
 * How to build a thread on the server. Humans are created together in the initial DM/group;
 * agents join afterward through `POST .../agents`, which deliberately promotes the chat to a
 * work thread. With only agents, the first starts the work thread and the rest are summoned.
 */
export type ConversationPlan =
  { ok: true; recipientIds: string[]; addAgentIds: string[] } | { ok: false; reason: 'nobody' };

export function conversationPlan(participants: readonly ThreadParticipant[], viewerId: string | undefined): ConversationPlan {
  const seen = new Set<string>();
  const others = participants.filter((p) => p.id !== viewerId && !seen.has(p.id) && seen.add(p.id));
  const people = others.filter((p) => p.kind !== 'agent');
  const agents = others.filter((p) => p.kind === 'agent');
  if (others.length === 0) return { ok: false, reason: 'nobody' };
  if (people.length > 0) {
    return { ok: true, recipientIds: people.map((person) => person.id), addAgentIds: agents.map((agent) => agent.id) };
  }
  return { ok: true, recipientIds: [agents[0].id], addAgentIds: agents.slice(1).map((agent) => agent.id) };
}

/** True when `participantIds` is exactly the viewer plus `others` (order-free). */
export function sameMembers(participantIds: readonly string[], viewerId: string, others: readonly string[]): boolean {
  const want = new Set([viewerId, ...others]);
  const have = new Set(participantIds);
  return want.size === have.size && [...want].every((id) => have.has(id));
}
