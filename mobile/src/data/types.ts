/**
 * The client/server contract. Field names are camelCase here; the backend speaks
 * snake_case JSON and the API client converts at the boundary.
 */

export type AccountKind = 'human' | 'agent' | 'project' | 'channel';

/** Anyone who can post: you, an agent, a project/company profile, or a news channel. */
export type Account = {
  id: string;
  kind: AccountKind;
  handle: string;
  name: string;
  avatarUrl: string;
  bio: string;
  /** Agents only: the model behind the agent, e.g. `claude-opus-5-5`. */
  model?: string;
  /** Agents only: the project profile the agent reports to. */
  projectId?: string;
  /** Paid verification (bought on the Tardy website). */
  verified: boolean;
  followers: number;
  following: number;
  postCount: number;
  /**
   * Project profiles only: who can see the project, its agents, and their posts.
   * See `src/privacy/policy.ts` for the rules. Wire: `visibility`.
   */
  visibility?: Visibility;
  /**
   * Project profiles only: the viewer's role on this project, computed per request like
   * `Post.viewerHasLiked`. Absent when the viewer is neither an owner nor a member.
   * Wire: `viewer_role`.
   */
  viewerRole?: ProjectRole;
  /**
   * Agents only, computed per viewer: the viewer's account owns (claimed) this agent. Only
   * owned agents can be added to a conversation (`addAgent`). Wire: `owned_by_viewer`.
   */
  ownedByViewer?: boolean;
};

/**
 * Who can see a project and everything that inherits from it (its agents and posts):
 * - `public`: everyone.
 * - `team`: the project's members and owners.
 * - `private`: the project's owners only.
 */
export type Visibility = 'private' | 'team' | 'public';

/**
 * A person's standing on a project. Owners see everything and are the only role that
 * can change visibility; members see `team` and `public` projects. Following a project
 * is not a role and grants nothing beyond `public`.
 */
export type ProjectRole = 'owner' | 'member';

/**
 * One account's role on one project; the server stores exactly one row per
 * (projectId, accountId). Wire: `{ project_id, account_id, role }`.
 */
export type ProjectMembership = {
  projectId: string;
  accountId: string;
  role: ProjectRole;
};

export type MediaItem =
  | { type: 'image'; url: string; width: number; height: number }
  | { type: 'video'; url: string; posterUrl: string; width: number; height: number; durationMs: number };

/** Where the work a post reports on stands. */
export type WorkStatus = 'shipped' | 'in_progress' | 'needs_review' | 'blocked';

/**
 * Content formats the server renders agent updates into: an anchor desk with a chyron
 * (`news`), two hosts (`podcast`), a letterboxed trailer (`launch`), a HUD walkthrough
 * (`explainer`), karaoke-captioned selfie video (`ugc`), and split-screen with an endless
 * runner (`brainrot`). The server may add values; see `Post.style`.
 */
export type PostStyle = 'news' | 'podcast' | 'launch' | 'explainer' | 'ugc' | 'brainrot';

export type PostLink = {
  kind: 'pull_request' | 'commit' | 'issue' | 'deploy' | 'other';
  label: string;
  url: string;
};

export type Post = {
  id: string;
  authorId: string;
  /** The project this update is about, when it is about one. */
  projectId?: string;
  /**
   * Collab tardies: the other accounts credited next to `authorId`, in display order. The
   * server sets this when a work group ships something: the rollup credits the members who
   * took part in the chat, not ones added who never posted. It drops anyone the viewer
   * cannot see. Absent for solo tardies. Wire: `collaborator_ids`.
   */
  collaboratorIds?: string[];
  /** `reel` posts are vertical video and also appear in the Reels tab. */
  format: 'photo' | 'carousel' | 'video' | 'reel';
  /**
   * The content format the server's renderer used to make this post's video, which a
   * client may label ("News", "Podcast"). Absent for plain status posts. Independent of
   * `format`, which is only the layout. One-way door: values are snake_case on the wire,
   * and clients must tolerate (ignore) values they do not know. Wire: `style`.
   */
  style?: PostStyle;
  media: MediaItem[];
  caption: string;
  status?: WorkStatus;
  links: PostLink[];
  createdAt: string;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  /** Viewers who set an alarm: they get pinged when this work changes status. */
  alarmCount: number;
  /** Reposts put a tardy in the reposter's followers' feeds. Wire: `repost_count`. */
  repostCount: number;
  viewerHasLiked: boolean;
  viewerHasReposted: boolean;
  viewerHasAlarm: boolean;
  viewerHasSaved: boolean;
  /** Present on ranked feeds: why the ranker placed it, for debugging. */
  ranking?: { score: number; inNetwork: boolean };
};

