import type { TardyApi } from '@/data/api';
import type { ThreadRef } from '@/data/types';

/** One group with everyone, or a 1:1 thread with each. One recipient is the same either way. */
export type ShareMode = 'group' | 'separately';

/** The participant sets to open, one per thread the share lands in. */
export function shareThreadSets(recipientIds: readonly string[], mode: ShareMode): string[][] {
  const unique = [...new Set(recipientIds)];
  if (unique.length === 0) return [];
  return mode === 'group' ? [unique] : unique.map((id) => [id]);
}

export type ShareResult = {
  /** Threads the share landed in, in recipient order. */
  sent: ThreadRef[];
  /** Recipient sets whose send failed, with why. The rest still went through. */
  failed: { participantIds: string[]; error: string }[];
};

/**
 * Sends `postId` (and an optional note) to the recipients. Threads are found or opened,
 * never duplicated (`openThread` is idempotent), and sends run in parallel. A failure for
 * one recipient does not stop the others: callers report `failed` and keep `sent`.
 * With no `postId` it only opens the thread(s), which is how "New message" starts a chat.
 */
export async function share(
  api: Pick<TardyApi, 'openThread' | 'sendMessage'>,
  {
    recipientIds,
    threads = [],
    mode,
    postId,
    note = '',
    title,
  }: {
    recipientIds: readonly string[];
    /** Existing threads (picked groups) to send into as they are. */
    threads?: readonly ThreadRef[];
    mode: ShareMode;
    postId?: string;
    note?: string;
    title?: string;
  },
): Promise<ShareResult> {
  const text = note.trim();
  const deliver = async (thread: ThreadRef) => {
    if (postId !== undefined || text) await api.sendMessage(thread.id, text, postId);
    return thread;
  };
  const sets = shareThreadSets(recipientIds, mode);
  const outcomes = await Promise.allSettled([
    ...threads.map(deliver),
    ...sets.map(async (ids) => deliver(await api.openThread(ids, ids.length > 1 ? title : undefined))),
  ]);
  const labels = [...threads.map((t) => t.participantIds), ...sets];
  const result: ShareResult = { sent: [], failed: [] };
  outcomes.forEach((o, i) => {
    if (o.status === 'fulfilled') result.sent.push(o.value);
    else
      result.failed.push({ participantIds: labels[i], error: o.reason instanceof Error ? o.reason.message : String(o.reason) });
  });
  return result;
}
