import { TardyApiError } from '../../api';
import { TardyWireError } from '../codec';
import { errorForResponse, HttpTardyApi, TardyHttpError, type FetchLike } from '../http-api';

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
type Reply = { status: number; body?: unknown };

/** A `fetch` that records each call and answers from a queue (default: 204). */
function fakeFetch(...replies: Reply[]) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const reply = replies.shift() ?? { status: 204 };
    const text = reply.body === undefined ? '' : typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
    return { status: reply.status, text: async () => text };
  };
  return { fetch, calls };
}

const BASE = 'https://api.example.test/';

const wireAccount = {
  id: 'acct-1',
  kind: 'human',
  handle: 'ada',
  display_name: 'Ada',
  avatar_url: 'https://a',
  bio: '',
  verified: false,
  followers: 1,
  following: 2,
  post_count: 3,
};

const wireSignedIn = (token = 'tok-1') => ({
  session: { token, account_id: 'acct-1', provider: 'github', expires_at_ms: 0 },
  account: wireAccount,
  onboarded_at_ms: null,
});

/** A client already signed in as acct-1 with tok-1, and the calls after sign-in. */
async function signedInClient(...replies: Reply[]) {
  const fake = fakeFetch({ status: 201, body: wireSignedIn() }, ...replies);
  const api = new HttpTardyApi({ baseUrl: BASE, fetch: fake.fetch });
  await api.signIn({ provider: 'email', email: 'a@b.c', code: '123456' });
  fake.calls.shift();
  return { api, calls: fake.calls };
}