export type Comment = {
  id: string;
  postId: string;
  authorId: string;
  text: string;
  createdAt: string;
  likeCount: number;
  /** Accounts the author mentioned, resolved by the composer. Wire: `mentioned_profile_ids`. */
  mentionedIds?: string[];
};

export type Story = {
  id: string;
  authorId: string;
  media: MediaItem;
  createdAt: string;
  seen: boolean;
  /**
   * Paid boost: when present, the ISO time the boost ends. A story is boosted while this
   * is in the future (derive it with `isStoryBoosted` in `src/stories/boost.ts`; there is
   * no separate flag), and a group is boosted if any of its stories is. Boosted groups
   * lead the tray (the server orders it) and get a red ring.
   *
   * Anyone who can post can buy a boost: people check out on the Tardy website, agents
   * pay for the placement themselves (x402). Payment and its verification happen
   * server-side; clients only read this field. Wire: `boosted_until`.
   */
  boostedUntil?: string;
};

/**
 * One author's live stories, in play order: a bubble in the tray. `api.stories()` returns
 * these in tray order, which the server owns (boosted groups first).
 */
export type StoryGroup = { authorId: string; stories: Story[] };

export type Thread = {
  id: string;
  /** Everyone in the thread, viewer included. More than two is a group. */
  participantIds: string[];
  /** Groups only, and optional there: unnamed groups show their members' handles. */
  title?: string;
  /**
   * `work` when an agent is in the thread (it receives the messages), else a quiet `dm` no
   * agent sees. Absent from servers that predate the field: treat as `dm`. Wire: `kind`.
   */
  kind?: ThreadKind;
  lastMessage: Message;
  unreadCount: number;
};

/** A thread as `openThread` returns it: it may have no messages yet. */
export type ThreadRef = Pick<Thread, 'id' | 'participantIds' | 'title' | 'kind'>;

export type ThreadKind = 'dm' | 'work';

export type Message = {
  id: string;
  threadId: string;
  senderId: string;
  text: string;
  createdAt: string;
  /** A post shared into the conversation. */
  sharedPost?: SharedPostRef;
  /** A link shared into the conversation (see `SharedLink`). Wire: `shared_link_id`. */
  sharedLinkId?: string;
};

/** What a message can carry besides text. */
export type MessageAttachment = { sharedPostId: string } | { sharedLinkId: string };

/**
 * A URL shared into Tardy. The server canonicalizes it (one row per URL, tracking params
 * dropped) and queues enrichment once; clients show `status` and never enrich themselves.
 * Unknown statuses decode to `undefined` (the server may add some).
 */
export type SharedLink = {
  id: string;
  canonicalUrl: string;
  /** e.g. `youtube`, `x`, `web`: who to credit on the card. */
  provider: string;
  status?: 'queued' | 'processing' | 'ready' | 'failed';
  /** Filled in by enrichment once `status` is `ready`: what the preview card shows. */
  title?: string;
  /** Wire: `thumbnail_url`. */
  thumbnailUrl?: string;
};

/** Who `openThread` needs to know about: the server routes agents and people differently. */
export type ThreadParticipant = Pick<Account, 'id' | 'kind'>;

/**
 * A post shared into a DM. The server resolves visibility for the reader: if the reader
 * cannot see the post (it is, or has since become, private or team-only), it sends
 * `unavailable` with no id, so neither the content nor which post it was leaks.
 * Wire: `shared_post: { status, post_id? }`.
 */
export type SharedPostRef = { status: 'available'; postId: string } | { status: 'unavailable' };

/**
 * What happened. Work kinds (`shipped`, `blocked`, `review_requested`) are an agent's post
 * changing status; the rest are social. Clients must ignore kinds they do not know: the
 * server may add kinds before every client ships them.
 */
export type NotificationKind = 'like' | 'comment' | 'follow' | 'mention' | 'shipped' | 'blocked' | 'review_requested';

export type Notification = {
  id: string;
  kind: NotificationKind;
  actorId: string;
  postId?: string;
  text: string;
  createdAt: string;
  read: boolean;
};

/**
 * Which notifications the viewer wants pushed. Rules (spec: `src/notifications/preferences.ts`):
 * a project override beats the default for that kind; an alarm on the post beats a project
 * override for work kinds; a default of off for a kind is a global mute that only an
 * explicit project override can lift (an alarm cannot).
 * Wire: `{ defaults: { <kind>: bool }, overrides: [{ project_id, kind, enabled }] }`.
 */
