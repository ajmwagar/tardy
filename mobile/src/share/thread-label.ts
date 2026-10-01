import type { ThreadRef } from '@/data/types';

/** Everyone in the thread but the viewer, in thread order. */
export const othersIn = (thread: Pick<ThreadRef, 'participantIds'>, me: string | undefined) =>
  thread.participantIds.filter((id) => id !== me);

export const isGroup = (thread: Pick<ThreadRef, 'participantIds'>) => thread.participantIds.length > 2;

/**
 * What a thread is called: its title, else the other person's handle, else the first two
 * members' handles and how many more ("avery, opus-be +2"). Unknown handles are skipped.
 */
export function threadLabel(thread: ThreadRef, me: string | undefined, handleOf: (id: string) => string | undefined): string {
  if (thread.title) return thread.title;
  const handles = othersIn(thread, me)
    .map(handleOf)
    .filter((h): h is string => !!h);
  if (handles.length <= 2) return handles.join(', ');
  return `${handles.slice(0, 2).join(', ')} +${handles.length - 2}`;
}
