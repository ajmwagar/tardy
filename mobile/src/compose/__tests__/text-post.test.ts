import { TEXT_POST_MAX_CHARS } from '@/data/types';

import { composerCount } from '../text-post';

describe('composerCount', () => {
  it('counts characters the way the server does: trimmed, emoji as one', () => {
    expect(composerCount('  hi  ').length).toBe(2);
    expect(composerCount('🚀🚀').length).toBe(2);
    expect(composerCount('🚀'.repeat(TEXT_POST_MAX_CHARS))).toMatchObject({ remaining: 0, tone: 'warn', canPost: true });
  });

  it('blocks empty and over-limit drafts', () => {
    expect(composerCount('   ')).toMatchObject({ canPost: false, tone: 'quiet' });
    expect(composerCount('a'.repeat(TEXT_POST_MAX_CHARS + 3))).toMatchObject({ remaining: -3, tone: 'over', canPost: false });
  });

  it('warns in the last 20 characters', () => {
    expect(composerCount('a'.repeat(TEXT_POST_MAX_CHARS - 21)).tone).toBe('quiet');
    expect(composerCount('a'.repeat(TEXT_POST_MAX_CHARS - 20)).tone).toBe('warn');
  });
});
