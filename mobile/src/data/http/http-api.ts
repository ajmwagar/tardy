import type { AgentActivity, AgentControls } from '@/agents/controls';
import { TardyApiError, type TardyApi, type TardyApiErrorCode } from '../api';
import type { AgentProfilePatch, ProfilePatch } from '../profile';
import type {
  Account,
  AgentPairing,
  AuthCredential,
  Comment,
  EngagementAction,
  Membership,
  PostSuggestion,
  PrivacySettings,
  Message,
  MessageAttachment,
  Notification,
  NotificationKind,
  NotificationPreferences,
  Page,
  Post,
  PushTokenRegistration,
  ReactionKind,
  SharedLink,
  SignedIn,
  StoryGroup,
  Thread,
  ThreadParticipant,
  TrendingSound,
  ThreadRef,
  Visibility,
} from '../types';
import { array, arraySkipping, isoToMs, object, snakeKeys, string, TardyWireError, type Decoder } from './codec';
import * as W from './wire';
import type { PlayKind } from '@/audio/plays';
import type { PlanId } from '@/membership/plans';
import { conversationPlan, sameMembers } from '@/share/conversation-plan';
import { tardyUrl } from '@/share/links';

/** The server's page limit for conversation messages (1..=100). */
const MESSAGE_PAGE = 100;
const REQUEST_TIMEOUT_MS = 12_000;
const AUTH_REQUEST_TIMEOUT_MS = 30_000;

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

const API_ERROR_CODES: readonly string[] = ['forbidden', 'not_found', 'unauthenticated', 'invalid', 'conflict', 'consent_required'];

/** Today's server says "explicit search AI consent is required" with a plain 403; the contract asks for the code. */
const isConsentMessage = (status: number, message: string | null) => status === 403 && !!message && /\bconsent\b/i.test(message);

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
  const code = bodyCode ?? (isConsentMessage(status, serverMessage) ? 'consent_required' : STATUS_CODES[status]);
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
  timeoutMs?: number;
};

const segment = (value: string) => encodeURIComponent(value);

