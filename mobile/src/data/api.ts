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
  Story,
  Thread,
  Visibility,
} from './types';

/**
 * Why a request failed. `forbidden` means the thing exists but the viewer may not see or
 * change it (privacy policy denied); `not_found` means there is no such thing. Direct
 * lookups throw these instead of returning empty data, so a denied screen can say so.
 * Wire: HTTP 403 / 404 with `{ "code": "forbidden" | "not_found", "message": ... }`.
 *
 * Auth adds: `unauthenticated` (401: no session, or it expired or was revoked; the
 * client signs out), `invalid` (422: the request broke a rule, e.g. a malformed handle;
 * `message` says which), and `conflict` (409: e.g. the handle is taken).
 */
export type TardyApiErrorCode = 'forbidden' | 'not_found' | 'unauthenticated' | 'invalid' | 'conflict';

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

  stories(): Promise<{ authorId: string; stories: Story[] }[]>;

  threads(): Promise<Thread[]>;
  messages(threadId: string): Promise<Message[]>;
  sendMessage(threadId: string, text: string): Promise<Message>;
  /**
   * Marks everything in the thread read for the viewer, up to and including `throughMessageId`.
   * A per-thread watermark, not per-message flags: idempotent, and a stale call from another
   * device can never un-read newer messages (the server keeps the later watermark).
   */
  markThreadRead(threadId: string, throughMessageId: string): Promise<void>;

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
  setFollowing(accountId: string, following: boolean): Promise<void>;
  /**
   * Changes who can see a project. Owners only: anyone else gets `forbidden`. Resolves
   * with the updated project account.
   */
  setVisibility(projectId: string, visibility: Visibility): Promise<Account>;
  /** Batched engagement log; feeds ranking. */
  logEngagement(actions: EngagementAction[]): Promise<void>;
}
