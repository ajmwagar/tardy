import { canSetVisibility, canViewAccount, canViewPost, policyWorld, type PolicyWorld } from '@/privacy/policy';
import { rankForYou, trendingPosts, type Viewer } from '@/ranking/for-you';
import { orderStoryTray } from '@/stories/boost';
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
import { canonicalUrl, linkProvider } from '@/share/links';
import { searchRanked } from '@/share/search';
import { threadKind } from '@/share/sections';
import { normalizeProfilePatch, profileProblem, type ProfilePatch } from '../profile';

import { SEARCH_LIMIT, TardyApiError, type TardyApi } from '../api';
import type {
  Account,
  AuthCredential,
  Comment,
  EngagementAction,
  Message,
  NotificationKind,
  NotificationPreferences,
  Page,
  Post,
  ProjectMembership,
  PushTokenRegistration,
  SignedIn,
  MessageAttachment,
  SharedLink,
  ThreadParticipant,
  ThreadRef,
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

/** The one-time code a self-registered agent shows its human, in the mock. */
export const MOCK_AGENT_CLAIM_CODE = 'TARDY-7Q4K';
/** The agent that code claims: opus.firmware, which `me` does not own until then. */
const MOCK_CLAIMABLE_AGENT = 'a-fw';

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
  /** Every thread, fixture and opened; `threads()` lists only those with messages. */
  private threadList: ThreadRef[] = THREADS.map(({ id, participantIds, title }) => ({
    id,
    participantIds,
    ...(title !== undefined && { title }),
    kind: this.kindOf(participantIds),
  }));
  /** Shared links by id; `linkIds` dedupes by canonical URL, as the server does. */
  private links = new Map<string, SharedLink>();
  private linkIds = new Map<string, string>();
  /** Agents the viewer claimed with a code (beyond the ones their projects own). */
  private claimedAgents = new Set<string>();
  /** Seeded unread counts for fixture threads, until the viewer reads them. */
  private seededUnread = new Map(THREADS.map((t) => [t.id, t.unreadCount]));
  private commentLog: Comment[] = [...COMMENTS];
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
    if (account.kind === 'agent') return this.ownsAgent(account) ? { ...account, ownedByViewer: true } : account;
    if (account.kind !== 'project') return account;
    const viewerRole = this.world.role(this.viewerId, account.id);
    return viewerRole ? { ...account, viewerRole } : account;
  }

  /**
   * Mock ownership: the viewer owns an agent they claimed, or one reporting to a project they
   * own. (The server's rule is simpler: the agent's profile belongs to the viewer's account.)
   */
  private ownsAgent(agent: Account) {
    if (this.claimedAgents.has(agent.id)) return true;
    return agent.id !== MOCK_CLAIMABLE_AGENT && !!agent.projectId && this.world.role(this.viewerId, agent.projectId) === 'owner';
  }

  private visibleAccount(id: string, label = `account ${id}`): Account {
    const account = this.accountsById.get(id) ?? notFound(label);
    if (!this.canSeeAccount(account)) forbidden(label);
    return this.present(account);
  }

  /** Drops collaborators the viewer cannot see, as the server does per request. */
  private presentPost = (post: Post): Post => {
    const { collaboratorIds: all, ...solo } = post;
    if (!all) return post;
    const visible = all.filter(this.canSeeAccountId);
    return visible.length > 0 ? { ...solo, collaboratorIds: visible } : solo;
  };

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
    const current = items
      .map((p) => this.posts.get(p.id) ?? notFound(`post ${p.id}`))
      .filter(this.canSeePost)
      .map(this.presentPost);
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
    return this.threadList.filter((t) => t.participantIds.includes(this.viewerId) && t.participantIds.every(this.canSeeAccountId));
  }

  private visibleThread(threadId: string) {
    if (!this.threadList.some((t) => t.id === threadId)) notFound(`thread ${threadId}`);
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

  async updateProfile(patch: ProfilePatch) {
    const me = this.visibleAccount(this.viewerId);
    const clean = normalizeProfilePatch(patch);
    const problem = profileProblem(clean);
    if (problem) throw new TardyApiError('invalid', problem);
    const updated = { ...this.accountsById.get(me.id)!, ...clean };
    this.accountsById.set(me.id, updated);
    return this.delay(this.present(updated));
  }

  async requestEmailCode(email: string) {
    this.auth.requestEmailCode(email);
    return this.delay(undefined);
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
    return this.delay(trendingPosts([...this.posts.values()].filter(this.canSeePost)).slice(0, 5).map(this.presentPost));
  }

  async accountPosts(accountId: string, cursor: string | null) {
    this.visibleAccount(accountId);
    // A project profile shows its own posts plus everything its agents posted about it; a
    // collaborator's profile shows the collab tardies they are credited on.
    const mine = (p: Post) =>
      (p.authorId === accountId || p.projectId === accountId || !!p.collaboratorIds?.includes(accountId)) && this.canSeePost(p);
    const newest = () =>
      [...this.posts.values()].filter(mine).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return this.page(`acct-${accountId}-`, cursor, newest, false);
  }

  async post(id: string) {
    return this.delay(this.presentPost(this.visiblePost(id)));
  }

  async comments(postId: string) {
    this.visiblePost(postId);
    return this.delay(this.commentLog.filter((c) => c.postId === postId && this.canSeeAccountId(c.authorId)));
  }

  async addComment(postId: string, text: string, mentionedIds: readonly string[] = []) {
    const post = this.visiblePost(postId);
    const body = text.trim();
    if (body.length === 0 || body.length > 500) throw new TardyApiError('invalid', 'Comments are 1 to 500 characters.');
    const mentions = [...new Set(mentionedIds)];
    for (const id of mentions) this.visibleAccount(id, `mentioned account ${id}`);
    const comment: Comment = {
      id: `${postId}-c${this.commentLog.length}`,
      postId,
      authorId: this.viewerId,
      text: body,
      createdAt: new Date().toISOString(),
      likeCount: 0,
      ...(mentions.length > 0 && { mentionedIds: mentions }),
    };
    this.commentLog.push(comment);
    this.posts.set(postId, { ...post, commentCount: post.commentCount + 1 });
    this.scheduleAgentCommentReplies(postId, mentions);
    return this.delay(comment);
  }

  /**
   * Mock only: a mentioned agent answers in the comments a moment later, the way a real
   * agent answers its bounded `agent_reply_requested` event.
   */
  private scheduleAgentCommentReplies(postId: string, mentionedIds: readonly string[]) {
    for (const id of mentionedIds) {
      if (this.accountsById.get(id)?.kind !== 'agent') continue;
      setTimeout(() => {
        const post = this.posts.get(postId);
        if (!post) return;
        this.commentLog.push({
          id: `${postId}-c${this.commentLog.length}`,
          postId,
          authorId: id,
          text: 'On it. I will reply here when it is done.',
          createdAt: new Date().toISOString(),
          likeCount: 0,
        });
        this.posts.set(postId, { ...post, commentCount: post.commentCount + 1 });
      }, 1500);
    }
  }

  async stories() {
    const authors = [...new Set(STORIES.map((s) => s.authorId))].filter(this.canSeeAccountId);
    const groups = authors.map((authorId) => ({ authorId, stories: STORIES.filter((s) => s.authorId === authorId) }));
    return this.delay(orderStoryTray(groups, Date.now()));
  }

  /** Unread = messages from others after the viewer's watermark; fixtures seed the watermark. */
  private unreadIn(thread: ThreadRef, messages: Message[]) {
    const key = `${this.viewerId}:${thread.id}`;
    const through = this.threadReadThrough.get(key) ?? messages.length - 1 - (this.seededUnread.get(thread.id) ?? 0);
    return messages.slice(through + 1).filter((m) => m.senderId !== this.viewerId).length;
  }

  async threads() {
    const threads = this.visibleThreads().flatMap((t) => {
      const messages = this.messageLog.filter((m) => m.threadId === t.id);
      if (messages.length === 0) return [];
      return [{ ...t, lastMessage: this.presentMessage(messages[messages.length - 1]), unreadCount: this.unreadIn(t, messages) }];
    });
    return this.delay(threads.sort((a, b) => Date.parse(b.lastMessage.createdAt) - Date.parse(a.lastMessage.createdAt)));
  }

  async thread(threadId: string) {
    this.visibleThread(threadId);
    return this.delay(this.threadList.find((t) => t.id === threadId)!);
  }

  async messages(threadId: string) {
    this.visibleThread(threadId);
    return this.delay(this.messageLog.filter((m) => m.threadId === threadId).map(this.presentMessage));
  }

  async sendMessage(threadId: string, text: string, attachment?: MessageAttachment) {
    this.visibleThread(threadId);
    const body = text.trim();
    if (!body && !attachment) throw new TardyApiError('invalid', 'A message needs text or something attached.');
    const postId = attachment && 'sharedPostId' in attachment ? attachment.sharedPostId : undefined;
    const linkId = attachment && 'sharedLinkId' in attachment ? attachment.sharedLinkId : undefined;
    if (postId !== undefined) this.visiblePost(postId);
    if (linkId !== undefined && !this.links.has(linkId)) notFound(`shared link ${linkId}`);
    const message: Message = {
      id: `${threadId}-m${this.messageLog.length}`,
      threadId,
      senderId: this.viewerId,
      text: body,
      createdAt: new Date().toISOString(),
      ...(postId !== undefined && { sharedPost: { status: 'available' as const, postId } }),
      ...(linkId !== undefined && { sharedLinkId: linkId }),
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

  private kindOf(participantIds: readonly string[]) {
    return threadKind(participantIds.flatMap((id) => this.accountsById.get(id) ?? []));
  }

  async openThread(participants: readonly ThreadParticipant[], title?: string): Promise<ThreadRef> {
    const members = [...new Set([this.viewerId, ...participants.map((p) => p.id)])];
    if (members.length < 2) throw new TardyApiError('invalid', 'A thread needs someone besides you.');
    for (const id of members) this.visibleAccount(id, `participant ${id}`);
    const key = (ids: readonly string[]) => [...ids].sort().join(',');
    const existing = this.threadList.find((t) => key(t.participantIds) === key(members));
    if (existing) return this.delay(existing);
    const name = title?.trim();
    const thread: ThreadRef = {
      id: `t-new-${this.threadList.length}`,
      participantIds: members,
      ...(members.length > 2 && name ? { title: name } : {}),
      kind: this.kindOf(members),
    };
    this.threadList.push(thread);
    return this.delay(thread);
  }

  async addAgent(threadId: string, agentId: string, includeAnchorShare = true): Promise<ThreadRef> {
    void includeAnchorShare; // The mock's agents read everything; the server bounds context by this.
    this.visibleThread(threadId);
    const agent = this.visibleAccount(agentId, `agent ${agentId}`);
    if (agent.kind !== 'agent') throw new TardyApiError('invalid', `${agent.handle} is not an agent.`);
    if (!agent.ownedByViewer) forbidden(`agent ${agentId} (not yours)`);
    const index = this.threadList.findIndex((t) => t.id === threadId);
    const thread = this.threadList[index];
    const participantIds = thread.participantIds.includes(agentId) ? thread.participantIds : [...thread.participantIds, agentId];
    const promoted: ThreadRef = { ...thread, participantIds, kind: 'work' };
    this.threadList[index] = promoted;
    return this.delay(promoted);
  }

  async createSharedLink(url: string): Promise<SharedLink> {
    let canonical: string;
    try {
      canonical = canonicalUrl(url);
    } catch (e) {
      throw new TardyApiError('invalid', e instanceof Error ? e.message : String(e));
    }
    const existing = this.linkIds.get(canonical);
    if (existing) return this.delay(this.links.get(existing)!);
    const link: SharedLink = { id: `link-${this.links.size + 1}`, canonicalUrl: canonical, provider: linkProvider(canonical), status: 'queued' };
    this.links.set(link.id, link);
    this.linkIds.set(canonical, link.id);
    return this.delay(link);
  }

  async claimAgent(code: string) {
    this.signedIn();
    if (code.trim().toUpperCase() !== MOCK_AGENT_CLAIM_CODE) throw new TardyApiError('invalid', 'That code is wrong or expired. Codes last 72 hours.');
    this.claimedAgents.add(MOCK_CLAIMABLE_AGENT);
    return this.delay(undefined);
  }

  async searchAccounts(query: string): Promise<Account[]> {
    const recent = this.visibleThreads()
      .map((t) => ({ t, last: this.messageLog.findLast((m) => m.threadId === t.id) }))
      .filter((x) => x.last !== undefined)
      .sort((a, b) => Date.parse(b.last!.createdAt) - Date.parse(a.last!.createdAt))
      .flatMap((x) => x.t.participantIds);
    const order = [...new Set([...recent, ...this.following, ...this.accountsById.keys()])];
    const candidates = order
      .filter((id) => id !== this.viewerId && this.canSeeAccountId(id))
      .map((id) => this.present(this.accountsById.get(id)!))
      // With no query, suggest only people the viewer already knows, not the whole directory.
      .filter((a) => query.trim() || recent.includes(a.id) || this.following.has(a.id));
    return this.delay(searchRanked(candidates, query).slice(0, SEARCH_LIMIT));
  }

  /**
   * Mock only: agents answer DMs a moment later with a status-flavored reply, so the thread
   * screen's polling has something to pick up. The real server relays the agent's own message.
   */
  private scheduleAgentReply(threadId: string) {
    const thread = this.threadList.find((t) => t.id === threadId);
    const other = thread?.participantIds.find((id) => id !== this.viewerId && this.accountsById.get(id)?.kind === 'agent');
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

  async setReposted(postId: string, reposted: boolean) {
    const post = this.visiblePost(postId);
    if (post.viewerHasReposted !== reposted) {
      this.posts.set(postId, { ...post, viewerHasReposted: reposted, repostCount: post.repostCount + (reposted ? 1 : -1) });
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
