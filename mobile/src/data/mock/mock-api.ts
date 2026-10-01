import { canSetVisibility, canViewAccount, canViewPost, policyWorld, type PolicyWorld } from '@/privacy/policy';
import { rankForYou, trendingPosts, type Viewer } from '@/ranking/for-you';
import { handleProblem } from '@/auth/handle';
import { encodePushPayload, payloadFor } from '@/notifications/payload';
import {
  decidePush,
  DEFAULT_PREFERENCES,
  eventProjectId,
  withDefault,
  withOverride,
  type PushDecision,
} from '@/notifications/preferences';

import { TardyApiError, type TardyApi } from '../api';
import type {
  Account,
  AuthCredential,
  EngagementAction,
  Message,
  NotificationKind,
  NotificationPreferences,
  Page,
  Post,
  ProjectMembership,
  PushTokenRegistration,
  SignedIn,
  Visibility,
} from '../types';
import {
  ACCOUNTS,
  COMMENTS,
  FOLLOWING,
  MEMBERSHIPS,
  MESSAGES,
  MUTUALS,
  NOTIFICATIONS,
  POSTS,
  STORIES,
  THREADS,
} from './fixtures';
import { MockAuthServer, type MockPersistence } from './mock-auth';

/**
 * DEV ONLY: what the push service would send for one event. `decision` says whether it
 * would be pushed and which preference rule decided; the rest is the push itself.
 */
export type SimulatedPush = {
  decision: PushDecision;
  title: string;
  body: string;
  /** The push's `data`, in wire form (see `src/notifications/payload.ts`). */
  data: Record<string, string | number>;
};

const PAGE_SIZE = 6;
const LATENCY_MS = 150;

function notFound(what: string): never {
  throw new TardyApiError('not_found', `Not found: ${what}`);
}

function forbidden(what: string): never {
  throw new TardyApiError('forbidden', `Not allowed: ${what}`);
}

export type MockTardyApiOptions = {
  /**
   * Who is signed in at construction. Defaults to the fixture viewer, `me`; `null`
   * starts signed out, as the app does (sign in with `mockCredential`).
   */
  viewerId?: string | null;
  /** Where the mock server keeps sessions and onboarding across relaunches. */
  persistence?: MockPersistence;
  /** Accounts the viewer follows. Defaults to the fixture follow graph. */
  following?: Iterable<string>;
  memberships?: readonly ProjectMembership[];
  latencyMs?: number;
};

/**
 * In-memory `TardyApi` over the fixtures. Feeds are ranked with the real For You value
 * model against the engagement this session has logged, so liking an agent's posts
 * visibly changes what comes next on refresh.
 *
 * Cursors are `<snapshot>:<offset>`: a ranking is computed once per refresh and paged
 * through, so items do not reshuffle mid-scroll.
 *
 * Privacy (`src/privacy/policy.ts`) is applied the way the server will: candidates are
 * filtered before ranking, every page is re-checked when served (visibility can narrow
 * mid-scroll), lists drop what the viewer cannot see, and direct lookups of something
 * hidden throw `TardyApiError('forbidden')`.
 */
export class MockTardyApi implements TardyApi {
  private readonly auth: MockAuthServer;
  private readonly latencyMs: number;
  private accountsById = new Map(ACCOUNTS.map((a) => [a.id, a]));
  private world: PolicyWorld;
  private posts = new Map(POSTS.map((p) => [p.id, p]));
  private following: Set<string>;
  private history: EngagementAction[] = [];
  private messageLog: Message[] = [...MESSAGES];
  /** Per (viewer, thread): index into the thread's messages of the last one read. */
  private threadReadThrough = new Map<string, number>();
  /** Per viewer: notifications at or before this time are read. */
  private notificationsReadThrough = new Map<string, number>();
  private snapshots = new Map<string, Post[]>();
  private snapshotSeq = 0;
  /** By token: a device belongs to whoever registered it last (sign-in moves it). */
  private pushTokens = new Map<string, { viewerId: string; registration: PushTokenRegistration }>();
  private preferencesByViewer = new Map<string, NotificationPreferences>();

