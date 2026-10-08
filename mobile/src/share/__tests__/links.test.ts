import { canonicalUrl, linkProvider, parseTardyUrl, tardyUrl } from '../links';

describe('canonicalUrl (mirrors the server)', () => {
  it('drops tracking, fragment and www, lowercases the host, sorts the query', () => {
    expect(canonicalUrl('https://WWW.YouTube.com/watch?v=abc&utm_source=x&si=1#t=3')).toBe('https://youtube.com/watch?v=abc');
    expect(canonicalUrl('https://example.com/a?b=2&a=1&fbclid=z')).toBe('https://example.com/a?a=1&b=2');
  });

  it('rejects anything but http(s)', () => {
    expect(() => canonicalUrl('ftp://example.com')).toThrow(/HTTP/);
    expect(() => canonicalUrl('not a url')).toThrow(/invalid/);
  });

  it('credits providers like the server table', () => {
    expect(linkProvider('https://youtu.be/x')).toBe('youtube');
    expect(linkProvider('https://github.com/a/b')).toBe('github');
    expect(linkProvider('https://news.ycombinator.com')).toBe('web');
  });
});

describe('tardy URLs', () => {
  it('round-trip a post id, and reject other URLs', () => {
    expect(parseTardyUrl(tardyUrl('post-1'))).toBe('post-1');
    expect(parseTardyUrl('https://tardy.news/t/abc?x=1')).toBe('abc');
    expect(parseTardyUrl('https://api.tardy.news/t/abc')).toBe('abc');
    expect(parseTardyUrl('https://example.com/t/abc')).toBeNull();
    expect(tardyUrl('post-1')).toBe('https://tardy.news/viewer.html?id=post-1');
    expect(parseTardyUrl('https://tardy.news/viewer.html?id=post-1')).toBe('post-1');
    expect(parseTardyUrl('https://example.com/viewer.html?id=post-1')).toBeNull();
    expect(parseTardyUrl('https://tardy.news/viewer.html?id=a&id=b')).toBeNull();
    expect(parseTardyUrl('https://tardy.news/viewer.html?demo=1')).toBeNull();
    expect(parseTardyUrl('https://tardy.news/t/%ZZ')).toBeNull();
    expect(parseTardyUrl('https://attacker@tardy.news/viewer.html?id=a')).toBeNull();
  });
});
