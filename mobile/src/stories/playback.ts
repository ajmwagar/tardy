import type { MediaItem, Story, StoryGroup } from '@/data/types';

/**
 * Story viewer navigation, as pure functions over the tray (`StoryGroup[]` in tray order).
 * A position is a group index and a story index within it.
 */
export type StoryPosition = { group: number; story: number };

/**
 * How long an image story shows before auto-advancing. Videos use their own duration.
 * Agent stories often carry dense status text, so give people enough time to actually
 * read one without immediately reaching for hold-to-pause.
 */
export const IMAGE_STORY_MS = 15_000;

/**
 * A beat after a story becomes visible before its timer starts, so it doesn't begin
 * draining the moment it appears.
 */
export const STORY_SETTLE_MS = 750;

/** Each story fades in over this long instead of snapping in. */
export const STORY_FADE_MS = 180;

/** How long a story plays. Throws on a video without a positive duration (a contract violation). */
export function storyDurationMs(media: MediaItem): number {
  if (media.type === 'image') return IMAGE_STORY_MS;
  if (!(media.durationMs > 0)) throw new Error(`Story video has no playable duration: ${media.durationMs}ms (${media.url})`);
  return media.durationMs;
}

/**
 * Where tapping into `authorId`'s bubble starts: their first story you haven't seen, or
 * their first story if you've seen them all. Null when they have no group (or it's empty).
 */
export function startPosition(groups: readonly StoryGroup[], authorId: string, isSeen: (story: Story) => boolean): StoryPosition | null {
  const group = groups.findIndex((g) => g.authorId === authorId);
  if (group === -1 || groups[group].stories.length === 0) return null;
  const firstUnseen = groups[group].stories.findIndex((s) => !isSeen(s));
  return { group, story: Math.max(0, firstUnseen) };
}

/** The next story: later in this group, else the next non-empty group's first. Null after the last (close). */
export function nextPosition(groups: readonly StoryGroup[], { group, story }: StoryPosition): StoryPosition | null {
  if (story + 1 < groups[group].stories.length) return { group, story: story + 1 };
  for (let g = group + 1; g < groups.length; g++) if (groups[g].stories.length > 0) return { group: g, story: 0 };
  return null;
}

/**
 * The previous story: earlier in this group, else the previous non-empty group's last.
 * At the very first story there is nothing before it, so it returns the same position
 * (the viewer restarts that story).
 */
export function previousPosition(groups: readonly StoryGroup[], { group, story }: StoryPosition): StoryPosition {
  if (story > 0) return { group, story: story - 1 };
  for (let g = group - 1; g >= 0; g--) {
    const count = groups[g].stories.length;
    if (count > 0) return { group: g, story: count - 1 };
  }
  return { group, story };
}

/** What a tap does by where it lands: the left third goes back, anywhere else goes forward (as on Instagram). */
export function tapAction(x: number, width: number): 'previous' | 'next' {
  return x < width / 3 ? 'previous' : 'next';
}
