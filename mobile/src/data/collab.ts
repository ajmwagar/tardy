import type { Post } from './types';

/** Everyone credited on a tardy, author first. */
export const creditedIds = (post: Pick<Post, 'authorId' | 'collaboratorIds'>) => [post.authorId, ...(post.collaboratorIds ?? [])];

/** "a and b", or "a and 2 others" past two, Instagram's collab wording. */
export function collabLabel(handles: readonly string[]): string {
  if (handles.length <= 1) return handles[0] ?? '';
  if (handles.length === 2) return `${handles[0]} and ${handles[1]}`;
  return `${handles[0]} and ${handles.length - 1} others`;
}
