import { TardyApiError, type TardyApi, type TardyApiErrorCode } from '../api';
import type { ProfilePatch } from '../profile';
import type {
  Account,
  AuthCredential,
  Comment,
  EngagementAction,
  Message,
  Notification,
  NotificationKind,
  NotificationPreferences,
  Page,
  Post,
  PushTokenRegistration,
  SignedIn,
  StoryGroup,
  Thread,
  Visibility,
} from '../types';
import { array, isoToMs, snakeKeys, TardyWireError, type Decoder } from './codec';
import * as W from './wire';

/**
 * `TardyApi` over HTTP against the Rust server (ajmwagar/tardy, `feat/backend-foundation`).
 * Every method calls exactly one route: the server's own where it has one, otherwise the
 * route proposed in `contracts/app-api-addendum.md`. Nothing is stubbed: a route the
 * server lacks answers 404, which surfaces as `TardyApiError('not_found')` naming it.
 *
 * Boundary rules:
 * - Requests: snake_case JSON; ISO times go out as integer `*_ms`.
 * - Responses: decoded strictly by `wire.ts` (`TardyWireError` on a contract mismatch).
 * - Auth: `Authorization: Bearer <session token>`, plus `x-tardy-profile-id: <account id>`
 *   because the server acts as a selected profile (`authenticated_actor` in `src/api.rs`).
 *   The token is whatever the latest `SignedIn` carried (sign-in, resume, onboarding).
 * - Errors: 401 → `unauthenticated`, 403 → `forbidden`, 404 → `not_found`, 409 →
 *   `conflict`, 400/422 → `invalid`; a known `code` in the body wins. Anything else
 *   (5xx, 402, 503) is a `TardyHttpError`, and network failures are rethrown with the route.
 */

/** The subset of `fetch` the client uses; injectable for tests. */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; text(): Promise<string> }>;

export type HttpTardyApiOptions = {
  /** e.g. `https://api.tardy.dev`; a trailing slash is ignored. */
  baseUrl: string;
  fetch?: FetchLike;
};

/** A non-2xx status with no `TardyApiError` equivalent (server fault, unconfigured feature). */
export class TardyHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'TardyHttpError';
  }
}

const STATUS_CODES: Record<number, TardyApiErrorCode> = {
  400: 'invalid',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'invalid',
};

const API_ERROR_CODES: readonly string[] = ['forbidden', 'not_found', 'unauthenticated', 'invalid', 'conflict'];

/**
 * The error for a non-2xx response. Bodies may be the app contract's
 * `{ code, message }` or the current server's `{ error }`; an empty or non-JSON 404 is
 * how axum answers a route that does not exist, so it says so.
 */
export function errorForResponse(route: string, status: number, bodyText: string): Error {
  type ErrorBody = { code?: unknown; message?: unknown; error?: unknown };
  let body: ErrorBody | null = null;
  try {
    const parsed: unknown = bodyText ? JSON.parse(bodyText) : null;
    if (typeof parsed === 'object' && parsed !== null) body = parsed as ErrorBody;
  } catch {
    // Not JSON: handled below.
  }
  const serverMessage = typeof body?.message === 'string' ? body.message : typeof body?.error === 'string' ? body.error : null;
  const bodyCode = typeof body?.code === 'string' && API_ERROR_CODES.includes(body.code) ? (body.code as TardyApiErrorCode) : null;
  const code = bodyCode ?? STATUS_CODES[status];
  if (status === 404 && serverMessage === null && bodyCode === null) {
    return new TardyApiError('not_found', `${route} is not implemented by this server (404 with no error body); see contracts/app-api-addendum.md`);
  }
  const message = `${serverMessage ?? `HTTP ${status}`} (${route})`;
  return code ? new TardyApiError(code, message) : new TardyHttpError(status, message);
}

type Auth =
  /** The current session's token and profile; sent when signed in, omitted otherwise. */
  | 'session'
  /** No credentials (sign-in, email codes). */
  | 'none'
  /** A specific token, without a profile (resuming a stored session). */
  | { token: string };

type RequestOptions<T> = {
  query?: Record<string, string | undefined>;
  body?: unknown;
  /** How to read a 2xx body; omitted means the body is ignored (204 or an unused echo). */
  decode?: Decoder<T>;
  auth?: Auth;
};

const segment = (value: string) => encodeURIComponent(value);

export class HttpTardyApi implements TardyApi {
  private readonly baseUrl: string;
  private readonly fetch: FetchLike;
  private current: { token: string; accountId: string } | null = null;

  constructor({ baseUrl, fetch = globalThis.fetch.bind(globalThis) as unknown as FetchLike }: HttpTardyApiOptions) {
    if (!/^https?:\/\/[^/]/.test(baseUrl)) throw new Error(`HttpTardyApi: baseUrl must be an http(s) URL, got "${baseUrl}"`);
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetch = fetch;
  }

