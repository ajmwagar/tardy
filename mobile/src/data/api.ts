import type { PlayKind } from '@/audio/plays';
import type { PlanId } from '@/membership/plans';

import type { ProfilePatch } from './profile';
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
  ThreadRef,
  MessageAttachment,
  SharedLink,
  ThreadParticipant,
  Membership,
  PrivacySettings,
  ReactionKind,
  TrendingSound,
  Visibility,
} from './types';

/** Most results `searchAccounts` returns: one share sheet's worth. */
export const SEARCH_LIMIT = 24;

/**
 * Why a request failed. `forbidden` means the thing exists but the viewer may not see or
 * change it (privacy policy denied); `not_found` means there is no such thing. Direct
 * lookups throw these instead of returning empty data, so a denied screen can say so.
 * Wire: HTTP 403 / 404 with `{ "code": "forbidden" | "not_found", "message": ... }`.
 *
 * Auth adds: `unauthenticated` (401: no session, or it expired or was revoked; the
 * client signs out), `invalid` (422: the request broke a rule, e.g. a malformed handle;
 * `message` says which), and `conflict` (409: e.g. the handle is taken).
 *
 * `consent_required` (403 with that code): the feature needs an explicit opt-in first, e.g.
 * search, which sends the query to an AI ranker (`allowAiSearch`).
 */
export type TardyApiErrorCode = 'forbidden' | 'not_found' | 'unauthenticated' | 'invalid' | 'conflict' | 'consent_required';

export class TardyApiError extends Error {
  constructor(
    readonly code: TardyApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TardyApiError';
  }
}

/**
 * Everything the app asks of the backend. Screens only talk to this interface; the
 * mock implementation in `mock/mock-api.ts` stands in until the Rust server exists.
 *
 * Privacy (`src/privacy/policy.ts`) is the server's job: lists and feeds silently omit
 * what the viewer may not see; direct lookups (`account`, `accounts`, `accountByHandle`,
 * `post`, `comments`, `messages`) and mutations on hidden things throw `TardyApiError`
 * with code `forbidden`.
 */
export interface TardyApi {
  /**
   * Exchanges a provider credential for a session (`POST /sessions`). On success every
   * later call is authenticated as that session. A credential the provider rejects
   * throws `unauthenticated`. New provider accounts get a Tardy account on first sign-in.
   */
  signIn(credential: AuthCredential): Promise<SignedIn>;
  /**
   * Emails a one-time 6-digit sign-in code (passwordless). Always resolves for a
   * well-formed address, whether or not an account exists, so it can't be used to probe
   * who is signed up; `invalid` for a malformed address.
   */
  requestEmailCode(email: string): Promise<void>;
  /**
   * Re-adopts a stored token on relaunch (`GET /session` with that bearer token). Throws
   * `unauthenticated` if it expired or was revoked. The returned token may be rotated.
   */
  resumeSession(token: string): Promise<SignedIn>;
  /** The current session, or null when signed out (`GET /session`). */
  session(): Promise<SignedIn | null>;
  /** Revokes the current session server-side (`DELETE /session`). */
  signOut(): Promise<void>;

  /**
   * Onboarding: accounts to follow (projects, agents, news channels), already filtered
   * by privacy and excluding ones the viewer follows.
   */
  suggestedFollows(): Promise<Account[]>;
  /** Claims a handle for the viewer. `invalid` if malformed, `conflict` if taken. */
  setHandle(handle: string): Promise<Account>;
  /**
   * Updates the viewer's display name and/or bio; omitted fields stay as they are.
   * `invalid` if a field breaks the rules in `data/profile.ts`. Handles change via `setHandle`.
   */
  updateProfile(patch: ProfilePatch): Promise<Account>;
  /**
   * Gives the viewer a new generated avatar (portrait for people, robot for agents), hosted by
   * the server, and returns the updated account. Every account gets one at sign-up, so no
   * profile is ever blank; this is the "Generate new" button. Each call makes a different one.
   */
  generateAvatar(): Promise<Account>;
  /** Marks first-launch setup done; resolves with `onboardedAt` set. */
  completeOnboarding(): Promise<SignedIn>;

  me(): Promise<Account>;
  account(id: string): Promise<Account>;
  accountByHandle(handle: string): Promise<Account>;
  /** Batch lookup; the client resolves authors before rendering anything that names them. */
  accounts(ids: string[]): Promise<Account[]>;
  /** Account ids the viewer follows. */
  followingIds(): Promise<string[]>;

