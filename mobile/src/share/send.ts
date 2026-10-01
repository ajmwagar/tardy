import type { TardyApi } from '@/data/api';
import type { MessageAttachment, ThreadParticipant, ThreadRef } from '@/data/types';

/** One group with everyone, or a 1:1 thread with each. One recipient is the same either way. */
export type ShareMode = 'group' | 'separately';

/** The participant sets to open, one per thread the share lands in. */
export function shareThreadSets<P extends ThreadParticipant>(recipients: readonly P[], mode: ShareMode): P[][] {
  const unique = recipients.filter((p, i) => recipients.findIndex((q) => q.id === p.id) === i);
  if (unique.length === 0) return [];
  return mode === 'group' ? [unique] : unique.map((p) => [p]);
}

export type ShareResult = {
  /** Threads the share landed in, in recipient order. */
  sent: ThreadRef[];
  /** Recipient sets whose send failed, with why. The rest still went through. */
  failed: { participantIds: string[]; error: string }[];
};

/**
 * Sends `attachment` (a tardy or a shared link, and an optional note) to the recipients.
 * Threads are found or opened, never duplicated (`openThread` is idempotent), and sends run
 * in parallel. A failure for one recipient does not stop the others: callers report
 * `failed` and keep `sent`. With nothing to send it only opens the thread(s), which is how
 * "New message" starts a chat.
 */
export async function share(
  api: Pick<TardyApi, 'openThread' | 'sendMessage'>,
  {
    recipients,
    threads = [],
    mode,
    attachment,
    note = '',
    title,
  }: {
    recipients: readonly ThreadParticipant[];
    /** Existing threads (picked groups) to send into as they are. */
    threads?: readonly ThreadRef[];
    mode: ShareMode;
    attachment?: MessageAttachment;
    note?: string;
    title?: string;
  },
): Promise<ShareResult> {
  const text = note.trim();
  const deliver = async (thread: ThreadRef) => {
    if (attachment || text) await api.sendMessage(thread.id, text, attachment);
    return thread;
  };
  const sets = shareThreadSets(recipients, mode);
  const outcomes = await Promise.allSettled([
    ...threads.map(deliver),
    ...sets.map(async (set) => deliver(await api.openThread(set, set.length > 1 ? title : undefined))),
  ]);
  const labels = [...threads.map((t) => t.participantIds), ...sets.map((set) => set.map((p) => p.id))];
  const result: ShareResult = { sent: [], failed: [] };
  outcomes.forEach((o, i) => {
    if (o.status === 'fulfilled') result.sent.push(o.value);
    else
      result.failed.push({ participantIds: labels[i], error: o.reason instanceof Error ? o.reason.message : String(o.reason) });
  });
  return result;
}