  private adopt(signedIn: SignedIn): SignedIn {
    this.current = { token: signedIn.session.token, accountId: signedIn.session.accountId };
    return signedIn;
  }

  private headers(auth: Auth, hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (hasBody) headers['Content-Type'] = 'application/json';
    if (auth === 'session' && this.current) {
      headers.Authorization = `Bearer ${this.current.token}`;
      headers['x-tardy-profile-id'] = this.current.accountId;
    } else if (typeof auth === 'object') {
      headers.Authorization = `Bearer ${auth.token}`;
    }
    return headers;
  }

  private async request<T = void>(method: string, path: string, options: RequestOptions<T> = {}): Promise<T> {
    const { query, body, decode, auth = 'session' } = options;
    const search = Object.entries(query ?? {})
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const route = `${method} ${path}`;
    let response: { status: number; text(): Promise<string> };
    try {
      response = await this.fetch(`${this.baseUrl}${path}${search ? `?${search}` : ''}`, {
        method,
        headers: this.headers(auth, body !== undefined),
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new Error(`Network error on ${route}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    const text = await response.text();
    if (response.status < 200 || response.status > 299) throw errorForResponse(route, response.status, text);
    if (!decode) return undefined as T;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new TardyWireError(`${route}: expected a JSON body, got ${text ? `"${text.slice(0, 80)}"` : 'nothing'} (HTTP ${response.status})`);
    }
    try {
      return decode(json, 'response');
    } catch (error) {
      if (error instanceof TardyWireError) throw new TardyWireError(`${route}: ${error.message}`);
      throw error;
    }
  }

  // MARK: auth

  async signIn(credential: AuthCredential): Promise<SignedIn> {
    return this.adopt(await this.request('POST', '/v1/sessions', { body: snakeKeys(credential), decode: W.signedIn, auth: 'none' }));
  }

  async requestEmailCode(email: string): Promise<void> {
    await this.request('POST', '/v1/sessions/email-codes', { body: { email }, auth: 'none' });
  }

  async resumeSession(token: string): Promise<SignedIn> {
    return this.adopt(await this.request('GET', '/v1/session', { decode: W.signedIn, auth: { token } }));
  }

  async session(): Promise<SignedIn | null> {
    // No token means signed out; there is nothing to ask the server.
    if (!this.current) return null;
    return this.adopt(await this.request('GET', '/v1/session', { decode: W.signedIn, auth: { token: this.current.token } }));
  }

  async signOut(): Promise<void> {
    if (!this.current) throw new TardyApiError('unauthenticated', 'Not signed in');
    try {
      await this.request('DELETE', '/v1/session');
    } finally {
      // Signed out on this device either way; the auth layer reports a failed revoke.
      this.current = null;
    }
  }

  // MARK: onboarding and profile

  suggestedFollows(): Promise<Account[]> {
    return this.request('GET', '/v1/profile/suggested-follows', { decode: array(W.account) });
  }

  setHandle(handle: string): Promise<Account> {
    return this.request('PUT', '/v1/profile/handle', { body: { handle }, decode: W.account });
  }

  updateProfile(patch: ProfilePatch): Promise<Account> {
    // `name` is `display_name` on the wire (the Rust `Profile` field).
    return this.request('PATCH', '/v1/profile', { body: snakeKeys({ displayName: patch.name, bio: patch.bio }), decode: W.account });
  }

  async completeOnboarding(): Promise<SignedIn> {
    return this.adopt(await this.request('POST', '/v1/onboarding/complete', { decode: W.signedIn }));
  }

  me(): Promise<Account> {
    return this.request('GET', '/v1/profile', { decode: W.account });
  }

  account(id: string): Promise<Account> {
    return this.request('GET', `/v1/profiles/by-id/${segment(id)}`, { decode: W.account });
  }

  accountByHandle(handle: string): Promise<Account> {
    return this.request('GET', `/v1/profiles/${segment(handle)}`, { decode: W.account });
  }

  async accounts(ids: string[]): Promise<Account[]> {
    if (ids.length === 0) return [];
    return this.request('GET', '/v1/profiles', { query: { ids: ids.join(',') }, decode: array(W.account) });
  }

  followingIds(): Promise<string[]> {
    return this.request('GET', '/v1/profile/following', { decode: W.ids });
  }

  // MARK: feeds and posts

  homeFeed(cursor: string | null): Promise<Page<Post>> {
    return this.request('GET', '/v1/feed', { query: { cursor: cursor ?? undefined }, decode: W.page(W.post) });
  }

  reelsFeed(cursor: string | null): Promise<Page<Post>> {
    return this.request('GET', '/v1/feed/reels', { query: { cursor: cursor ?? undefined }, decode: W.page(W.post) });
  }

  trending(): Promise<Post[]> {
    return this.request('GET', '/v1/feed/hyper-tardy', { decode: W.trendingPosts });
  }

  accountPosts(accountId: string, cursor: string | null): Promise<Page<Post>> {
    return this.request('GET', `/v1/profiles/by-id/${segment(accountId)}/posts`, { query: { cursor: cursor ?? undefined }, decode: W.page(W.post) });
  }

  post(id: string): Promise<Post> {
    return this.request('GET', `/v1/posts/${segment(id)}`, { decode: W.post });
  }

  comments(postId: string): Promise<Comment[]> {
    return this.request('GET', `/v1/posts/${segment(postId)}/comments`, { decode: array(W.comment) });
  }

  addComment(postId: string, text: string): Promise<Comment> {
    return this.request('POST', `/v1/posts/${segment(postId)}/comments`, { body: { text }, decode: W.comment });
  }

  stories(): Promise<StoryGroup[]> {
    return this.request('GET', '/v1/stories', { decode: array(W.storyGroup) });
  }

  // MARK: messages

  threads(): Promise<Thread[]> {
    return this.request('GET', '/v1/dm-threads', { decode: array(W.thread) });
  }

  messages(threadId: string): Promise<Message[]> {
    return this.request('GET', `/v1/dm-threads/${segment(threadId)}/messages`, { decode: array(W.message) });
  }

  sendMessage(threadId: string, text: string): Promise<Message> {
    // `text` is `body` on the wire (the Rust `SendMessage` field).
    return this.request('POST', `/v1/dm-threads/${segment(threadId)}/messages`, { body: { body: text }, decode: W.message });
  }

  async markThreadRead(threadId: string, throughMessageId: string): Promise<void> {
    await this.request('POST', `/v1/dm-threads/${segment(threadId)}/read`, { body: { through_message_id: throughMessageId } });
  }

  // MARK: notifications and push

  notifications(): Promise<Notification[]> {
    return this.request('GET', '/v1/notifications', { decode: W.notifications });
  }

  async markNotificationsRead(through: string): Promise<void> {
    await this.request('POST', '/v1/notifications/read', { body: { through_at_ms: isoToMs(through) } });
  }

  async registerPushToken(registration: PushTokenRegistration): Promise<void> {
    await this.request('POST', '/v1/push/devices', { body: snakeKeys(registration) });
  }

  async unregisterPushToken(token: string): Promise<void> {
    await this.request('POST', '/v1/push/devices/unregister', { body: { token } });
  }

  notificationPreferences(): Promise<NotificationPreferences> {
    return this.request('GET', '/v1/push/preferences', { decode: W.notificationPreferences });
  }

  setNotificationDefault(kind: NotificationKind, enabled: boolean): Promise<NotificationPreferences> {
    // `kind` is `category` on the wire (the Rust `NotificationPreference` field).
    return this.request('PUT', '/v1/push/preferences', { body: { category: kind, enabled }, decode: W.notificationPreferences });
  }

  setNotificationOverride(projectId: string, kind: NotificationKind, enabled: boolean | null): Promise<NotificationPreferences> {
    return this.request('PUT', `/v1/push/preferences/projects/${segment(projectId)}`, {
      body: { category: kind, enabled },
      decode: W.notificationPreferences,
    });
  }

  // MARK: interactions

  async setLiked(postId: string, liked: boolean): Promise<void> {
    await this.request(liked ? 'PUT' : 'DELETE', `/v1/posts/${segment(postId)}/like`);
  }

  async setSaved(postId: string, saved: boolean): Promise<void> {
    await this.request(saved ? 'PUT' : 'DELETE', `/v1/saved-posts/${segment(postId)}`);
  }

  async setAlarm(postId: string, on: boolean): Promise<void> {
    await this.request(on ? 'PUT' : 'DELETE', `/v1/posts/${segment(postId)}/alarm`);
  }

  async setFollowing(accountId: string, following: boolean): Promise<void> {
    await this.request(following ? 'PUT' : 'DELETE', `/v1/profile/following/${segment(accountId)}`);
  }

  setVisibility(projectId: string, visibility: Visibility): Promise<Account> {
    return this.request('PUT', `/v1/profiles/by-id/${segment(projectId)}/visibility`, { body: { visibility }, decode: W.account });
  }

  async logEngagement(actions: EngagementAction[]): Promise<void> {
    if (actions.length === 0) return;
    await this.request('POST', '/v1/engagements', { body: { actions: actions.map((a) => snakeKeys(a)) } });
  }
}