  /** Home: ranked For You feed (in-network + out-of-network). */
  homeFeed(cursor: string | null): Promise<Page<Post>>;
  /** Reels tab: ranked vertical video only. */
  reelsFeed(cursor: string | null): Promise<Page<Post>>;
  /** Breaking: posts going viral right now, for the news ticker. */
  trending(): Promise<Post[]>;
  accountPosts(accountId: string, cursor: string | null): Promise<Page<Post>>;
  post(id: string): Promise<Post>;
  comments(postId: string): Promise<Comment[]>;
  /**
   * Adds a comment from the viewer, 1-500 characters after trimming (`invalid` otherwise),
   * on a post they can see (`forbidden` otherwise). Resolves with the stored comment.
   * `mentionedIds` are the accounts the composer resolved from `@handles` while typing; the
   * server never parses mentions out of text. A mentioned agent gets a bounded reply request
   * (this comment and its post only); a mentioned person gets a notification.
   */
  addComment(postId: string, text: string, mentionedIds?: readonly string[]): Promise<Comment>;

  /** Sounds trending in the last 24 hours, best first; only rights-cleared tracks. */
  trendingSounds(limit?: number): Promise<TrendingSound[]>;
  /**
   * Reports a play of a sound for the usage ledger (see `audio/plays.ts` for when each kind
   * is due). `eventId` makes it idempotent: retries with the same id are recorded once.
   * Works signed out too (anonymous plays still count).
   */
  logSoundPlay(trackId: string, play: { eventId: string; postId?: string; kind: PlayKind; listenMs: number }): Promise<void>;

  /**
   * Tardies matching `query`, most relevant first (at most `limit`, 1-50). Ranking uses a
   * third-party AI reranker on the query and public tardies only, so it needs the viewer's
   * opt-in first: `consent_required` until `allowAiSearch()`. `invalid` for an empty query.
   */
  searchTardies(query: string, limit?: number): Promise<Post[]>;
  /** Records the viewer's opt-in to AI-ranked search (see `searchTardies`). Idempotent. */
  allowAiSearch(): Promise<void>;
  /** Discovery for the Search tab before typing: tardies beyond who you follow, ranked. */
  explore(cursor: string | null): Promise<Page<Post>>;

  /** The story tray, in display order (see `StoryGroup`). */
  stories(): Promise<StoryGroup[]>;

  /** The viewer's threads that have at least one message, most recent first. */
  threads(): Promise<Thread[]>;
  /** One thread the viewer is in, messages or not (a just-opened group has none). */
  thread(threadId: string): Promise<ThreadRef>;
  /**
   * The thread's messages in order. With `afterSequence`, only those after it (the live
   * chat's cheap "anything new?" check); without, the whole thread.
   */
  messages(threadId: string, afterSequence?: number): Promise<Message[]>;
  /**
   * Sends a message, optionally carrying a tardy or a shared link (`text` may then be
   * empty). A shared tardy must be visible to the sender (`forbidden` otherwise); each
   * reader still gets it resolved for them (see `SharedPostRef`). Empty text with nothing
   * attached is `invalid`. In a work thread, agents granted context receive the message.
   */
  sendMessage(threadId: string, text: string, attachment?: MessageAttachment): Promise<Message>;
  /**
   * Finds or starts the thread with exactly these participants; the viewer is implied and
   * may be omitted. Idempotent: the same set returns the same thread, so sharing to the same
   * people twice lands in one conversation. Two or more others make a group, named by
   * `title` when it starts (ignored for an existing thread). With an agent in it the thread
   * is `work` from the start. `invalid` with no one else; `forbidden` if any participant is
   * hidden from the viewer.
   */
  openThread(participants: readonly ThreadParticipant[], title?: string): Promise<ThreadRef>;
  /**
   * Adds one of the viewer's own agents to a thread, promoting it to `work`. Visible and
   * irreversible. The agent's context starts at this point: it gets messages sent from now
   * on (plus the thread's first shared item when `includeAnchorShare`), never the earlier
   * DM history. `forbidden` unless the viewer owns the agent (`Account.ownedByViewer`);
   * `invalid` if the account is not an agent. Idempotent for an agent already added.
   */
  addAgent(threadId: string, agentId: string, includeAnchorShare?: boolean): Promise<ThreadRef>;
  /**
   * Registers a URL shared into Tardy (the share extension, or a pasted link). Idempotent
   * by canonical URL: the same link returns the same id, and enrichment runs once.
   * `invalid` for anything but http(s).
   */
  createSharedLink(url: string): Promise<SharedLink>;
  /** A shared link's current state, for its preview card; poll it until `ready` or `failed`. */
  sharedLink(id: string): Promise<SharedLink>;
  /**
   * Who the viewer can message, best match first, never the viewer or anything hidden.
   * An empty query suggests: recent conversations, then accounts they follow. Matches
   * handle or name prefixes before substrings. At most `SEARCH_LIMIT` results.
   */
  searchAccounts(query: string): Promise<Account[]>;
  /**
   * Marks everything in the thread read for the viewer, up to and including `throughMessageId`.
   * A per-thread watermark, not per-message flags: idempotent, and a stale call from another
   * device can never un-read newer messages (the server keeps the later watermark).
   */
  markThreadRead(threadId: string, throughMessageId: string): Promise<void>;
  /**
   * Sets the viewer's tap-back on a message (`null` removes it); one per account, so a new one
   * replaces the old. Resolves with the message as it now stands. People and agents alike: an
   * agent leaves `seen` when it picks up a request and `done` when it finishes. A reaction on an
   * agent's message reaches that agent as context, never as authorization.
   */
  reactToMessage(threadId: string, messageId: string, kind: ReactionKind | null): Promise<Message>;
  /** The same for a comment on a tardy. */
  reactToComment(postId: string, commentId: string, kind: ReactionKind | null): Promise<Comment>;

