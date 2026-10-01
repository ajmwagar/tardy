import {
  array,
  integer,
  isoToMs,
  knownOf,
  nullable,
  object,
  optional,
  snakeKeys,
  string,
  TardyWireError,
  timeMs,
  toSnake,
  wire,
} from '../codec';
import * as W from '../wire';

describe('case conversion', () => {
  it('snake-cases keys and drops undefined values', () => {
    expect(toSnake('viewerHasLiked')).toBe('viewer_has_liked');
    expect(snakeKeys({ codeVerifier: 'v', redirectUri: 'u', fullName: undefined })).toEqual({ code_verifier: 'v', redirect_uri: 'u' });
  });

  it('decodes snake_case keys into camelCase fields, honoring explicit wire names', () => {
    const decode = object<{ postCount: number; name: string }>({ postCount: integer, name: wire('display_name', string) });
    expect(decode({ post_count: 3, display_name: 'Ada', extra: true }, 'r')).toEqual({ postCount: 3, name: 'Ada' });
  });
});

describe('time conversion', () => {
  it('reads <key>_ms integers as ISO strings', () => {
    const decode = object<{ createdAt: string }>({ createdAt: timeMs });
    expect(decode({ created_at_ms: 0 }, 'r')).toEqual({ createdAt: '1970-01-01T00:00:00.000Z' });
  });

  it('writes ISO strings as ms and rejects unparseable times', () => {
    expect(isoToMs('2026-09-30T12:00:00.000Z')).toBe(Date.UTC(2026, 8, 30, 12));
    expect(() => isoToMs('yesterday')).toThrow('Invalid ISO time: yesterday');
  });

  it('rejects an ISO string where ms are expected', () => {
    const decode = object<{ createdAt: string }>({ createdAt: timeMs });
    expect(() => decode({ created_at_ms: '2026-09-30T12:00:00Z' }, 'r')).toThrow('r.created_at_ms: expected integer milliseconds since epoch');
  });
});

describe('strictness', () => {
  it('names the exact field that is missing', () => {
    const decode = array(object<{ likeCount: number }>({ likeCount: integer }));
    expect(() => decode([{ like_count: 1 }, {}], 'response.items')).toThrow(new TardyWireError('response.items[1].like_count: expected integer, got undefined'));
  });

  it('omits absent optional fields and requires nullable ones to be explicit', () => {
    const decode = object<{ model?: string; next: string | null }>({ model: optional(string), next: nullable(string) });
    expect(decode({ next: null }, 'r')).toEqual({ next: null });
    expect('model' in decode({ next: null }, 'r')).toBe(false);
    expect(() => decode({}, 'r')).toThrow('r.next: expected value or null');
  });

  it('decodes unknown open-set values to undefined', () => {
    expect(knownOf(['a', 'b'])('c', 'r')).toBeUndefined();
    expect(() => knownOf(['a'])(1, 'r')).toThrow('expected string');
  });
});

describe('wire types', () => {
  const wirePost = {
    id: 'p1',
    author_id: 'a1',
    format: 'reel',
    style: 'hologram',
    media: [{ type: 'video', url: 'https://v', poster_url: 'https://p', width: 1080, height: 1920, duration_ms: 12000 }],
    caption: 'shipped',
    status: 'in_progress',
    links: [{ kind: 'pull_request', label: '#2', url: 'https://gh' }],
    created_at_ms: 1_000,
    like_count: 1,
    comment_count: 2,
    share_count: 3,
    alarm_count: 4,
    viewer_has_liked: true,
    viewer_has_alarm: false,
    viewer_has_saved: false,
    ranking: { score: 0.5, in_network: true },
  };

  it('decodes a post, keeping durations as numbers and dropping an unknown style', () => {
    expect(W.post(wirePost, 'r')).toEqual({
      id: 'p1',
      authorId: 'a1',
      format: 'reel',
      media: [{ type: 'video', url: 'https://v', posterUrl: 'https://p', width: 1080, height: 1920, durationMs: 12000 }],
      caption: 'shipped',
      status: 'in_progress',
      links: [{ kind: 'pull_request', label: '#2', url: 'https://gh' }],
      createdAt: '1970-01-01T00:00:01.000Z',
      likeCount: 1,
      commentCount: 2,
      shareCount: 3,
      alarmCount: 4,
      viewerHasLiked: true,
      viewerHasAlarm: false,
      viewerHasSaved: false,
      ranking: { score: 0.5, inNetwork: true },
    });
  });

  it('rejects an unknown closed-set value', () => {
    expect(() => W.post({ ...wirePost, format: 'hologram' }, 'r')).toThrow('r.format: expected one of photo | carousel | video | reel, got "hologram"');
  });

  it('maps the Rust DirectMessage names (body, sent_at_ms) onto Message', () => {
    expect(
      W.message({ id: 'm1', thread_id: 't1', sequence: 4, sender_id: 'a1', recipient_id: 'a2', body: 'hi', sent_at_ms: 0, shared_post: { status: 'unavailable' } }, 'r'),
    ).toEqual({ id: 'm1', threadId: 't1', senderId: 'a1', text: 'hi', createdAt: '1970-01-01T00:00:00.000Z', sharedPost: { status: 'unavailable' } });
  });

  it('skips notifications and override rows of unknown kinds, and requires every known default', () => {
    const n = { id: 'n', actor_id: 'a', text: 't', created_at_ms: 0, read: false };
    expect(W.notifications([{ ...n, kind: 'like' }, { ...n, kind: 'poke' }], 'r').map((x) => x.kind)).toEqual(['like']);

    const defaults = { like: true, comment: true, follow: true, mention: true, shipped: true, blocked: true, review_requested: true, poke: false };
    const prefs = W.notificationPreferences(
      {
        defaults,
        overrides: [
          { project_id: 'p', category: 'shipped', enabled: false },
          { project_id: 'p', category: 'poke', enabled: true },
        ],
      },
      'r',
    );
    expect(prefs.overrides).toEqual([{ projectId: 'p', kind: 'shipped', enabled: false }]);
    expect(Object.keys(prefs.defaults)).not.toContain('poke');
    expect(Object.keys(prefs.defaults)).toContain('review_requested');

    const { review_requested: _, ...missing } = defaults;
    expect(() => W.notificationPreferences({ defaults: missing, overrides: [] }, 'r')).toThrow('r.defaults.review_requested');
  });
});