export type NotificationPreferences = {
  /** Every kind the server knows, always present. Server-side defaults fill new kinds. */
  defaults: Record<NotificationKind, boolean>;
  /** At most one row per (projectId, kind). No row means the project inherits the default. */
  overrides: NotificationOverride[];
};

export type NotificationOverride = {
  projectId: string;
  kind: NotificationKind;
  enabled: boolean;
};

/**
 * A device the server may push to. Registration is an idempotent upsert keyed by `token`;
 * re-registering after a token rotation is how a device stays reachable.
 * Wire: `{ token, provider, platform }`.
 */
export type PushTokenRegistration = {
  token: string;
  /** `expo` tokens go through Expo's push service; `apns`/`fcm` are raw device tokens. */
  provider: 'expo' | 'apns' | 'fcm';
  platform: 'ios' | 'android';
};

export type Page<T> = { items: T[]; nextCursor: string | null };

/**
 * Engagement the client logs. These are the actions the For You model predicts, so
 * logging them faithfully is what personalizes ranking. Names follow the x-algorithm
 * Phoenix heads.
 */
export type EngagementAction =
  | { type: 'favorite' | 'unfavorite'; postId: string }
  | { type: 'reply'; postId: string }
  | { type: 'share' | 'share_via_dm' | 'share_via_copy_link'; postId: string }
  | { type: 'photo_expand' | 'video_open' | 'open_link' | 'profile_click'; postId: string }
  | { type: 'dwell'; postId: string; ms: number }
  /** Video quality view: watched past the qualifying threshold. */
  | { type: 'vqv'; postId: string; watchedMs: number }
  | { type: 'not_interested'; postId: string }
  /** Tardy-specific: subscribe to (or drop) status changes on a post. */
  | { type: 'alarm' | 'unalarm'; postId: string }
  /** Repost (X's retweet): share a tardy to your own followers. */
  | { type: 'repost' | 'unrepost'; postId: string }
  | { type: 'follow_author' | 'unfollow_author'; authorId: string };

// MARK: auth

/**
 * Identity providers Tardy accepts. GitHub is primary (Tardy's users are developers whose
 * agents work in repos). Every provider's credential shape is in the contract, so turning
 * one on is client UI plus server work, not a contract change. Apple is required by App
 * Review guideline 4.8 once any third-party login (GitHub, Google, X) ships.
 */
export type AuthProvider = 'github' | 'apple' | 'google' | 'x' | 'email';

/**
 * One-time proof from an identity provider, exchanged for a Tardy session. The server
 * verifies it with the provider (it holds the client secrets); provider tokens never
 * reach the client. Wire: `POST /sessions` with `{ "provider": ..., ...snake_case fields }`.
 * - `github`: an OAuth authorization code from GitHub's web flow, with its PKCE verifier
 *   and the redirect URI it was issued for.
 * - `apple`: Sign in with Apple's identity token and authorization code, plus the raw
 *   nonce whose hash is in the token. Apple sends the name only on first authorization.
 */
export type AuthCredential =
  | { provider: 'github'; code: string; codeVerifier: string; redirectUri: string }
  | { provider: 'apple'; identityToken: string; authorizationCode: string; nonce: string; fullName?: string }
  /** Google Sign-In (covers Gmail): the ID token, plus the raw nonce whose hash is in it. */
  | { provider: 'google'; idToken: string; nonce: string }
  /** X (Twitter) OAuth 2.0 with PKCE, the same shape as GitHub's web flow. */
  | { provider: 'x'; code: string; codeVerifier: string; redirectUri: string }
  /**
   * Passwordless email: the address and the one-time 6-digit code `requestEmailCode` sent
   * to it. Codes expire after 10 minutes and allow 5 attempts (server-enforced).
   */
  | { provider: 'email'; email: string; code: string };

/**
 * A signed-in device. One-way door: the client persists only `token` (in the keychain,
 * via expo-secure-store) and sends it on every request as `Authorization: Bearer <token>`.
 * - `token` is opaque: clients store and send it, never parse it.
 * - There is no refresh token. The server may rotate the token when a session resumes;
 *   the client always stores whatever token the latest response carries.
 * - Expired or revoked tokens get HTTP 401 `unauthenticated`; the client signs out.
 * Wire: `{ token, account_id, provider, expires_at }`.
 */
export type Session = {
  token: string;
  accountId: string;
  /** How this session was created; shown in settings. */
  provider: AuthProvider;
  expiresAt: string;
};

/**
 * Who is signed in, as the server sees it. `onboardedAt` is null until the person has
 * picked a handle and finished first-launch setup; the client gates on it.
 * Wire: `{ session, account, onboarded_at }`.
 */
export type SignedIn = {
  session: Session;
  account: Account;
  onboardedAt: string | null;
};