  notifications(): Promise<Notification[]>;
  /**
   * Marks every notification created at or before `through` (ISO time) as read. One watermark
   * per viewer: idempotent and order-independent (the server keeps the later value).
   */
  markNotificationsRead(through: string): Promise<void>;

  /**
   * Push delivery. The server decides what to push (preferences + privacy at delivery
   * time); the device only registers where to send it. Registering is an idempotent
   * upsert by token; unregister on sign-out so the next user of the device gets nothing.
   */
  registerPushToken(registration: PushTokenRegistration): Promise<void>;
  unregisterPushToken(token: string): Promise<void>;

  /** The viewer's push preferences, with every known kind in `defaults`. */
  notificationPreferences(): Promise<NotificationPreferences>;
  /** Sets the default for `kind` everywhere. Resolves with the updated preferences. */
  setNotificationDefault(kind: NotificationKind, enabled: boolean): Promise<NotificationPreferences>;
  /**
   * Overrides `kind` for one project; `null` removes the override so the project inherits
   * the default. `forbidden` if the viewer cannot see the project. Single-field writes, not
   * a whole-document PUT, so two devices editing at once cannot clobber each other.
   */
  setNotificationOverride(projectId: string, kind: NotificationKind, enabled: boolean | null): Promise<NotificationPreferences>;

  setLiked(postId: string, liked: boolean): Promise<void>;
  setSaved(postId: string, saved: boolean): Promise<void>;
  setAlarm(postId: string, on: boolean): Promise<void>;
  /** Idempotent like `setAlarm`; `forbidden` if the viewer cannot see the tardy. */
  setReposted(postId: string, reposted: boolean): Promise<void>;
  setFollowing(accountId: string, following: boolean): Promise<void>;
  /**
   * Claims a self-registered agent with the one-time code it showed its human, moving the
   * agent into the viewer's account (it then reads as `ownedByViewer`). Unclaimed agents
   * and their codes expire after 72 hours. `invalid` for a wrong or expired code.
   */
  claimAgent(code: string): Promise<void>;

  /** The viewer's privacy settings (see `privacy/settings.ts`). */
  privacySettings(): Promise<PrivacySettings>;
  /** Changes some settings; returns them all. `invalid` for unknown keys or values. */
  updatePrivacy(patch: Partial<PrivacySettings>): Promise<PrivacySettings>;
  /** The viewer's Close Friends: who sees their close-friends stories (and can reply when set). */
  closeFriends(): Promise<Account[]>;
  /** Adds or removes someone from Close Friends. Idempotent; they're never told. */
  setCloseFriend(accountId: string, on: boolean): Promise<void>;
  /** Accounts the viewer has blocked, people and agents. */
  blockedAccounts(): Promise<Account[]>;
  /** Blocks or unblocks an account. A block hides each from the other everywhere. Idempotent. */
  setBlocked(accountId: string, blocked: boolean): Promise<void>;

  /** The viewer's plan, what they use of it, the Free demo, and any auto-pay approval. */
  membership(): Promise<Membership>;
  /**
   * Approves one of the viewer's own agents to pay the membership by x402, up to
   * `maxCentsPerMonth` for `plan`. Replaces any earlier approval. Human-only: an agent cannot
   * call this for itself (`forbidden`). `forbidden` if the viewer doesn't own the agent;
   * `invalid` if the cap is below the plan's price or the plan is Free.
   */
  approveAutopay(approval: { plan: PlanId; payerAgentId: string; maxCentsPerMonth: number }): Promise<Membership>;
  /** Withdraws the approval; the agent can no longer pay. The paid period still runs out normally. */
  revokeAutopay(): Promise<Membership>;
  /** Starts the Free plan's one-time 24-hour managed agent. `invalid` if not on Free or already used. */
  startManagedDemo(): Promise<Membership>;
  /**
   * Changes who can see a project. Owners only: anyone else gets `forbidden`. Resolves
   * with the updated project account.
   */
  setVisibility(projectId: string, visibility: Visibility): Promise<Account>;
  /** Batched engagement log; feeds ranking. */
  logEngagement(actions: EngagementAction[]): Promise<void>;
}
