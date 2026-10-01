import { sharedUrl } from '../incoming';

describe('sharedUrl', () => {
  it('takes the shared URL, or the first link in shared text', () => {
    expect(sharedUrl({ webUrl: 'https://youtu.be/x' })).toBe('https://youtu.be/x');
    expect(sharedUrl({ text: 'watch this https://youtu.be/abc?t=3 so good' })).toBe('https://youtu.be/abc?t=3');
    expect(sharedUrl({ text: 'see (https://example.com/a).' })).toBe('https://example.com/a');
  });

  it('is null for anything without an http(s) link', () => {
    expect(sharedUrl({ text: 'just words' })).toBeNull();
    expect(sharedUrl({ webUrl: 'ftp://x', text: null })).toBeNull();
    expect(sharedUrl({})).toBeNull();
  });
});
