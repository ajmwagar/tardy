import { TEXT_POST_MAX_CHARS, textPostLength } from '@/data/types';

/** Remaining characters at or under this turn the counter amber, like X's ring. */
export const WARN_REMAINING = 20;

export type ComposerCount = {
  /** Characters as the server counts them (trimmed code points). */
  length: number;
  /** Negative once over the limit. */
  remaining: number;
  tone: 'quiet' | 'warn' | 'over';
  canPost: boolean;
};

/** The counter and Post button state for a draft, matching the server's validation. */
export function composerCount(text: string): ComposerCount {
  const length = textPostLength(text);
  const remaining = TEXT_POST_MAX_CHARS - length;
  return {
    length,
    remaining,
    tone: remaining < 0 ? 'over' : remaining <= WARN_REMAINING ? 'warn' : 'quiet',
    canPost: length > 0 && remaining >= 0,
  };
}