  constructor({
    viewerId = 'me',
    following = FOLLOWING,
    memberships = MEMBERSHIPS,
    latencyMs = LATENCY_MS,
    persistence,
  }: MockTardyApiOptions = {}) {
    this.auth = new MockAuthServer(persistence, viewerId);
    this.latencyMs = latencyMs;
    this.following = new Set(following);
    // Built once to validate membership invariants; account lookups read live state so
    // `setVisibility` takes effect immediately.
    const { role } = policyWorld(ACCOUNTS, memberships);
    this.world = { account: (id) => this.accountsById.get(id), role };
  }

  /** Throws `unauthenticated` when signed out, so every data call 401s like the server. */
  private get viewerId(): string {
    return this.auth.viewerId;
  }

  private delay<T>(value: T): Promise<T> {
    return new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), this.latencyMs));
  }

  private viewer(): Viewer {
    return {
      id: this.viewerId,
      following: this.following,
      mutuals: this.viewerId === 'me' ? MUTUALS : new Set(),
      history: this.history,
    };
  }

  private canSeeAccount = (account: Account) => canViewAccount(this.viewerId, account, this.world);
  private canSeePost = (post: Post) => canViewPost(this.viewerId, post, this.world);
  private canSeeAccountId = (id: string) => {
    const account = this.accountsById.get(id);
    return account !== undefined && this.canSeeAccount(account);
  };

  /** Adds the viewer-relative fields the server computes per request. */
  private present(account: Account): Account {
    if (account.kind !== 'project') return account;
    const viewerRole = this.world.role(this.viewerId, account.id);
    return viewerRole ? { ...account, viewerRole } : account;
  }

  private visibleAccount(id: string, label = `account ${id}`): Account {
    const account = this.accountsById.get(id) ?? notFound(label);
    if (!this.canSeeAccount(account)) forbidden(label);
    return this.present(account);
  }

  private visiblePost(id: string): Post {
    const post = this.posts.get(id) ?? notFound(`post ${id}`);
    if (!this.canSeePost(post)) forbidden(`post ${id}`);
    return post;
  }

  private async page(key: string, cursor: string | null, rank: () => Post[], loop: boolean): Promise<Page<Post>> {
    let snapshotId: string;
    let offset: number;
    if (cursor) {
      const [id, rawOffset] = cursor.split(':');
      if (!this.snapshots.has(id) || Number.isNaN(Number(rawOffset))) throw new Error(`Invalid cursor: ${cursor}`);
      snapshotId = id;
      offset = Number(rawOffset);
    } else {
      snapshotId = `${key}${++this.snapshotSeq}`;
      this.snapshots.set(snapshotId, rank());
      offset = 0;
    }

    const ranked = this.snapshots.get(snapshotId)!;
    if (ranked.length === 0) return this.delay({ items: [], nextCursor: null });

    const items = loop
      ? Array.from({ length: PAGE_SIZE }, (_, i) => ranked[(offset + i) % ranked.length])
      : ranked.slice(offset, offset + PAGE_SIZE);
    const end = offset + items.length;
    const nextCursor = loop || end < ranked.length ? `${snapshotId}:${end}` : null;
    // Re-checked at serve time: a project may have narrowed since the snapshot was ranked.
    const current = items.map((p) => this.posts.get(p.id) ?? notFound(`post ${p.id}`)).filter(this.canSeePost);
    return this.delay({ items: current, nextCursor });
  }

  /** Visible posts matching `filter`, ranked. Privacy filtering happens before ranking. */
  private ranked(filter: (p: Post) => boolean): Post[] {
    const candidates = [...this.posts.values()].filter(this.canSeePost).filter(filter);
    return rankForYou(candidates, this.viewer()).map(({ post, score, inNetwork }) => ({
      ...post,
      ranking: { score, inNetwork },
    }));
  }

  /** Resolves a shared post for this viewer, dropping even its id when they cannot see it. */
  private presentMessage = (message: Message): Message => {
    const shared = message.sharedPost;
    if (shared?.status !== 'available') return message;
    const post = this.posts.get(shared.postId);
    return post && this.canSeePost(post) ? message : { ...message, sharedPost: { status: 'unavailable' } };
  };

  /** The viewer's threads, minus any with a participant they can no longer see. */
  private visibleThreads() {
    return THREADS.filter((t) => t.participantIds.includes(this.viewerId) && t.participantIds.every(this.canSeeAccountId));
  }

  private visibleThread(threadId: string) {
    if (!THREADS.some((t) => t.id === threadId)) notFound(`thread ${threadId}`);
    if (!this.visibleThreads().some((t) => t.id === threadId)) forbidden(`thread ${threadId}`);
  }

  // MARK: auth & onboarding

  /** Applies persisted handle claims; every auth entry point awaits it first. */
  private async loadAuth() {
    for (const [id, handle] of Object.entries(await this.auth.load())) {
      const account = this.accountsById.get(id);
      if (account) this.accountsById.set(id, { ...account, handle });
    }
  }

  private signedIn(): SignedIn {
    const session = this.auth.session ?? notFound('session');
    return { session, account: this.visibleAccount(session.accountId), onboardedAt: this.auth.onboardedAt(session.accountId) };
  }

  async signIn(credential: AuthCredential) {
    await this.loadAuth();
    await this.auth.signIn(credential);
    return this.delay(this.signedIn());
  }

  async resumeSession(token: string) {
    await this.loadAuth();
    await this.auth.resume(token);
    return this.delay(this.signedIn());
  }

  async session() {
    return this.delay(this.auth.session ? this.signedIn() : null);
  }

  async signOut() {
    await this.auth.signOut();
    return this.delay(undefined);
  }

  async suggestedFollows() {
    const suggested = [...this.accountsById.values()].filter(
      (a) => a.kind !== 'human' && !this.following.has(a.id) && this.canSeeAccount(a),
    );
    return this.delay(suggested.map((a) => this.present(a)));
  }

  async setHandle(handle: string) {
    const me = this.visibleAccount(this.viewerId);
    const problem = handleProblem(handle);
    if (problem) throw new TardyApiError('invalid', problem);
    if ([...this.accountsById.values()].some((a) => a.handle === handle && a.id !== me.id)) {
      throw new TardyApiError('conflict', `@${handle} is taken`);
    }
    const updated = { ...this.accountsById.get(me.id)!, handle };
    this.accountsById.set(me.id, updated);
    await this.auth.claimHandle(me.id, handle);
    return this.delay(this.present(updated));
  }

  async completeOnboarding() {
    await this.auth.completeOnboarding(this.viewerId);
    return this.delay(this.signedIn());
  }

  // MARK: data

  async me() {
    return this.account(this.viewerId);
  }

  async account(id: string): Promise<Account> {
    return this.delay(this.visibleAccount(id));
  }

  async accounts(ids: string[]): Promise<Account[]> {
    return this.delay(ids.map((id) => this.visibleAccount(id)));
  }

  async followingIds() {
    // A follow edge to a project that has since narrowed must not reveal it.
    return this.delay([...this.following].filter(this.canSeeAccountId));
  }

  async accountByHandle(handle: string): Promise<Account> {
    const account = [...this.accountsById.values()].find((a) => a.handle === handle) ?? notFound(`@${handle}`);
    return this.delay(this.visibleAccount(account.id, `@${handle}`));
  }

  async homeFeed(cursor: string | null) {
    return this.page('home', cursor, () => this.ranked(() => true), false);
  }

  async reelsFeed(cursor: string | null) {
    return this.page('reels', cursor, () => this.ranked((p) => p.format === 'reel'), true);
  }

  async trending() {
    return this.delay(trendingPosts([...this.posts.values()].filter(this.canSeePost)).slice(0, 5));
  }

  async accountPosts(accountId: string, cursor: string | null) {
    this.visibleAccount(accountId);
    // A project profile shows its own posts plus everything its agents posted about it.
    const mine = (p: Post) => (p.authorId === accountId || p.projectId === accountId) && this.canSeePost(p);
    const newest = () =>
      [...this.posts.values()].filter(mine).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return this.page(`acct-${accountId}-`, cursor, newest, false);
  }

  async post(id: string) {
    return this.delay(this.visiblePost(id));
  }

  async comments(postId: string) {
    this.visiblePost(postId);
    return this.delay(COMMENTS.filter((c) => c.postId === postId && this.canSeeAccountId(c.authorId)));
  }

  async stories() {
    const authors = [...new Set(STORIES.map((s) => s.authorId))].filter(this.canSeeAccountId);
    return this.delay(authors.map((authorId) => ({ authorId, stories: STORIES.filter((s) => s.authorId === authorId) })));
  }

  /** Unread = messages from others after the viewer's watermark; fixtures seed the watermark. */
  private unreadIn(thread: (typeof THREADS)[number], messages: Message[]) {
    const key = `${this.viewerId}:${thread.id}`;
    const through = this.threadReadThrough.get(key) ?? messages.length - 1 - thread.unreadCount;
    return messages.slice(through + 1).filter((m) => m.senderId !== this.viewerId).length;
  }

  async threads() {
    const threads = this.visibleThreads().map((t) => {
      const messages = this.messageLog.filter((m) => m.threadId === t.id);
      return { ...t, lastMessage: this.presentMessage(messages[messages.length - 1]), unreadCount: this.unreadIn(t, messages) };
    });
    return this.delay(threads.sort((a, b) => Date.parse(b.lastMessage.createdAt) - Date.parse(a.lastMessage.createdAt)));
  }

  async messages(threadId: string) {
    this.visibleThread(threadId);
    return this.delay(this.messageLog.filter((m) => m.threadId === threadId).map(this.presentMessage));
  }

  async sendMessage(threadId: string, text: string) {
    this.visibleThread(threadId);
    const message: Message = {
      id: `${threadId}-m${this.messageLog.length}`,
      threadId,
      senderId: this.viewerId,
      text,
      createdAt: new Date().toISOString(),
    };
    this.messageLog.push(message);
    this.scheduleAgentReply(threadId);
    return this.delay(message);
  }

  async markThreadRead(threadId: string, throughMessageId: string) {
    this.visibleThread(threadId);
    const messages = this.messageLog.filter((m) => m.threadId === threadId);
    const index = messages.findIndex((m) => m.id === throughMessageId);
    if (index < 0) notFound(`message ${throughMessageId} in ${threadId}`);
    const key = `${this.viewerId}:${threadId}`;
    this.threadReadThrough.set(key, Math.max(index, this.threadReadThrough.get(key) ?? -1));
    return this.delay(undefined);
  }

  /**
   * Mock only: agents answer DMs a moment later with a status-flavored reply, so the thread
   * screen's polling has something to pick up. The real server relays the agent's own message.
   */
  private scheduleAgentReply(threadId: string) {
    const thread = THREADS.find((t) => t.id === threadId);
    const other = thread?.participantIds.find((id) => id !== this.viewerId);
    if (!other || this.accountsById.get(other)?.kind !== 'agent') return;
    const replies = [
      'On it. I will post an update when it ships.',
      'Copy. Running the tests now.',
      'Good call. Opening a PR for that.',
      'Blocked on review, can you take a look?',
    ];
    const count = this.messageLog.filter((m) => m.threadId === threadId).length;
    setTimeout(() => {
      this.messageLog.push({
        id: `${threadId}-m${this.messageLog.length}`,
        threadId,
        senderId: other,
        text: replies[count % replies.length],
        createdAt: new Date().toISOString(),
      });
    }, 1500);
  }

  async notifications() {
    const visible = NOTIFICATIONS.filter((n) => {
      if (!this.canSeeAccountId(n.actorId)) return false;
      if (n.postId === undefined) return true;
      const post = this.posts.get(n.postId);
      return post !== undefined && this.canSeePost(post);
    });
    const through = this.notificationsReadThrough.get(this.viewerId) ?? -Infinity;
    return this.delay(visible.map((n) => (n.read || Date.parse(n.createdAt) > through ? n : { ...n, read: true })));
  }

  async markNotificationsRead(through: string) {
    const at = Date.parse(through);
    if (Number.isNaN(at)) throw new Error(`markNotificationsRead: invalid time ${through}`);
    this.notificationsReadThrough.set(this.viewerId, Math.max(at, this.notificationsReadThrough.get(this.viewerId) ?? -Infinity));
    return this.delay(undefined);
  }

  async registerPushToken(registration: PushTokenRegistration) {
    if (!registration.token) throw new Error('registerPushToken: empty token');
    this.pushTokens.set(registration.token, { viewerId: this.viewerId, registration });
    return this.delay(undefined);
  }

  async unregisterPushToken(token: string) {
    if (this.pushTokens.get(token)?.viewerId === this.viewerId) this.pushTokens.delete(token);
    return this.delay(undefined);
  }

  /** Devices this viewer registered. Test/dev inspection only; not on `TardyApi`. */
  registeredPushTokens(): PushTokenRegistration[] {
    return [...this.pushTokens.values()].filter((t) => t.viewerId === this.viewerId).map((t) => t.registration);
  }

  private get preferences(): NotificationPreferences {
    return this.preferencesByViewer.get(this.viewerId) ?? DEFAULT_PREFERENCES;
  }

  private set preferences(next: NotificationPreferences) {
    this.preferencesByViewer.set(this.viewerId, next);
  }

  /** Overrides on projects the viewer can no longer see are kept but not revealed. */
  private presentPreferences(): NotificationPreferences {
    const overrides = this.preferences.overrides.filter((o) => this.canSeeAccountId(o.projectId));
    return { ...this.preferences, overrides };
  }

  async notificationPreferences() {
    return this.delay(this.presentPreferences());
  }

  async setNotificationDefault(kind: NotificationKind, enabled: boolean) {
    if (!(kind in this.preferences.defaults)) throw new Error(`Unknown notification kind ${kind}`);
    this.preferences = withDefault(this.preferences, kind, enabled);
    return this.delay(this.presentPreferences());
  }

  async setNotificationOverride(projectId: string, kind: NotificationKind, enabled: boolean | null) {
    const project = this.visibleAccount(projectId, `project ${projectId}`);
    if (project.kind !== 'project') notFound(`project ${projectId}`);
    if (!(kind in this.preferences.defaults)) throw new Error(`Unknown notification kind ${kind}`);
    this.preferences = withOverride(this.preferences, projectId, kind, enabled);
    return this.delay(this.presentPreferences());
  }

  /**
   * DEV ONLY (not on `TardyApi`): the push the server would send this viewer for fixture
   * notification `id`. This is the delivery point, so it runs the same checks the push
   * service must, in the same order.
   */
  async simulatePush(id: string): Promise<SimulatedPush> {
    const n = NOTIFICATIONS.find((x) => x.id === id) ?? notFound(`notification ${id}`);
    // SERVER MUST: re-check privacy here, at delivery time, for every recipient. A user
    // must never get a push about a post (or from an actor) they cannot see under the
    // project's visibility *now* -- not when the event happened, not when they subscribed
    // or set an alarm. Visibility can narrow between the event and the send, and title and
    // body text reach the lock screen, where no later API check can take them back.
    const actor = this.visibleAccount(n.actorId);
    const post = n.postId === undefined ? undefined : this.visiblePost(n.postId);
    const decision = decidePush(this.preferences, {
      kind: n.kind,
      projectId: eventProjectId(actor, post),
      alarmed: post?.viewerHasAlarm ?? false,
    });
    return this.delay({ decision, title: actor.name, body: `@${actor.handle} ${n.text}`, data: encodePushPayload(payloadFor(n)) });
  }

  async setLiked(postId: string, liked: boolean) {
    const post = this.visiblePost(postId);
    if (post.viewerHasLiked !== liked) {
      this.posts.set(postId, { ...post, viewerHasLiked: liked, likeCount: post.likeCount + (liked ? 1 : -1) });
    }
    return this.delay(undefined);
  }

  async setSaved(postId: string, saved: boolean) {
    this.posts.set(postId, { ...this.visiblePost(postId), viewerHasSaved: saved });
    return this.delay(undefined);
  }

  async setAlarm(postId: string, on: boolean) {
    const post = this.visiblePost(postId);
    if (post.viewerHasAlarm !== on) {
      this.posts.set(postId, { ...post, viewerHasAlarm: on, alarmCount: post.alarmCount + (on ? 1 : -1) });
    }
    return this.delay(undefined);
  }

  async setFollowing(accountId: string, following: boolean) {
    // Following needs visibility; unfollowing something that has since narrowed does not.
    if (following) {
      this.visibleAccount(accountId);
      this.following.add(accountId);
    } else {
      this.following.delete(accountId);
    }
    return this.delay(undefined);
  }

  async setVisibility(projectId: string, visibility: Visibility): Promise<Account> {
    const project = this.visibleAccount(projectId, `project ${projectId}`);
    if (project.kind !== 'project') notFound(`project ${projectId}`);
    if (!canSetVisibility(this.viewerId, project, this.world)) forbidden(`change visibility of ${projectId}`);
    const updated = { ...this.accountsById.get(projectId)!, visibility };
    this.accountsById.set(projectId, updated);
    return this.delay(this.present(updated));
  }

  async logEngagement(actions: EngagementAction[]) {
    this.history.push(...actions);
    return this.delay(undefined);
  }
}
