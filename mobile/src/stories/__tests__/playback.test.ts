import type { MediaItem, Story, StoryGroup } from '@/data/types';

import { IMAGE_STORY_MS, nextPosition, previousPosition, startPosition, STORY_SETTLE_MS, storyDeadlineMs, storyDurationMs, tapAction } from '../playback';

const image: MediaItem = { type: 'image', url: 'https://img/1', width: 1080, height: 1920 };
const video = (durationMs: number): MediaItem => ({
  type: 'video',
  url: 'https://vid/1.mp4',
  posterUrl: 'https://img/p',
  width: 1080,
  height: 1920,
  durationMs,
});

const story = (authorId: string, i: number, seen = false): Story => ({
  id: `${authorId}-${i}`,
  authorId,
  media: image,
  createdAt: '2026-09-30T10:00:00Z',
  seen,
});

/** Tray: a has 2 stories, empty has none, b has 1, c has 3. */
const TRAY: StoryGroup[] = [
  { authorId: 'a', stories: [story('a', 0), story('a', 1)] },
  { authorId: 'empty', stories: [] },
  { authorId: 'b', stories: [story('b', 0)] },
  { authorId: 'c', stories: [story('c', 0, true), story('c', 1), story('c', 2)] },
];

const seen = (s: Story) => s.seen;

describe('storyDurationMs', () => {
  it('gives image stories reading time and plays videos for their duration', () => {
    expect(storyDurationMs(image)).toBe(IMAGE_STORY_MS);
    expect(IMAGE_STORY_MS).toBe(15_000);
    expect(storyDurationMs(video(12_340))).toBe(12_340);
  });

  it('throws for a video with no playable duration', () => {
    expect(() => storyDurationMs(video(0))).toThrow(/no playable duration/);
    expect(() => storyDurationMs(video(Number.NaN))).toThrow(/no playable duration/);
  });
});

describe('storyDeadlineMs', () => {
  it('keeps a fresh image visible for the full dwell plus its settle beat', () => {
    expect(storyDeadlineMs(IMAGE_STORY_MS, true)).toBe(15_000 + STORY_SETTLE_MS);
    expect(storyDeadlineMs(8_000, false)).toBe(8_000);
  });
});

describe('startPosition', () => {
  it("starts at the author's first unseen story", () => {
    expect(startPosition(TRAY, 'c', seen)).toEqual({ group: 3, story: 1 });
    expect(startPosition(TRAY, 'a', seen)).toEqual({ group: 0, story: 0 });
  });

  it('starts from the top when everything is seen', () => {
    expect(startPosition(TRAY, 'c', () => true)).toEqual({ group: 3, story: 0 });
  });

  it('is null for an author with no group or an empty one', () => {
    expect(startPosition(TRAY, 'nobody', seen)).toBeNull();
    expect(startPosition(TRAY, 'empty', seen)).toBeNull();
  });
});

describe('nextPosition', () => {
  it('advances within a group', () => {
    expect(nextPosition(TRAY, { group: 0, story: 0 })).toEqual({ group: 0, story: 1 });
  });

  it("moves to the next author's first story after the last, skipping empty groups", () => {
    expect(nextPosition(TRAY, { group: 0, story: 1 })).toEqual({ group: 2, story: 0 });
    expect(nextPosition(TRAY, { group: 2, story: 0 })).toEqual({ group: 3, story: 0 });
  });

  it('is null after the last story of the last group (close)', () => {
    expect(nextPosition(TRAY, { group: 3, story: 2 })).toBeNull();
  });
});

describe('previousPosition', () => {
  it('goes back within a group', () => {
    expect(previousPosition(TRAY, { group: 3, story: 2 })).toEqual({ group: 3, story: 1 });
  });

  it("goes to the previous author's last story, skipping empty groups", () => {
    expect(previousPosition(TRAY, { group: 3, story: 0 })).toEqual({ group: 2, story: 0 });
    expect(previousPosition(TRAY, { group: 2, story: 0 })).toEqual({ group: 0, story: 1 });
  });

  it('stays put at the very first story', () => {
    expect(previousPosition(TRAY, { group: 0, story: 0 })).toEqual({ group: 0, story: 0 });
  });

  it('round-trips with nextPosition across the whole tray', () => {
    let pos = { group: 0, story: 0 };
    const visited = [pos];
    for (let n = nextPosition(TRAY, pos); n; n = nextPosition(TRAY, n)) visited.push(n);
    expect(visited.map((p) => TRAY[p.group].stories[p.story].id)).toEqual(['a-0', 'a-1', 'b-0', 'c-0', 'c-1', 'c-2']);
    for (let i = visited.length - 1; i > 0; i--) {
      pos = previousPosition(TRAY, visited[i]);
      expect(pos).toEqual(visited[i - 1]);
    }
  });
});

describe('tapAction', () => {
  it('splits the screen into thirds', () => {
    expect(tapAction(10, 390)).toBe('previous');
    expect(tapAction(129, 390)).toBe('previous');
    expect(tapAction(195, 390)).toBe('next'); // middle third goes forward, as on Instagram
    expect(tapAction(261, 390)).toBe('next');
    expect(tapAction(389, 390)).toBe('next');
  });
});