describe('HttpTardyApi: routes', () => {
  // Rows: [name, call, method, path, request body (absent = no body)]. Wrapped in objects
  // below because jest passes `done` in place of a missing trailing row element.
  const rows: [string, (api: HttpTardyApi) => Promise<unknown>, string, string, unknown?][] = [
    ['homeFeed first page', (api) => api.homeFeed(null), 'GET', '/v1/feed'],
    ['homeFeed next page', (api) => api.homeFeed('snap:6/x'), 'GET', '/v1/feed?cursor=snap%3A6%2Fx'],
    ['accountByHandle', (api) => api.accountByHandle('ada'), 'GET', '/v1/profiles/ada'],
    ['account by id', (api) => api.account('a b'), 'GET', '/v1/profiles/by-id/a%20b'],
    ['accounts batch', (api) => api.accounts(['a', 'b']), 'GET', '/v1/profiles?ids=a%2Cb'],
    ['sendMessage', (api) => api.sendMessage('t1', 'hi'), 'POST', '/v1/social/conversations/t1/messages', { body: 'hi' }],
    ['typing', (api) => api.typing('t1'), 'GET', '/v1/social/conversations/t1/typing'],
    ['start typing', (api) => api.setTyping('t1', true), 'PUT', '/v1/social/conversations/t1/typing'],
    ['stop typing', (api) => api.setTyping('t1', false), 'DELETE', '/v1/social/conversations/t1/typing'],
    ['markThreadRead', (api) => api.markThreadRead('t1', 'm9'), 'POST', '/v1/social/conversations/t1/read', { through_message_id: 'm9' }],
    ['addAgent', (api) => api.addAgent('t1', 'a2'), 'POST', '/v1/social/conversations/t1/agents', { agent_profile_id: 'a2', include_anchor_share: true }],
    ['createSharedLink', (api) => api.createSharedLink('https://youtu.be/x'), 'POST', '/v1/social/shared-links', { url: 'https://youtu.be/x' }],
    ['addComment', (api) => api.addComment('p1', 'hey @a2', ['a2']), 'POST', '/v1/social/posts/p1/comments', { body: 'hey @a2', mentioned_profile_ids: ['a2'] }],
    ['claimAgent', (api) => api.claimAgent(' TARDY-7Q4K '), 'POST', '/v1/onboarding/tardy-claims', { code: 'TARDY-7Q4K' }],
    ['markNotificationsRead', (api) => api.markNotificationsRead('1970-01-01T00:00:01.000Z'), 'POST', '/v1/notifications/read', { through_at_ms: 1000 }],
    ['setSaved on', (api) => api.setSaved('p1', true), 'PUT', '/v1/saved-posts/p1'],
    ['setSaved off', (api) => api.setSaved('p1', false), 'DELETE', '/v1/saved-posts/p1'],
    ['setLiked off', (api) => api.setLiked('p1', false), 'DELETE', '/v1/posts/p1/like'],
    ['setFollowing on', (api) => api.setFollowing('acct-2', true), 'PUT', '/v1/profiles/acct-2/follow'],
    ['setNotificationDefault', (api) => api.setNotificationDefault('review_requested', false), 'PUT', '/v1/push/preferences', { category: 'review_requested', enabled: false }],
    ['setNotificationOverride clear', (api) => api.setNotificationOverride('proj', 'shipped', null), 'PUT', '/v1/push/preferences/projects/proj', { category: 'shipped', enabled: null }],
    ['registerPushToken', (api) => api.registerPushToken({ token: 'ab'.repeat(32), environment: 'sandbox', topic: 'dev.fpl.tardy' }), 'POST', '/v1/push/devices', { token: 'ab'.repeat(32), environment: 'sandbox', topic: 'dev.fpl.tardy' }],
    ['updateProfile', (api) => api.updateProfile({ name: 'Ada L' }), 'PATCH', '/v1/profile', { display_name: 'Ada L' }],
    ['profileAgents', (api) => api.profileAgents('person 1'), 'GET', '/v1/profiles/by-id/person%201/agents'],
    ['updateAgentProfile', (api) => api.updateAgentProfile('agent 1', { name: 'Builder', handle: 'builder' }), 'PATCH', '/v1/agents/agent%201/profile', { display_name: 'Builder', handle: 'builder' }],
    ['generateAgentAvatar', (api) => api.generateAgentAvatar('agent 1'), 'POST', '/v1/agents/agent%201/avatar/generate'],
    ['setVisibility', (api) => api.setVisibility('proj', 'team'), 'PUT', '/v1/profiles/by-id/proj/visibility', { visibility: 'team' }],
    [
      'logEngagement',
      (api) => api.logEngagement([{ type: 'vqv', postId: 'p1', watchedMs: 3000 }, { type: 'follow_author', authorId: 'a2' }]),
      'POST',
      '/v1/engagements',
      { actions: [{ type: 'vqv', post_id: 'p1', watched_ms: 3000 }, { type: 'follow_author', author_id: 'a2' }] },
    ],
  ];
  it.each(rows.map(([name, call, method, path, body]) => ({ name, call, method, path, body })))('$name → $method $path', async ({ call, method, path, body }) => {
    const { api, calls } = await signedInClient();
    // The response body is irrelevant here; decoding failures are tested separately.
    await call(api).catch((error) => {
      if (!(error instanceof TardyWireError)) throw error;
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe(method);
    expect(calls[0].url).toBe(`https://api.example.test${path}`);
    expect(calls[0].body).toEqual(body);
  });

  it('skips the network for empty batches', async () => {
    const { api, calls } = await signedInClient();
    await expect(api.accounts([])).resolves.toEqual([]);
    await api.logEngagement([]);
    expect(calls).toHaveLength(0);
  });

  it('rejects a base URL that is not http(s)', () => {
    expect(() => new HttpTardyApi({ baseUrl: 'api.example.test', fetch: fakeFetch().fetch })).toThrow('baseUrl must be an http(s) URL');
  });
});

describe('HttpTardyApi: auth', () => {
  it('signs in without credentials, snake-casing the provider credential', async () => {
    const { fetch, calls } = fakeFetch({ status: 201, body: wireSignedIn() });
    const api = new HttpTardyApi({ baseUrl: BASE, fetch });
    const signedIn = await api.signIn({ provider: 'github', code: 'c', codeVerifier: 'v', redirectUri: 'tardy://cb' });
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://api.example.test/v1/sessions' });
    expect(calls[0].body).toEqual({ provider: 'github', code: 'c', code_verifier: 'v', redirect_uri: 'tardy://cb' });
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(signedIn).toEqual({
      session: { token: 'tok-1', accountId: 'acct-1', provider: 'github', expiresAt: '1970-01-01T00:00:00.000Z' },
      account: { id: 'acct-1', kind: 'human', handle: 'ada', name: 'Ada', avatarUrl: 'https://a', bio: '', verified: false, followers: 1, following: 2, postCount: 3 },
      onboardedAt: null,
    });
  });

  it('sends the bearer token and selected profile on every call after sign-in', async () => {
    const { api, calls } = await signedInClient({ status: 200, body: [] });
    await api.followingIds();
    expect(calls[0].headers).toMatchObject({ Authorization: 'Bearer tok-1', 'x-tardy-profile-id': 'acct-1', Accept: 'application/json' });
    expect(calls[0].headers['Content-Type']).toBeUndefined();
  });

  it('resumes with the stored token (no profile header) and adopts a rotated one', async () => {
    const { fetch, calls } = fakeFetch({ status: 200, body: wireSignedIn('tok-rotated') }, { status: 200, body: [] });
    const api = new HttpTardyApi({ baseUrl: BASE, fetch });
    await api.resumeSession('tok-stored');
    expect(calls[0]).toMatchObject({ method: 'GET', url: 'https://api.example.test/v1/session' });
    expect(calls[0].headers.Authorization).toBe('Bearer tok-stored');
    expect(calls[0].headers['x-tardy-profile-id']).toBeUndefined();
    await api.followingIds();
    expect(calls[1].headers.Authorization).toBe('Bearer tok-rotated');
  });

  it('reports no session without calling the server when signed out', async () => {
    const { fetch, calls } = fakeFetch();
    await expect(new HttpTardyApi({ baseUrl: BASE, fetch }).session()).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('forgets the token on sign-out even when the revoke fails', async () => {
    const { api, calls } = await signedInClient({ status: 500, body: { error: 'db down' } }, { status: 200, body: [] });
    await expect(api.signOut()).rejects.toThrow(TardyHttpError);
    expect(calls[0]).toMatchObject({ method: 'DELETE', url: 'https://api.example.test/v1/session' });
    await expect(api.session()).resolves.toBeNull();
    await api.followingIds();
    expect(calls[1].headers.Authorization).toBeUndefined();
  });

  it('refuses to sign out when not signed in', async () => {
    await expect(new HttpTardyApi({ baseUrl: BASE, fetch: fakeFetch().fetch }).signOut()).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});

describe('HttpTardyApi: errors', () => {
  it.each([
    [401, { error: 'invalid bearer token' }, 'unauthenticated', 'invalid bearer token (GET /v1/profile)'],
    [403, { error: 'account does not own selected profile' }, 'forbidden', 'account does not own selected profile (GET /v1/profile)'],
    [404, { error: 'profile not found' }, 'not_found', 'profile not found (GET /v1/profile)'],
    [409, { code: 'conflict', message: '@ada is taken' }, 'conflict', '@ada is taken (GET /v1/profile)'],
    [400, { error: 'handle must be 3-32 lowercase letters' }, 'invalid', 'handle must be 3-32 lowercase letters (GET /v1/profile)'],
    [422, { code: 'invalid', message: 'Bio is 150 characters max.' }, 'invalid', 'Bio is 150 characters max. (GET /v1/profile)'],
  ])('maps HTTP %i to TardyApiError(%s)', async (status, body, code, message) => {
    const { api } = await signedInClient({ status, body });
    const error = await api.me().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TardyApiError);
    expect(error).toMatchObject({ code, message });
  });

  it('prefers a known code in the body over the status', () => {
    expect(errorForResponse('GET /x', 400, JSON.stringify({ code: 'conflict', message: 'm' }))).toMatchObject({ code: 'conflict' });
  });

  it('says a route is missing when the server 404s with no error body', async () => {
    const { api } = await signedInClient({ status: 404 });
    await expect(api.stories()).rejects.toEqual(
      new TardyApiError('not_found', 'GET /v1/stories is not implemented by this server (404 with no error body); see contracts/app-api-addendum.md'),
    );
  });

  it('surfaces statuses with no API code as TardyHttpError', async () => {
    const { api } = await signedInClient({ status: 503, body: { error: 'push notifications are not configured' } });
    const error = await api.notificationPreferences().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TardyHttpError);
    expect(error).toMatchObject({ status: 503, message: 'push notifications are not configured (GET /v1/push/preferences)' });
  });

  it('fails loudly when a 2xx body does not match the contract', async () => {
    // Today's server returns a bare FeedItem array; the app needs the Page envelope.
    const { api } = await signedInClient({ status: 200, body: [{ kind: 'reel', id: 'r1' }] });
    await expect(api.homeFeed(null)).rejects.toEqual(new TardyWireError('GET /v1/feed: response: expected object, got array'));
  });

  it('fails loudly on a 2xx body that is not JSON', async () => {
    const { api } = await signedInClient({ status: 200, body: '<html>' });
    await expect(api.me()).rejects.toThrow('GET /v1/profile: expected a JSON body, got "<html>" (HTTP 200)');
  });

  it('wraps network failures with the route', async () => {
    const api = new HttpTardyApi({
      baseUrl: BASE,
      fetch: async () => {
        throw new TypeError('Network request failed');
      },
    });
    await expect(api.trending()).rejects.toThrow('Network error on GET /v1/feed/hyper-tardy: Network request failed');
  });
});

describe('HttpTardyApi: decoding', () => {
  const wirePost = {
    id: 'p1',
    author_id: 'a1',
    format: 'photo',
    media: [{ type: 'image', url: 'https://i', width: 1, height: 1 }],
    caption: '',
    links: [],
    created_at_ms: 86_400_000,
    like_count: 0,
    comment_count: 0,
    share_count: 0,
    alarm_count: 0,
    repost_count: 0,
    viewer_has_reposted: false,
    viewer_has_liked: false,
    viewer_has_alarm: false,
    viewer_has_saved: false,
  };

  it('decodes a feed page with ms times as ISO and the cursor', async () => {
    const { api } = await signedInClient({ status: 200, body: { items: [wirePost], next_cursor: 'c2' } });
    const page = await api.homeFeed(null);
    expect(page.nextCursor).toBe('c2');
    expect(page.items[0]).toMatchObject({ id: 'p1', authorId: 'a1', createdAt: '1970-01-02T00:00:00.000Z', viewerHasSaved: false });
  });

  it('unwraps hyper-tardy items to their post', async () => {
    const item = { reel: { id: 'p1' }, post: wirePost, score: 12, unique_views: 3, window_started_at_ms: 0 };
    const { api } = await signedInClient({ status: 200, body: [item] });
    const posts = await api.trending();
    expect(posts.map((p) => p.id)).toEqual(['p1']);
  });

  it('decodes durable notification rows and their read state', async () => {
    const { api } = await signedInClient({
      status: 200,
      body: [{ id: 'n1', kind: 'mention', actor_id: 'a2', post_id: 'p1', text: 'mentioned you', created_at_ms: 1000, read: true }],
    });
    await expect(api.notifications()).resolves.toEqual([
      { id: 'n1', kind: 'mention', actorId: 'a2', postId: 'p1', text: 'mentioned you', createdAt: '1970-01-01T00:00:01.000Z', read: true },
    ]);
  });

  const wireMessage = (sequence: number, body: string, extra: object = {}) => ({
    id: `m${sequence}`,
    conversation_id: 't1',
    sequence,
    sender_profile_id: 'a2',
    body,
    shared_link_id: null,
    created_at: '1970-01-01T00:00:01Z',
    ...extra,
  });

  it('reads conversations, and reads the last message itself while the server omits it', async () => {
    const { api, calls } = await signedInClient(
      { status: 200, body: [{ id: 't1', mode: 'work', participants: ['acct-1', 'a2'] }, { id: 't2', mode: 'dm', participants: ['acct-1', 'h3'] }] },
      { status: 200, body: [wireMessage(1, 'first'), wireMessage(2, 'yo')] },
      { status: 200, body: [] },
    );
    await expect(api.threads()).resolves.toEqual([
      {
        id: 't1',
        kind: 'work',
        participantIds: ['acct-1', 'a2'],
        unreadCount: 0,
        lastMessage: { id: 'm2', threadId: 't1', senderId: 'a2', text: 'yo', createdAt: '1970-01-01T00:00:01.000Z', sequence: 2 },
      },
    ]);
    // t2 has no messages: omitted, as the contract says.
    expect(calls.map((c) => c.url.replace(BASE, '/'))).toEqual([
      '/v1/social/conversations',
      '/v1/social/conversations/t1/messages?after=0&limit=100',
      '/v1/social/conversations/t2/messages?after=0&limit=100',
    ]);
  });

  it('pages messages by sequence until a short page', async () => {
    const full = Array.from({ length: 100 }, (_, i) => wireMessage(i + 1, `n${i + 1}`));
    const { api, calls } = await signedInClient({ status: 200, body: full }, { status: 200, body: [wireMessage(101, 'last')] });
    const messages = await api.messages('t1');
    expect(messages).toHaveLength(101);
    expect(calls[1].url).toBe(`${BASE}v1/social/conversations/t1/messages?after=100&limit=100`);
  });

  it('shares a tardy as a link to its URL, and reads it back as a tardy card', async () => {
    const link = { id: 'l1', canonical_url: 'https://tardy.news/t/p9', provider: 'web', status: 'queued' };
    const sent = wireMessage(3, 'https://tardy.news/t/p9', { sender_profile_id: 'acct-1', shared_link_id: 'l1' });
    const { api, calls } = await signedInClient({ status: 201, body: link }, { status: 201, body: sent }, { status: 201, body: wireMessage(4, 'look') });
    const message = await api.sendMessage('t1', 'look', { sharedPostId: 'p9' });
    expect(message).toMatchObject({ text: '', sharedPost: { status: 'available', postId: 'p9' }, sharedLinkId: 'l1' });
    expect(calls.map((c) => [c.url.replace(BASE, '/'), c.body])).toEqual([
      ['/v1/social/shared-links', { url: 'https://tardy.news/t/p9' }],
      ['/v1/social/conversations/t1/messages', { body: 'https://tardy.news/t/p9', shared_link_id: 'l1' }],
      ['/v1/social/conversations/t1/messages', { body: 'look' }],
    ]);
  });

  it('openThread reuses an existing conversation with the same people', async () => {
    const { api, calls } = await signedInClient({ status: 200, body: [{ id: 't1', mode: 'dm', participants: ['h2', 'acct-1'] }] });
    await expect(api.openThread([{ id: 'h2', kind: 'human' }])).resolves.toEqual({ id: 't1', kind: 'dm', participantIds: ['h2', 'acct-1'] });
    expect(calls).toHaveLength(1);
  });

  it('openThread starts with the person, then adds agents', async () => {
    const { api, calls } = await signedInClient(
      { status: 201, body: { id: 't9', mode: 'dm', participants: ['acct-1', 'h2'] } },
      { status: 200, body: { id: 't9', mode: 'work', participants: ['acct-1', 'h2', 'a3'] } },
    );
    const thread = await api.openThread([{ id: 'a3', kind: 'agent' }, { id: 'h2', kind: 'human' }]);
    expect(thread).toEqual({ id: 't9', kind: 'work', participantIds: ['acct-1', 'h2', 'a3'] });
    expect(calls.map((c) => [c.method, c.url.replace(BASE, '/'), c.body])).toEqual([
      ['POST', '/v1/social/conversations', { participant_profile_ids: ['h2'] }],
      ['POST', '/v1/social/conversations/t9/agents', { agent_profile_id: 'a3', include_anchor_share: true }],
    ]);
  });

  it('openThread creates all people in one group request', async () => {
    const { api, calls } = await signedInClient(
      { status: 201, body: { id: 'tg', mode: 'dm', participants: ['acct-1', 'h2', 'h3'] } },
    );
    await expect(api.openThread([{ id: 'h2', kind: 'human' }, { id: 'h3', kind: 'human' }])).resolves.toMatchObject({ id: 'tg' });
    expect(calls[0].body).toEqual({ participant_profile_ids: ['h2', 'h3'] });
  });

  it('renames groups and adds or removes participants in place', async () => {
    const thread = { id: 'tg', mode: 'dm', title: 'Ship Room', participants: ['acct-1', 'h2', 'h3'] };
    const { api, calls } = await signedInClient(
      { status: 200, body: thread },
      { status: 200, body: thread },
      { status: 200, body: { ...thread, participants: ['acct-1', 'h2'] } },
    );
    await api.renameThread('tg', 'Ship Room');
    await api.addThreadParticipant('tg', 'h3');
    await api.removeThreadParticipant('tg', 'h3');
    expect(calls.map((call) => [call.method, call.url.replace(BASE, '/'), call.body])).toEqual([
      ['PUT', '/v1/social/conversations/tg', { title: 'Ship Room' }],
      ['POST', '/v1/social/conversations/tg/participants', { profile_id: 'h3' }],
      ['DELETE', '/v1/social/conversations/tg/participants/h3', undefined],
    ]);
  });
});

describe('HttpTardyApi: agent controls', () => {
  const wireControls = {
    paused: false,
    posts: 'auto',
    stories: 'ask',
    comments: 'ask',
    messages: 'off',
    follows: 'ask',
    reactions: 'auto',
    auto_audience: 'followers',
    daily_limit: null,
    quiet_hours: true,
    monthly_spend_cents: 500,
    use_your_activity: false,
    notify_on_auto: true,
  };

  it('reads and patches controls in snake_case', async () => {
    const { api, calls } = await signedInClient({ status: 200, body: wireControls }, { status: 200, body: { ...wireControls, paused: true } });
    const controls = await api.agentControls('agent/1');
    expect(controls).toMatchObject({ posts: 'auto', dailyLimit: null, monthlySpendCents: 500, autoAudience: 'followers' });
    const next = await api.updateAgentControls('agent/1', { paused: true, dailyLimit: null });
    expect(next.paused).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${BASE}v1/agents/agent%2F1/controls`, `PATCH ${BASE}v1/agents/agent%2F1/controls`]);
    expect(calls[1].body).toEqual({ paused: true, daily_limit: null });
  });

  it('decodes the activity log and skips kinds it does not know', async () => {
    const { api } = await signedInClient({
      status: 200,
      body: [
        { id: '1', agent_profile_id: 'a', kind: 'post', summary: 'Posted: hi', how: 'auto', at: '2026-10-01T00:00:00Z', post_id: 'p1' },
        { id: '2', agent_profile_id: 'a', kind: 'livestream', summary: 'Went live', how: 'auto', at: '2026-10-01T00:00:00Z' },
      ],
    });
    expect(await api.agentActivity('a')).toEqual([{ id: '1', agentId: 'a', kind: 'post', summary: 'Posted: hi', how: 'auto', at: '2026-10-01T00:00:00.000Z', postId: 'p1' }]);
  });

  it('decodes what kind of request a suggestion is, and its target', async () => {
    const { api } = await signedInClient({
      status: 200,
      body: [
        {
          id: 's1',
          agent_profile_id: 'a',
          kind: 'comment',
          target: { account_profile_id: 'b', post_id: 'p' },
          post: { caption: 'Nice', media: [], format: 'photo', links: [] },
          visibility: 'public',
          created_at: '2026-10-01T00:00:00Z',
        },
      ],
    });
    const [s] = await api.postSuggestions();
    expect(s).toMatchObject({ kind: 'comment', target: { accountId: 'b', postId: 'p' } });
  });
});
