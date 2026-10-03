import { acceptMentionSuggestion, completeMention, mentionQuery, resolveMentions } from '../mentions';

const known: Record<string, { id: string }> = { 'opus.backend': { id: 'a1' }, avery: { id: 'h1' } };
const byHandle = (h: string) => known[h];

describe('mentions', () => {
  it('finds the @word being typed at the end only', () => {
    expect(mentionQuery('hey @op')).toBe('op');
    expect(mentionQuery('hey @')).toBe('');
    expect(mentionQuery('hey @op more')).toBeNull();
    expect(mentionQuery('mail a@b')).toBeNull();
  });

  it('completes the partial handle', () => {
    expect(completeMention('ping @op', 'opus.backend')).toBe('ping @opus.backend ');
  });

  it('accepts the first active autocomplete result on submit', () => {
    expect(acceptMentionSuggestion('ping @op', ['opus.backend', 'openclaw'])).toBe('ping @opus.backend ');
    expect(acceptMentionSuggestion('ping @op', [])).toBeNull();
    expect(acceptMentionSuggestion('ping @opus.backend later', ['opus.backend'])).toBeNull();
  });

  it('resolves only known handles, once each, ignoring emails and trailing dots', () => {
    expect(resolveMentions('@avery and @opus.backend. cc @avery, @ghost, a@avery.com', byHandle)).toEqual(['h1', 'a1']);
  });
});