export class HttpTardyApi implements TardyApi {
  private readonly baseUrl: string;
  private readonly fetch: FetchLike;
  private current: { token: string; accountId: string } | null = null;
  /** Links this client created, so a link share can fall back to its URL as the message body. */
  private links = new Map<string, SharedLink>();

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
    const { query, body, decode, auth = 'session', timeoutMs = REQUEST_TIMEOUT_MS } = options;
    const search = Object.entries(query ?? {})
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const route = `${method} ${path}`;
    let response: { status: number; text(): Promise<string> };
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      response = await Promise.race([
        this.fetch(`${this.baseUrl}${path}${search ? `?${search}` : ''}`, {
          method,
          headers: this.headers(auth, body !== undefined),
          ...(body !== undefined && { body: JSON.stringify(body) }),
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(`request timed out after ${timeoutMs / 1_000}s`)), timeoutMs);
        }),
      ]);
    } catch (error) {
      throw new Error(`Network error on ${route}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
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
    return this.adopt(await this.request('POST', '/v1/sessions', {
      body: snakeKeys(credential), decode: W.signedIn, auth: 'none', timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
    }));
  }

  async developmentSession(): Promise<SignedIn> {
    return this.adopt(await this.request('POST', '/v1/dev/session', {
      body: { email: process.env.EXPO_PUBLIC_TARDY_DEV_EMAIL },
      decode: W.signedIn,
      auth: 'none',
    }));
  }

  async webHandoff(returnPath: '/verify' | '/membership'): Promise<string> {
    const result = await this.request('POST', '/v1/web/handoffs', {
      body: { return_path: returnPath },
      decode: object<{ url: string }>({ url: string }),
    });
    return result.url;
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

  profileAgents(profileId: string): Promise<Account[]> {
    return this.request('GET', `/v1/profiles/by-id/${segment(profileId)}/agents`, { decode: array(W.account) });
  }

  updateAgentProfile(agentId: string, patch: AgentProfilePatch): Promise<Account> {
    return this.request('PATCH', `/v1/agents/${segment(agentId)}/profile`, {
      body: snakeKeys({ handle: patch.handle, displayName: patch.name, bio: patch.bio, avatarUrl: patch.avatarUrl }),
      decode: W.account,
    });
  }

  generateAgentAvatar(agentId: string): Promise<Account> {
    return this.request('POST', `/v1/agents/${segment(agentId)}/avatar/generate`, { decode: W.account });
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
    return this.request('GET', `/v1/social/posts/${segment(postId)}/comments`, { decode: array(W.comment) });
  }

  addComment(postId: string, text: string, mentionedIds: readonly string[] = []): Promise<Comment> {
    return this.request('POST', `/v1/social/posts/${segment(postId)}/comments`, {
      body: { body: text, mentioned_profile_ids: mentionedIds },
      decode: W.comment,
    });
  }

  stories(): Promise<StoryGroup[]> {
    return this.request('GET', '/v1/stories', { decode: array(W.storyGroup) });
  }

  // MARK: messages

  async threads(): Promise<Thread[]> {
    const rows = await this.request('GET', '/v1/social/conversations', { decode: array(W.conversation) });
    // `last_message` is a proposed addition; until the server sends it, read the tail ourselves.
    const threads = await Promise.all(
      rows.map(async ({ lastMessage, unreadCount, ...ref }): Promise<Thread | null> => {
        const last = lastMessage ?? (await this.messages(ref.id)).at(-1);
        return last ? { ...ref, lastMessage: last, unreadCount: unreadCount ?? 0 } : null;
      }),
    );
    return threads
      .filter((t): t is Thread => t !== null)
      .sort((a, b) => Date.parse(b.lastMessage.createdAt) - Date.parse(a.lastMessage.createdAt));
  }

  async thread(threadId: string): Promise<ThreadRef> {
    // No single-conversation read yet (proposed `GET /v1/social/conversations/{id}`): find it in the list.
    const rows = await this.request('GET', '/v1/social/conversations', { decode: array(W.conversation) });
    const row = rows.find((t) => t.id === threadId);
    if (!row) throw new TardyApiError('not_found', `Not found: thread ${threadId}`);
    const { lastMessage: _last, unreadCount: _unread, ...ref } = row;
    return ref;
  }

  async messages(threadId: string, afterSequence = 0): Promise<Message[]> {
    const all: Message[] = [];
    for (let after = afterSequence; ; ) {
      const page = await this.request('GET', `/v1/social/conversations/${segment(threadId)}/messages`, {
        query: { after: String(after), limit: String(MESSAGE_PAGE) },
        decode: array(W.conversationMessage),
      });
      all.push(...page.map((p) => p.message));
      if (page.length < MESSAGE_PAGE) return all;
      after = page[page.length - 1].sequence;
    }
  }

  async sendMessage(threadId: string, text: string, attachment?: MessageAttachment): Promise<Message> {
    const path = `/v1/social/conversations/${segment(threadId)}/messages`;
    const send = (body: string, sharedLinkId?: string) =>
      this.request('POST', path, { body: { body, ...(sharedLinkId && { shared_link_id: sharedLinkId }) }, decode: W.message });
    if (!attachment) return send(text);
    if ('sharedPostId' in attachment) {
      // A tardy travels as a shared link to its web URL (the body must be non-empty, and the
      // URL is what agents can resolve). A note follows as its own message.
      const link = await this.createSharedLink(tardyUrl(attachment.sharedPostId));
      const shared = await send(link.canonicalUrl, link.id);
      if (text.trim()) await send(text);
      return shared;
    }
    const link = this.links.get(attachment.sharedLinkId);
    if (!text.trim() && !link) throw new TardyApiError('invalid', 'A shared link needs text, or a link created by this client.');
    return send(text.trim() || link!.canonicalUrl, attachment.sharedLinkId);
  }

  typing(threadId: string): Promise<string[]> {
    return this.request('GET', `/v1/social/conversations/${segment(threadId)}/typing`, { decode: array(string) });
  }

  async setTyping(threadId: string, active: boolean): Promise<void> {
    await this.request(active ? 'PUT' : 'DELETE', `/v1/social/conversations/${segment(threadId)}/typing`);
  }

  async openThread(participants: readonly ThreadParticipant[], title?: string): Promise<ThreadRef> {
    const viewerId = this.current?.accountId;
    if (!viewerId) throw new TardyApiError('unauthenticated', 'Sign in to message.');
    const plan = conversationPlan(participants, viewerId);
    if (!plan.ok) {
      throw new TardyApiError('invalid', 'A thread needs someone besides you.');
    }
    const others = [...plan.recipientIds, ...plan.addAgentIds];
    const name = title?.trim();
    const explicitGroup = others.length > 1 || Boolean(name);
    if (!explicitGroup) {
      const existing = (await this.request('GET', '/v1/social/conversations', { decode: array(W.conversation) })).find((t) =>
        t.participantIds.length === 2 && sameMembers(t.participantIds, viewerId, others),
      );
      if (existing) {
        const { lastMessage: _last, unreadCount: _unread, ...ref } = existing;
        return ref;
      }
    }
    let thread = await this.request('POST', '/v1/social/conversations', {
      body: { participant_profile_ids: plan.recipientIds, ...(name && { title: name }) },
      decode: W.threadRef,
    });
    for (const agentId of plan.addAgentIds) thread = await this.addAgent(thread.id, agentId);
    return thread;
  }

  renameThread(threadId: string, title?: string): Promise<ThreadRef> {
    return this.request('PUT', `/v1/social/conversations/${segment(threadId)}`, {
      body: { title: title?.trim() || null }, decode: W.threadRef,
    });
  }

  addThreadParticipant(threadId: string, profileId: string): Promise<ThreadRef> {
    return this.request('POST', `/v1/social/conversations/${segment(threadId)}/participants`, {
      body: { profile_id: profileId }, decode: W.threadRef,
    });
  }

  removeThreadParticipant(threadId: string, profileId: string): Promise<ThreadRef> {
    return this.request('DELETE', `/v1/social/conversations/${segment(threadId)}/participants/${segment(profileId)}`, {
      decode: W.threadRef,
    });
  }

  addAgent(threadId: string, agentId: string, includeAnchorShare = true): Promise<ThreadRef> {
    return this.request('POST', `/v1/social/conversations/${segment(threadId)}/agents`, {
      body: { agent_profile_id: agentId, include_anchor_share: includeAnchorShare },
      decode: W.threadRef,
    });
  }

  sharedLink(id: string): Promise<SharedLink> {
    return this.request('GET', `/v1/social/shared-links/${segment(id)}`, { decode: W.sharedLink });
  }

  async createSharedLink(url: string): Promise<SharedLink> {
    const link = await this.request('POST', '/v1/social/shared-links', { body: { url }, decode: W.sharedLink });
    this.links.set(link.id, link);
    return link;
  }

  searchAccounts(query: string): Promise<Account[]> {
    return this.request('GET', '/v1/profiles/search', { query: { q: query }, decode: array(W.account) });
  }

  reactToMessage(threadId: string, messageId: string, kind: ReactionKind | null): Promise<Message> {
    const path = `/v1/social/conversations/${segment(threadId)}/messages/${segment(messageId)}/reaction`;
    return kind ? this.request('PUT', path, { body: { kind }, decode: W.message }) : this.request('DELETE', path, { decode: W.message });
  }

  reactToComment(postId: string, commentId: string, kind: ReactionKind | null): Promise<Comment> {
    const path = `/v1/social/posts/${segment(postId)}/comments/${segment(commentId)}/reaction`;
    return kind ? this.request('PUT', path, { body: { kind }, decode: W.comment }) : this.request('DELETE', path, { decode: W.comment });
  }

  async markThreadRead(threadId: string, throughMessageId: string): Promise<void> {
    await this.request('POST', `/v1/social/conversations/${segment(threadId)}/read`, { body: { through_message_id: throughMessageId } });
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

  async setReposted(postId: string, reposted: boolean): Promise<void> {
    await this.request(reposted ? 'PUT' : 'DELETE', `/v1/posts/${segment(postId)}/repost`);
  }

  async setFollowing(accountId: string, following: boolean): Promise<void> {
    await this.request(following ? 'PUT' : 'DELETE', `/v1/profiles/${segment(accountId)}/follow`);
  }

  generateAvatar(): Promise<Account> {
    return this.request('POST', '/v1/profile/avatar/generate', { decode: W.account });
  }

  trendingSounds(limit = 20): Promise<TrendingSound[]> {
    return this.request('GET', '/v1/audio/trending', { query: { limit: String(limit) }, decode: array(W.trendingSound), auth: 'none' });
  }

  async logSoundPlay(trackId: string, play: { eventId: string; postId?: string; kind: PlayKind; listenMs: number }): Promise<void> {
    await this.request('POST', `/v1/audio/tracks/${segment(trackId)}/usage`, {
      body: { event_id: play.eventId, kind: play.kind, listen_ms: play.listenMs, ...(play.postId && { post_id: play.postId }) },
    });
  }

  async searchTardies(query: string, limit = 30): Promise<Post[]> {
    const rows = await this.request('POST', '/v1/search', { body: { query, limit }, decode: array(W.searchResult) });
    return rows.map((r) => r.post);
  }

  async allowAiSearch(): Promise<void> {
    await this.request('POST', '/v1/ai-consents/search');
  }

  explore(cursor: string | null): Promise<Page<Post>> {
    return this.request('GET', '/v1/explore', { query: { cursor: cursor ?? undefined }, decode: W.page(W.post) });
  }

  postSuggestions(): Promise<PostSuggestion[]> {
    return this.request('GET', '/v1/social/post-suggestions', { decode: array(W.postSuggestion) });
  }

  async decideSuggestion(id: string, decision: 'approve' | 'reject'): Promise<Post | null> {
    const path = `/v1/social/post-suggestions/${segment(id)}/${decision}`;
    if (decision === 'reject') {
      await this.request('POST', path);
      return null;
    }
    return this.request('POST', path, { decode: W.post });
  }

  agentControls(agentId: string): Promise<AgentControls> {
    return this.request('GET', `/v1/agents/${segment(agentId)}/controls`, { decode: W.agentControls });
  }

  updateAgentControls(agentId: string, patch: Partial<AgentControls>): Promise<AgentControls> {
    return this.request('PATCH', `/v1/agents/${segment(agentId)}/controls`, { body: snakeKeys(patch), decode: W.agentControls });
  }

  agentActivity(agentId: string): Promise<AgentActivity[]> {
    return this.request('GET', `/v1/agents/${segment(agentId)}/activity`, { decode: arraySkipping(W.agentActivity) });
  }

  privacySettings(): Promise<PrivacySettings> {
    return this.request('GET', '/v1/profile/privacy-settings', { decode: W.privacySettings });
  }

  updatePrivacy(patch: Partial<PrivacySettings>): Promise<PrivacySettings> {
    return this.request('PATCH', '/v1/profile/privacy-settings', { body: snakeKeys(patch), decode: W.privacySettings });
  }

  closeFriends(): Promise<Account[]> {
    return this.request('GET', '/v1/profile/close-friends', { decode: array(W.account) });
  }

  async setCloseFriend(accountId: string, on: boolean): Promise<void> {
    await this.request(on ? 'PUT' : 'DELETE', `/v1/profile/close-friends/${segment(accountId)}`);
  }

  blockedAccounts(): Promise<Account[]> {
    return this.request('GET', '/v1/blocks', { decode: array(W.account) });
  }

  async setBlocked(accountId: string, blocked: boolean): Promise<void> {
    // Blocking exists today (POST); listing and unblocking (DELETE) are proposed.
    await this.request(blocked ? 'POST' : 'DELETE', `/v1/blocks/${segment(accountId)}`);
  }

  membership(): Promise<Membership> {
    return this.request('GET', '/v1/membership', { decode: W.membership });
  }

  approveAutopay(approval: { plan: PlanId; payerAgentId: string; maxCentsPerMonth: number }): Promise<Membership> {
    return this.request('PUT', '/v1/membership/autopay', { body: snakeKeys(approval), decode: W.membership });
  }

  revokeAutopay(): Promise<Membership> {
    return this.request('DELETE', '/v1/membership/autopay', { decode: W.membership });
  }

  startManagedDemo(): Promise<Membership> {
    return this.request('POST', '/v1/membership/demo', { decode: W.membership });
  }

  async claimAgent(code: string): Promise<void> {
    await this.request('POST', '/v1/onboarding/tardy-claims', { body: { code: code.trim() } });
  }

  createAgentPairing(): Promise<AgentPairing> {
    return this.request('POST', '/v1/onboarding/tardies', { body: {}, decode: W.agentPairing, auth: 'none' });
  }

  setVisibility(projectId: string, visibility: Visibility): Promise<Account> {
    return this.request('PUT', `/v1/profiles/by-id/${segment(projectId)}/visibility`, { body: { visibility }, decode: W.account });
  }

  async logEngagement(actions: EngagementAction[]): Promise<void> {
    if (actions.length === 0) return;
    await this.request('POST', '/v1/engagements', { body: { actions: actions.map((a) => snakeKeys(a)) } });
  }
}
