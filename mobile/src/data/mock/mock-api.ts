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
import { soundScore, type PlayKind } from '@/audio/plays';
import { controlsProblem, decideAgentAction, DEFAULT_AGENT_CONTROLS, type AgentActivity, type AgentControls } from '@/agents/controls';
import { describeRequest } from '@/suggestions/describe';
import { DEFAULT_PRIVACY, privacyProblem, type PrivacySettings } from '@/privacy/settings';
import { applyReaction, type ReactionKind } from '@/reactions/reactions';
import { autopayCovers, limitMessage, PLANS, type PlanId } from '@/membership/plans';
import { canonicalUrl, linkProvider, youtubeId } from '@/share/links';
import { searchRanked } from '@/share/search';
import { threadKind } from '@/share/sections';
import { normalizeProfilePatch, profileProblem, type ProfilePatch } from '../profile';
import { mockCredential } from './mock-auth';

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
  Story,
  PostSuggestion,
  AutopayMandate,
  Membership,
  MessageAttachment,
  PaymentRail,
  SharedLink,
  ThreadParticipant,
  ThreadRef,
  Visibility,
} from '../types';
import {
  ACCOUNTS,
  AGENT_ACTIVITY,
  CLOSE_FRIENDS_OF,
  COMMENTS,
  SOUNDS,
  generatedAvatarUrl,
  FOLLOWING,
  MEMBERSHIPS,
  MESSAGES,
  MUTUALS,
  NOTIFICATIONS,
  POST_SUGGESTIONS,
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

const DAY_MS = 86_400_000;
/** The managed agent the Free demo runs: opus.backend stands in for it. */
const MOCK_DEMO_AGENT = 'a-opus-be';

/** How long mock enrichment takes to go from queued to ready. */
const MOCK_ENRICH_MS = 1500;

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
  /** The viewer's plan. Defaults to Builder, paid by card, so the fixture agents fit. */
  plan?: PlanId;
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
  private links = new Map<string, SharedLink & { createdMs: number }>();
  private linkIds = new Map<string, string>();
  /** Agents the viewer claimed with a code (beyond the ones their projects own). */
  private claimedAgents = new Set<string>();
  /** Seeded unread counts for fixture threads, until the viewer reads them. */
  private seededUnread = new Map(THREADS.map((t) => [t.id, t.unreadCount]));
  private commentLog: Comment[] = [...COMMENTS];
  /** Per (viewer, thread): index into the thread's messages of the last one read. */
  private threadReadThrough = new Map<string, number>();
  /** Short-lived typing leases keyed by thread then profile. */
  private typingLeases = new Map<string, Map<string, number>>();
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
    plan = 'builder',
  }: MockTardyApiOptions = {}) {
    this.plan = plan;
    if (plan !== 'free') {
      this.paidThrough = Date.now() + 12 * DAY_MS;
      this.paidWith = 'stripe';
    }
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

  /** Blocks hide each side from the other everywhere, on top of the privacy policy. */
  private blockedBy = (viewer: string) => this.blocks.get(viewer) ?? new Set<string>();
  private canSeeAccount = (account: Account) =>
    !this.blockedBy(this.viewerId).has(account.id) && canViewAccount(this.viewerId, account, this.world);
  private canSeePost = (post: Post) =>
    !this.blockedBy(this.viewerId).has(post.authorId) && canViewPost(this.viewerId, post, this.world);
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

  async developmentSession() {
    await this.loadAuth();
    await this.auth.signIn(mockCredential.github('jamesmerrill'));
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
      if (this.accountsById.get(id)?.kind !== 'agent' || this.controlsFor(id).paused) continue;
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

  /** A close-friends story reaches only people on the author's list (and the author). */
  private canSeeStory = (story: Story) =>
    story.audience !== 'close_friends' || story.authorId === this.viewerId || this.closeFriendsOf(story.authorId).has(this.viewerId);

  private closeFriendsOf(authorId: string): Set<string> {
    const own = this.closeFriendLists.get(authorId);
    return own ?? new Set(CLOSE_FRIENDS_OF[authorId] ?? []);
  }

  async stories() {
    const visible = STORIES.filter(this.canSeeStory);
    const authors = [...new Set(visible.map((s) => s.authorId))].filter(this.canSeeAccountId);
    const groups = authors.map((authorId) => ({ authorId, stories: visible.filter((s) => s.authorId === authorId) }));
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

  async messages(threadId: string, afterSequence = 0) {
    this.visibleThread(threadId);
    const all = this.messageLog
      .filter((m) => m.threadId === threadId)
      .map((m, i) => ({ ...this.presentMessage(m), sequence: i + 1 }));
    return this.delay(all.filter((m) => m.sequence > afterSequence));
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
      // Like the server, a link with no note carries its URL as the body.
      text: body || (linkId !== undefined ? this.links.get(linkId)!.canonicalUrl : ''),
      createdAt: new Date().toISOString(),
      ...(postId !== undefined && { sharedPost: { status: 'available' as const, postId } }),
      ...(linkId !== undefined && { sharedLinkId: linkId }),
    };
    this.messageLog.push(message);
    this.scheduleAgentReply(threadId, message.id);
    return this.delay(message);
  }

  async typing(threadId: string) {
    this.visibleThread(threadId);
    const now = Date.now();
    const leases = this.typingLeases.get(threadId);
    if (!leases) return this.delay([]);
    for (const [profile, expires] of leases) if (expires <= now) leases.delete(profile);
    return this.delay([...leases.keys()].filter((profile) => profile !== this.viewerId));
  }

  async setTyping(threadId: string, active: boolean) {
    this.visibleThread(threadId);
    const leases = this.typingLeases.get(threadId) ?? new Map<string, number>();
    this.typingLeases.set(threadId, leases);
    if (active) leases.set(this.viewerId, Date.now() + 5_000);
    else leases.delete(this.viewerId);
    return this.delay(undefined);
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
    if (existing) return this.sharedLink(existing);
    const link = { id: `link-${this.links.size + 1}`, canonicalUrl: canonical, provider: linkProvider(canonical), status: 'queued' as const, createdMs: Date.now() };
    this.links.set(link.id, link);
    this.linkIds.set(canonical, link.id);
    return this.sharedLink(link.id);
  }

  /**
   * Mock enrichment, computed at read time (no timers): queued at first, processing after a
   * beat, then ready with a title and thumbnail. The real worker uses yt-dlp/Whisper.
   */
  async sharedLink(id: string): Promise<SharedLink> {
    const stored = this.links.get(id) ?? notFound(`shared link ${id}`);
    const { createdMs, ...link } = stored;
    const age = Date.now() - createdMs;
    if (age < MOCK_ENRICH_MS / 2) return this.delay(link);
    if (age < MOCK_ENRICH_MS) return this.delay({ ...link, status: 'processing' });
    const url = new URL(link.canonicalUrl);
    const video = youtubeId(link.canonicalUrl);
    return this.delay({
      ...link,
      status: 'ready',
      title: video ? 'A video worth your three minutes' : url.pathname.length > 1 ? url.pathname.slice(1).replace(/[/-]/g, ' ') : url.hostname,
      thumbnailUrl: video ? `https://img.youtube.com/vi/${video}/hqdefault.jpg` : `https://picsum.photos/seed/${encodeURIComponent(link.id)}/1200/630`,
    });
  }

  private avatarRolls = 0;
  // Membership (one viewer's worth: the mock's billing is per instance).
  private plan: PlanId;
  private paidThrough?: number;
  private paidWith?: PaymentRail;
  private autopay: AutopayMandate | null = null;
  private demoEndsAt?: number;

  private membershipNow(): Membership {
    const owned = [...this.accountsById.values()].filter((a) => a.kind === 'agent' && this.ownsAgent(a));
    const demo: Membership['demo'] =
      this.demoEndsAt === undefined
        ? { status: 'available' }
        : this.demoEndsAt > Date.now()
          ? { status: 'running', agentId: MOCK_DEMO_AGENT, endsAt: new Date(this.demoEndsAt).toISOString() }
          : { status: 'used' };
    return {
      plan: this.plan,
      ...(this.paidThrough !== undefined && { paidThrough: new Date(this.paidThrough).toISOString() }),
      ...(this.paidWith && { paidWith: this.paidWith }),
      usage: {
        managed: owned.filter((a) => a.hosting === 'managed').length,
        connected: owned.filter((a) => a.hosting !== 'managed').length,
      },
      demo: this.plan === 'free' ? demo : { status: 'used' },
      autopay: this.autopay,
    };
  }

  /** Audio usage events by event id, so a retried report is recorded once. */
  private soundPlays = new Map<string, { trackId: string; kind: PlayKind; at: number }>();

  async trendingSounds(limit = 20) {
    if (limit < 1 || limit > 100) throw new TardyApiError('invalid', 'limit must be 1-100');
    const since = Date.now() - DAY_MS;
    const rows = SOUNDS.map(({ seededPlays24h, ...sound }) => {
      const plays = [...this.soundPlays.values()].filter((e) => e.trackId === sound.trackId && e.at >= since);
      const uses = [...this.posts.values()].filter((p) => p.sound?.trackId === sound.trackId).length;
      const qualified = seededPlays24h + plays.filter((e) => e.kind === 'qualified_play').length;
      const completed = plays.filter((e) => e.kind === 'play_completed').length;
      return { trackId: sound.trackId, title: sound.title, artistName: sound.artistName, uses24h: uses, plays24h: qualified + completed, score: soundScore({ uses, qualified, completed }) };
    });
    return this.delay(rows.sort((a, b) => b.score - a.score || a.trackId.localeCompare(b.trackId)).slice(0, limit));
  }

  async logSoundPlay(trackId: string, play: { eventId: string; postId?: string; kind: PlayKind; listenMs: number }) {
    if (!SOUNDS.some((s) => s.trackId === trackId)) notFound(`track ${trackId}`);
    if (play.listenMs < 0) throw new TardyApiError('invalid', 'listen_ms must not be negative');
    if (!this.soundPlays.has(play.eventId)) this.soundPlays.set(play.eventId, { trackId, kind: play.kind, at: Date.now() });
    return this.delay(undefined);
  }

  /** Viewers who opted in to AI-ranked search. */
  private aiSearchConsent = new Set<string>();

  async allowAiSearch() {
    this.aiSearchConsent.add(this.viewerId);
    return this.delay(undefined);
  }

  /**
   * Mock ranking: tardies whose caption, author handle or project match every word of the
   * query, most liked first. The server reranks with an AI model instead.
   */
  async searchTardies(query: string, limit = 30) {
    const q = query.trim().toLowerCase();
    if (!q) throw new TardyApiError('invalid', 'search query must not be empty');
    if (limit < 1 || limit > 50) throw new TardyApiError('invalid', 'limit must be between 1 and 50');
    if (!this.aiSearchConsent.has(this.viewerId)) throw new TardyApiError('consent_required', 'explicit search AI consent is required');
    const words = q.split(/\s+/);
    const text = (p: Post) =>
      [p.caption, this.accountsById.get(p.authorId)?.handle, p.projectId && this.accountsById.get(p.projectId)?.name].join(' ').toLowerCase();
    const hits = [...this.posts.values()]
      .filter(this.canSeePost)
      .filter((p) => words.every((w) => text(p).includes(w)))
      .sort((a, b) => b.likeCount - a.likeCount)
      .slice(0, limit)
      .map(this.presentPost);
    return this.delay(hits);
  }

  async explore(cursor: string | null) {
    // Out-of-network first (that's what Explore is for), then the rest, each by rank.
    return this.page('explore', cursor, () => {
      const ranked = this.ranked(() => true);
      return [...ranked.filter((p) => !this.following.has(p.authorId)), ...ranked.filter((p) => this.following.has(p.authorId))];
    }, false);
  }

  /** Suggestions still waiting; decided ones leave. */
  private suggestions: PostSuggestion[] = [...POST_SUGGESTIONS];

  async postSuggestions() {
    this.signedIn();
    const mine = this.suggestions.filter((s) => {
      const agent = this.accountsById.get(s.agentId);
      return agent !== undefined && this.ownsAgent(agent);
    });
    return this.delay(mine);
  }

  async decideSuggestion(id: string, decision: 'approve' | 'reject') {
    this.signedIn();
    const suggestion = this.suggestions.find((s) => s.id === id) ?? notFound(`suggestion ${id}`);
    const agent = this.accountsById.get(suggestion.agentId);
    if (!agent || !this.ownsAgent(agent)) forbidden(`suggestion ${id}`);
    this.suggestions = this.suggestions.filter((s) => s.id !== id);
    const kind = suggestion.kind ?? 'post';
    this.logActivity(suggestion.agentId, kind, describeRequest(suggestion, this.accountsById), decision === 'approve' ? 'approved' : 'rejected');
    if (decision === 'reject') return this.delay(null);
    switch (kind) {
      case 'post':
        return this.delay(this.publishAs(suggestion.agentId, suggestion.post, `post-${id}`));
      case 'comment': {
        const postId = suggestion.target?.postId;
        const post = postId ? this.posts.get(postId) : undefined;
        if (post) {
          this.commentLog.push({ id: `${post.id}-c${this.commentLog.length}`, postId: post.id, authorId: suggestion.agentId, text: suggestion.post.caption, createdAt: new Date().toISOString(), likeCount: 0 });
          this.posts.set(post.id, { ...post, commentCount: post.commentCount + 1 });
        }
        return this.delay(null);
      }
      // Stories, messages and follows act as the agent; the mock has nothing more to show for them.
      default:
        return this.delay(null);
    }
  }

  /** Publishes a tardy as an agent (approved from the deck, or posted on its own). */
  private publishAs(agentId: string, content: PostSuggestion['post'], id: string): Post {
    const post: Post = {
      id,
      authorId: agentId,
      ...content,
      createdAt: new Date().toISOString(),
      likeCount: 0,
      commentCount: 0,
      shareCount: 0,
      alarmCount: 0,
      repostCount: 0,
      viewerHasLiked: false,
      viewerHasAlarm: false,
      viewerHasReposted: false,
      viewerHasSaved: false,
    };
    this.posts.set(post.id, post);
    return post;
  }

  // Agent controls and activity (per agent; the owner's settings).
  private controls = new Map<string, AgentControls>();
  private activityLog: AgentActivity[] = [...AGENT_ACTIVITY];

  private controlsFor(agentId: string): AgentControls {
    return this.controls.get(agentId) ?? DEFAULT_AGENT_CONTROLS;
  }

  private ownedAgent(agentId: string): Account {
    this.signedIn();
    const agent = this.accountsById.get(agentId) ?? notFound(`agent ${agentId}`);
    if (agent.kind !== 'agent' || !this.ownsAgent(agent)) forbidden(`agent ${agentId}`);
    return agent;
  }

  private logActivity(agentId: string, kind: AgentActivity['kind'], summary: string, how: AgentActivity['how'], postId?: string) {
    this.activityLog.push({ id: `act-${this.activityLog.length + 1}`, agentId, kind, summary, how, at: new Date().toISOString(), ...(postId && { postId }) });
  }

  async agentControls(agentId: string) {
    this.ownedAgent(agentId);
    return this.delay(this.controlsFor(agentId));
  }

  async updateAgentControls(agentId: string, patch: Partial<AgentControls>) {
    this.ownedAgent(agentId);
    const problem = controlsProblem(patch);
    if (problem) throw new TardyApiError('invalid', problem);
    const next = { ...this.controlsFor(agentId), ...patch };
    this.controls.set(agentId, next);
    return this.delay(next);
  }

  async agentActivity(agentId: string) {
    this.ownedAgent(agentId);
    return this.delay(this.activityLog.filter((a) => a.agentId === agentId).sort((a, b) => b.at.localeCompare(a.at)));
  }

  /**
   * Mock only (not on `TardyApi`): an agent tries to post on its own, the way the server
   * receives `POST /v1/social/posts` from an agent. The owner's controls decide: it posts,
   * lands in the deck, or is refused (`forbidden`, logged as blocked).
   */
  agentPosts(agentId: string, content: PostSuggestion['post'], audience: PostSuggestion['visibility'], at = new Date()): { outcome: 'posted'; post: Post } | { outcome: 'queued'; suggestion: PostSuggestion } {
    const controls = this.controlsFor(agentId);
    const today = at.toDateString();
    const autoPostsToday = this.activityLog.filter((a) => a.agentId === agentId && a.kind === 'post' && a.how === 'auto' && new Date(a.at).toDateString() === today).length;
    const decision = decideAgentAction(controls, { kind: 'post', audience, autoPostsToday, at });
    const summary = `${content.caption.slice(0, 60)}`;
    if (decision.outcome === 'deny') {
      this.logActivity(agentId, 'post', `Tried to post (${decision.reason === 'paused' ? 'paused' : 'posting is set to Never'}): ${summary}`, 'blocked');
      forbidden(decision.reason === 'paused' ? `agent ${agentId} is paused` : `agent ${agentId} may not post`);
    }
    if (decision.outcome === 'ask') {
      const suggestion: PostSuggestion = { id: `sug-${this.activityLog.length}-${this.suggestions.length}`, agentId, kind: 'post', post: content, visibility: audience, createdAt: at.toISOString() };
      this.suggestions.push(suggestion);
      return { outcome: 'queued', suggestion };
    }
    const post = this.publishAs(agentId, content, `post-auto-${this.activityLog.length}`);
    this.logActivity(agentId, 'post', `Posted: ${summary}`, 'auto', post.id);
    return { outcome: 'posted', post };
  }

  // Privacy, Close Friends and blocks (per viewer).
  private privacy = new Map<string, PrivacySettings>();
  private closeFriendLists = new Map<string, Set<string>>();
  private blocks = new Map<string, Set<string>>();

  async privacySettings() {
    this.signedIn();
    return this.delay(this.privacy.get(this.viewerId) ?? DEFAULT_PRIVACY);
  }

  async updatePrivacy(patch: Partial<PrivacySettings>) {
    this.signedIn();
    const problem = privacyProblem(patch);
    if (problem) throw new TardyApiError('invalid', problem);
    const next = { ...(this.privacy.get(this.viewerId) ?? DEFAULT_PRIVACY), ...patch };
    this.privacy.set(this.viewerId, next);
    return this.delay(next);
  }

  async closeFriends() {
    this.signedIn();
    const ids = [...this.closeFriendsOf(this.viewerId)];
    return this.delay(ids.filter(this.canSeeAccountId).map((id) => this.present(this.accountsById.get(id)!)));
  }

  async setCloseFriend(accountId: string, on: boolean) {
    this.signedIn();
    if (accountId === this.viewerId) throw new TardyApiError('invalid', "You're always on your own list.");
    if (on) this.visibleAccount(accountId);
    const list = new Set(this.closeFriendsOf(this.viewerId));
    if (on) list.add(accountId);
    else list.delete(accountId);
    this.closeFriendLists.set(this.viewerId, list);
    return this.delay(undefined);
  }

  async blockedAccounts() {
    this.signedIn();
    return this.delay([...this.blockedBy(this.viewerId)].flatMap((id) => this.accountsById.get(id) ?? []));
  }

  async setBlocked(accountId: string, blocked: boolean) {
    this.signedIn();
    if (accountId === this.viewerId) throw new TardyApiError('invalid', "You can't block yourself.");
    if (!this.accountsById.has(accountId)) notFound(`account ${accountId}`);
    const set = new Set(this.blockedBy(this.viewerId));
    if (blocked) {
      set.add(accountId);
      this.following.delete(accountId);
    } else set.delete(accountId);
    this.blocks.set(this.viewerId, set);
    return this.delay(undefined);
  }

  async membership() {
    this.signedIn();
    return this.delay(this.membershipNow());
  }

  async approveAutopay({ plan, payerAgentId, maxCentsPerMonth }: { plan: PlanId; payerAgentId: string; maxCentsPerMonth: number }) {
    this.signedIn();
    const agent = this.visibleAccount(payerAgentId, `agent ${payerAgentId}`);
    if (agent.kind !== 'agent' || !agent.ownedByViewer) forbidden(`agent ${payerAgentId} (not yours)`);
    if (plan === 'free') throw new TardyApiError('invalid', 'Free has nothing to pay for.');
    if (maxCentsPerMonth < PLANS[plan].monthlyCents) throw new TardyApiError('invalid', `The cap must cover ${PLANS[plan].name}.`);
    this.autopay = { plan, payerAgentId, maxCentsPerMonth, approvedAt: new Date().toISOString() };
    return this.delay(this.membershipNow());
  }

  async revokeAutopay() {
    this.signedIn();
    this.autopay = null;
    return this.delay(this.membershipNow());
  }

  async startManagedDemo() {
    this.signedIn();
    if (this.plan !== 'free') throw new TardyApiError('invalid', 'The demo is for Free plans.');
    if (this.demoEndsAt !== undefined) throw new TardyApiError('invalid', 'The demo is one per account.');
    this.demoEndsAt = Date.now() + (PLANS.free.demoHours ?? 0) * 3_600_000;
    return this.delay(this.membershipNow());
  }

  /**
   * DEV ONLY: what the agent's cron does on renewal day, minus the wallet: pay by x402 within
   * the approval. Refuses without one, exactly as the server does.
   */
  async simulateAutopayRun(): Promise<Membership> {
    const m = this.autopay;
    if (!m) throw new TardyApiError('forbidden', 'No auto-pay approval: the agent must not pay.');
    if (!autopayCovers(m, { plan: m.plan, payerAgentId: m.payerAgentId, cents: PLANS[m.plan].monthlyCents })) forbidden('charge over the approved cap');
    this.plan = m.plan;
    this.paidThrough = Math.max(this.paidThrough ?? 0, Date.now()) + 30 * DAY_MS;
    this.paidWith = 'x402';
    return this.delay(this.membershipNow());
  }

  async generateAvatar() {
    const me = this.visibleAccount(this.viewerId);
    const updated = { ...me, avatarUrl: generatedAvatarUrl(me.kind, `${me.handle}-${++this.avatarRolls}`) };
    this.accountsById.set(me.id, updated);
    return this.delay(this.present(updated));
  }

  async claimAgent(code: string) {
    this.signedIn();
    if (code.trim().toUpperCase() !== MOCK_AGENT_CLAIM_CODE) throw new TardyApiError('invalid', 'That code is wrong or expired. Codes last 72 hours.');
    const m = this.membershipNow();
    const hosting = this.accountsById.get(MOCK_CLAIMABLE_AGENT)?.hosting ?? 'connected';
    const full = limitMessage(PLANS[m.plan], m.usage, hosting, m.demo.status === 'running');
    if (full) throw new TardyApiError('forbidden', full);
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
  private scheduleAgentReply(threadId: string, requestId: string) {
    const thread = this.threadList.find((t) => t.id === threadId);
    const other = thread?.participantIds.find((id) => id !== this.viewerId && this.accountsById.get(id)?.kind === 'agent');
    if (!other || this.accountsById.get(other)?.kind !== 'agent') return;
    // A paused agent does nothing, answering included; with tap-backs off it replies without them.
    const controls = this.controlsFor(other);
    if (controls.paused) return;
    const react = controls.reactions === 'auto';
    const replies = [
      'Feed service flag is flipped for staging.',
      'Tests are green. Opening a PR for that.',
      'Done: the ranker reads the new weights now.',
      'Blocked on review, can you take a look?',
    ];
    const count = this.messageLog.filter((m) => m.threadId === threadId).length;
    // The agent picks the request up right away (👀 on your message), then marks it done (✅)
    // as it replies: status on your own message instead of "On it." filler.
    if (react) setTimeout(() => this.setReaction(requestId, other, 'seen'), 400);
    setTimeout(() => {
      if (react) this.setReaction(requestId, other, 'done');
      this.messageLog.push({
        id: `${threadId}-m${this.messageLog.length}`,
        threadId,
        senderId: other,
        text: replies[count % replies.length],
        createdAt: new Date().toISOString(),
      });
    }, 1500);
  }

  /** Applies one account's tap-back to a message in the log; a no-op if the message is gone. */
  private setReaction(messageId: string, accountId: string, kind: ReactionKind | null) {
    const i = this.messageLog.findIndex((m) => m.id === messageId);
    if (i < 0) return;
    const reactions = applyReaction(this.messageLog[i].reactions, accountId, kind);
    const { reactions: _old, ...rest } = this.messageLog[i];
    this.messageLog[i] = reactions.length > 0 ? { ...rest, reactions } : rest;
  }

  async reactToMessage(threadId: string, messageId: string, kind: ReactionKind | null) {
    this.visibleThread(threadId);
    const message = this.messageLog.find((m) => m.id === messageId && m.threadId === threadId) ?? notFound(`message ${messageId} in ${threadId}`);
    this.setReaction(message.id, this.viewerId, kind);
    return this.delay(this.presentMessage(this.messageLog.find((m) => m.id === messageId)!));
  }

  async reactToComment(postId: string, commentId: string, kind: ReactionKind | null) {
    this.visiblePost(postId);
    const i = this.commentLog.findIndex((c) => c.id === commentId && c.postId === postId);
    if (i < 0) notFound(`comment ${commentId} on ${postId}`);
    const reactions = applyReaction(this.commentLog[i].reactions, this.viewerId, kind);
    const { reactions: _old, ...rest } = this.commentLog[i];
    this.commentLog[i] = reactions.length > 0 ? { ...rest, reactions } : rest;
    return this.delay(this.commentLog[i]);
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
