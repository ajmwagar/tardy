import type { AgentActivity, AgentControls } from '@/agents/controls';
import { NOTIFICATION_KINDS } from '@/notifications/preferences';
import type { PlanId } from '@/membership/plans';
import { REACTION_KINDS } from '@/reactions/reactions';
import { parseTardyUrl } from '@/share/links';

import type {
  Account,
  AccountKind,
  AuthProvider,
  Comment,
  MediaItem,
  Message,
  Notification,
  NotificationKind,
  NotificationOverride,
  NotificationPreferences,
  Page,
  Post,
  PostLink,
  PostStyle,
  ProjectRole,
  Session,
  SharedLink,
  AutopayMandate,
  PostSuggestion,
  PrivacySettings,
  PostSound,
  ReactionKind,
  ReactionSummary,
  TrendingSound,
  Membership,
  SharedPostRef,
  SignedIn,
  Story,
  StoryGroup,
  ThreadRef,
  Visibility,
  WorkStatus,
} from '../types';
import {
  array,
  arraySkipping,
  boolean,
  integer,
  isRecord,
  isoTime,
  knownOf,
  knownRecord,
  map,
  nullable,
  number,
  object,
  oneOf,
  optional,
  string,
  tagged,
  timeMs,
  wire,
  type Decoder,
} from './codec';

/**
 * Decoders for every type the server sends, in the wire shapes of
 * `contracts/app-api-addendum.md`. Field renames against the app's names are spelled out
 * with `wire(...)` where the existing Rust types already chose a name (`display_name`,
 * `body`, `sent_at_ms`, `participants`, `category`).
 */

/**
 * The values of a string union, checked at compile time to list every member, so adding
 * a member to `types.ts` breaks the build here instead of failing decodes at runtime.
 */
const allOf =
  <T extends string>() =>
  <const V extends readonly T[]>(values: V & ([Exclude<T, V[number]>] extends [never] ? unknown : { missing: Exclude<T, V[number]> })) =>
    values;

const ACCOUNT_KINDS = allOf<AccountKind>()(['human', 'agent', 'project', 'channel']);
const VERIFICATION_TIERS = ['real_tardy', 'super_tardy'] as const;
const VISIBILITIES = allOf<Visibility>()(['private', 'team', 'public']);
const PROJECT_ROLES = allOf<ProjectRole>()(['owner', 'member']);
const POST_FORMATS = allOf<Post['format']>()(['photo', 'carousel', 'video', 'reel']);
const POST_STYLES = allOf<PostStyle>()(['news', 'podcast', 'launch', 'explainer', 'ugc', 'brainrot']);
const WORK_STATUSES = allOf<WorkStatus>()(['shipped', 'in_progress', 'needs_review', 'blocked']);
const LINK_KINDS = allOf<PostLink['kind']>()(['pull_request', 'commit', 'issue', 'deploy', 'other']);
const AUTH_PROVIDERS = allOf<AuthProvider>()(['github', 'apple', 'google', 'x', 'email']);
const KINDS = allOf<NotificationKind>()(NOTIFICATION_KINDS);

const brandAffiliate = object<NonNullable<Account['brandAffiliate']>>({
  profileId: wire('profile_id', string),
  handle: string,
  avatarUrl: wire('avatar_url', string),
  label: optional(string),
});

export const account: Decoder<Account> = object<Account>({
  id: string,
  kind: oneOf(ACCOUNT_KINDS),
  handle: string,
  name: wire('display_name', string),
  avatarUrl: string,
  bio: string,
  model: optional(string),
  projectId: optional(string),
  verified: boolean,
  verificationTier: optional(oneOf(VERIFICATION_TIERS)),
  superTardySlot: optional(integer),
  brandAffiliate: optional(brandAffiliate),
  followers: integer,
  following: integer,
  postCount: integer,
  visibility: optional(oneOf(VISIBILITIES)),
  viewerRole: optional(oneOf(PROJECT_ROLES)),
  ownedByViewer: optional(boolean),
  hosting: optional(oneOf(['managed', 'connected'] as const)),
});

const postSound: Decoder<PostSound> = object<PostSound>({
  trackId: string,
  title: string,
  artistName: string,
  durationMs: integer,
  attribution: optional(string),
});

const media: Decoder<MediaItem> = tagged<MediaItem>('type', {
  image: object<Extract<MediaItem, { type: 'image' }>>({ type: oneOf(['image']), url: string, width: integer, height: integer }),
  video: object<Extract<MediaItem, { type: 'video' }>>({
    type: oneOf(['video']),
    url: string,
    posterUrl: string,
    width: integer,
    height: integer,
    durationMs: integer,
  }),
});

export const post: Decoder<Post> = object<Post>({
  id: string,
  authorId: string,
  projectId: optional(string),
  collaboratorIds: optional(array(string)),
  sound: optional(postSound),
  format: oneOf(POST_FORMATS),
  // Open set: a style this client does not know yet is dropped, not an error.
  style: optional(knownOf(POST_STYLES)),
  media: array(media),
  caption: string,
  status: optional(oneOf(WORK_STATUSES)),
  links: array(object<PostLink>({ kind: oneOf(LINK_KINDS), label: string, url: string })),
  createdAt: timeMs,
  likeCount: integer,
  commentCount: integer,
  shareCount: integer,
  alarmCount: integer,
  repostCount: integer,
  viewerHasLiked: boolean,
  viewerHasAlarm: boolean,
  viewerHasReposted: boolean,
  viewerHasSaved: boolean,
  ranking: optional(object<NonNullable<Post['ranking']>>({ score: number, inNetwork: boolean })),
});

export function page<T>(item: Decoder<T>): Decoder<Page<T>> {
  return object<Page<T>>({ items: array(item), nextCursor: nullable(string) });
}

/** `GET /v1/feed/hyper-tardy` items carry the app's `post` view next to the virality facts. */
export const trendingPosts: Decoder<Post[]> = map(array(object<{ post: Post }>({ post })), (items) => items.map((i) => i.post));

/**
 * Tap-backs: `[{ kind, account_ids }]`. An open set: kinds this client doesn't know are
 * skipped, so the server can add some before clients ship; an empty list is absent.
 */
const reactionOrSkip: Decoder<ReactionSummary[number] | undefined> = (v, path) => {
  const row = object<{ kind: ReactionKind | undefined; accountIds: string[] }>({ kind: knownOf(REACTION_KINDS), accountIds: array(string) })(v, path);
  return row.kind === undefined ? undefined : { kind: row.kind, accountIds: row.accountIds };
};
const reactions: Decoder<ReactionSummary | undefined> = map(optional(arraySkipping(reactionOrSkip)), (r) => (r && r.length > 0 ? r : undefined));

/**
 * The social `Comment` (`POST /v1/social/posts/{id}/comments`). The server does not count
 * comment likes yet; an absent `like_count` is zero, which is true of every comment it returns.
 */
export const comment: Decoder<Comment> = map(
  object<Omit<Comment, 'likeCount'> & { likeCount?: number }>({
    id: string,
    postId: string,
    authorId: wire('author_profile_id', string),
    text: wire('body', string),
    createdAt: wire('created_at', isoTime),
    likeCount: optional(integer),
    mentionedIds: wire('mentioned_profile_ids', optional(array(string))),
    reactions,
  }),
  ({ likeCount, mentionedIds, reactions: r, ...rest }) => ({
    ...rest,
    likeCount: likeCount ?? 0,
    ...(mentionedIds?.length ? { mentionedIds } : {}),
    ...(r ? { reactions: r } : {}),
  }),
);

const story: Decoder<Story> = object<Story>({
  id: string,
  authorId: string,
  media,
  createdAt: timeMs,
  seen: boolean,
  audience: optional(oneOf(['close_friends'] as const)),
  boostedUntil: optional(timeMs),
});

export const storyGroup: Decoder<StoryGroup> = object<StoryGroup>({ authorId: string, stories: array(story) });

const sharedPost: Decoder<SharedPostRef> = tagged<SharedPostRef>('status', {
  available: object<Extract<SharedPostRef, { status: 'available' }>>({ status: oneOf(['available']), postId: string }),
  unavailable: object<Extract<SharedPostRef, { status: 'unavailable' }>>({ status: oneOf(['unavailable']) }),
});

/**
 * The social `ConversationMessage`, plus its `sequence` (the paging cursor). A tardy shared
 * into a conversation travels as a shared link to its `tardy.news/t/{id}` URL in the body
 * (the server has no shared-post field); it decodes back to `sharedPost` so it renders as a
 * tardy card. `shared_post` (proposed) wins when the server sends it.
 */
export const conversationMessage: Decoder<{ message: Message; sequence: number }> = map(
  object<Message & { sequence: number }>({
    id: string,
    threadId: wire('conversation_id', string),
    senderId: wire('sender_profile_id', string),
    text: wire('body', string),
    createdAt: wire('created_at', isoTime),
    sharedPost: optional(sharedPost),
    sharedLinkId: optional(string),
    media: optional(array(object({
      assetId: wire('asset_id', string),
      type: oneOf(['image'] as const),
      url: string,
      width: integer,
      height: integer,
      altText: optional(wire('alt_text', string)),
    }))),
    reactions,
    readByIds: optional(array(string)),
    sequence: integer,
  }),
  ({ sequence, ...m }) => {
    const sharedPostId = m.sharedLinkId && !m.sharedPost ? parseTardyUrl(m.text) : null;
    const message: Message = sharedPostId ? { ...m, text: '', sharedPost: { status: 'available', postId: sharedPostId } } : m;
    if (message.sharedLinkId === undefined) delete message.sharedLinkId;
    if (message.sharedPost === undefined) delete message.sharedPost;
    if (message.media === undefined) delete message.media;
    if (message.reactions === undefined) delete message.reactions;
    if (message.readByIds === undefined) delete message.readByIds;
    return { message: { ...message, sequence }, sequence };
  },
);

export const message: Decoder<Message> = map(conversationMessage, (m) => m.message);

const MODES = ['dm', 'work'] as const;

/** The social `Conversation`: `mode` is the app's `kind`. */
export const threadRef: Decoder<ThreadRef> = object<ThreadRef>({
  id: string,
  participantIds: wire('participants', array(string)),
  title: optional(string),
  kind: wire('mode', oneOf(MODES)),
});

/**
 * `GET /v1/social/conversations` rows. `last_message` and `unread_count` are proposed
 * additions; until the server sends them the client reads the last message itself.
 */
export const conversation: Decoder<ThreadRef & { lastMessage?: Message; unreadCount?: number }> = object({
  id: string,
  participantIds: wire('participants', array(string)),
  title: optional(string),
  kind: wire('mode', oneOf(MODES)),
  lastMessage: optional(message),
  unreadCount: optional(integer),
});

/**
 * `POST /v1/search` rows: `{ post, relevance_score }`, the app's post view (proposed; today's
 * server sends its `FeedItem` under `item`, see the addendum).
 */
export const searchResult: Decoder<{ post: Post; relevanceScore: number }> = object<{ post: Post; relevanceScore: number }>({
  post,
  relevanceScore: number,
});

/** `GET /v1/audio/trending` rows: `{ track, uses_24h, qualified_plays_24h, score }`. */
export const trendingSound: Decoder<TrendingSound> = map(
  object<{ track: { id: string; title: string; artistName: string }; uses24h: number; qualifiedPlays24h: number; score: number }>({
    track: object<{ id: string; title: string; artistName: string }>({ id: string, title: string, artistName: string }),
    uses24h: wire('uses_24h', integer),
    qualifiedPlays24h: wire('qualified_plays_24h', integer),
    score: integer,
  }),
  ({ track, uses24h, qualifiedPlays24h, score }) => ({ trackId: track.id, title: track.title, artistName: track.artistName, uses24h, plays24h: qualifiedPlays24h, score }),
);

/**
 * `GET /v1/social/post-suggestions` rows (proposed): the would-be tardy (content only, no
 * counts yet) plus who wants to post it and why.
 */
export const postSuggestion: Decoder<PostSuggestion> = object<PostSuggestion>({
  id: string,
  agentId: wire('agent_profile_id', string),
  kind: optional(oneOf(['post', 'story', 'comment', 'message', 'follow'] as const)),
  target: optional(object<NonNullable<PostSuggestion['target']>>({ accountId: wire('account_profile_id', string), postId: optional(string) })),
  post: object<PostSuggestion['post']>({
    caption: string,
    media: array(media),
    format: oneOf(POST_FORMATS),
    status: optional(oneOf(WORK_STATUSES)),
    style: optional(knownOf(POST_STYLES)),
    links: array(object<PostLink>({ kind: oneOf(LINK_KINDS), label: string, url: string })),
    projectId: optional(string),
  }),
  reason: optional(string),
  visibility: oneOf(['private', 'followers', 'public'] as const),
  createdAt: wire('created_at', isoTime),
});

const ACTION_MODES = ['auto', 'ask', 'off'] as const;
const AUDIENCES = ['private', 'followers', 'public'] as const;

/** `GET /v1/agents/{id}/controls`: what one of the viewer's agents may do without them. */
export const agentControls: Decoder<AgentControls> = object<AgentControls>({
  paused: boolean,
  posts: oneOf(ACTION_MODES),
  stories: oneOf(ACTION_MODES),
  comments: oneOf(ACTION_MODES),
  messages: oneOf(ACTION_MODES),
  follows: oneOf(ACTION_MODES),
  reactions: oneOf(['auto', 'off'] as const),
  autoAudience: oneOf(AUDIENCES),
  dailyLimit: nullable(integer),
  quietHours: boolean,
  monthlySpendCents: integer,
  useYourActivity: boolean,
  notifyOnAuto: boolean,
});

const AGENT_ACTION_KINDS = ['post', 'story', 'comment', 'message', 'follow', 'reaction'] as const;

/** One entry of `GET /v1/agents/{id}/activity`. Unknown action kinds (newer servers) are skipped. */
export const agentActivity: Decoder<AgentActivity | undefined> = (v, path) => {
  if (isRecord(v) && !(AGENT_ACTION_KINDS as readonly unknown[]).includes(v.kind)) return undefined;
  return object<AgentActivity>({
    id: string,
    agentId: wire('agent_profile_id', string),
    kind: oneOf(AGENT_ACTION_KINDS),
    summary: string,
    how: oneOf(['auto', 'approved', 'rejected', 'blocked'] as const),
    at: wire('at', isoTime),
    postId: optional(string),
  })(v, path);
};

/** `GET /v1/profile/privacy-settings` (proposed). */
export const privacySettings: Decoder<PrivacySettings> = object<PrivacySettings>({
  privateAccount: boolean,
  agentMessages: oneOf(['everyone', 'followed', 'mine', 'none'] as const),
  agentMentions: oneOf(['everyone', 'followed', 'mine', 'none'] as const),
  agentReading: oneOf(['everyone', 'mine'] as const),
  aiTraining: wire('ai_training', boolean),
  messagesFrom: oneOf(['everyone', 'following', 'none'] as const),
  mentionsFrom: oneOf(['everyone', 'following', 'none'] as const),
  storyReplies: oneOf(['everyone', 'following', 'close_friends', 'none'] as const),
  activityStatus: boolean,
});

const PLAN_IDS = allOf<PlanId>()(['free', 'builder', 'studio']);

const mandate: Decoder<AutopayMandate> = object<AutopayMandate>({
  plan: oneOf(PLAN_IDS),
  payerAgentId: string,
  maxCentsPerMonth: integer,
  approvedAt: wire('approved_at', isoTime),
});

const demo: Decoder<Membership['demo']> = tagged<Membership['demo']>('status', {
  available: object<Extract<Membership['demo'], { status: 'available' }>>({ status: oneOf(['available']) }),
  running: object<Extract<Membership['demo'], { status: 'running' }>>({
    status: oneOf(['running']),
    agentId: string,
    endsAt: wire('ends_at', isoTime),
  }),
  used: object<Extract<Membership['demo'], { status: 'used' }>>({ status: oneOf(['used']) }),
});

/** `GET /v1/membership` (proposed). */
export const membership: Decoder<Membership> = object<Membership>({
  plan: oneOf(PLAN_IDS),
  paidThrough: wire('paid_through', optional(isoTime)),
  paidWith: optional(oneOf(['stripe', 'x402'] as const)),
  usage: object<Membership['usage']>({ managed: integer, connected: integer }),
  demo,
  autopay: nullable(mandate),
});

export const sharedLink: Decoder<SharedLink> = object<SharedLink>({
  id: string,
  canonicalUrl: string,
  provider: string,
  status: knownOf(['queued', 'processing', 'ready', 'failed']),
  title: optional(string),
  thumbnailUrl: optional(string),
  caption: optional(string),
  mediaUrl: optional(string),
});

/** Notifications of a kind this client does not know are skipped, per the contract. */
const notificationOrSkip: Decoder<Notification | undefined> = (v, path) => {
  const kind = object<{ kind: NotificationKind | undefined }>({ kind: knownOf(KINDS) })(v, path).kind;
  if (kind === undefined) return undefined;
  return object<Notification>({
    id: string,
    kind: oneOf(KINDS),
    actorId: string,
    postId: optional(string),
    conversationId: optional(string),
    text: string,
    createdAt: timeMs,
    read: boolean,
  })(v, path);
};

export const notifications: Decoder<Notification[]> = arraySkipping(notificationOrSkip);

const overrideOrSkip: Decoder<NotificationOverride | undefined> = (v, path) => {
  const row = object<{ projectId: string; kind: NotificationKind | undefined; enabled: boolean }>({
    projectId: string,
    kind: wire('category', knownOf(KINDS)),
    enabled: boolean,
  })(v, path);
  return row.kind === undefined ? undefined : { projectId: row.projectId, kind: row.kind, enabled: row.enabled };
};

export const notificationPreferences: Decoder<NotificationPreferences> = object<NotificationPreferences>({
  // Every kind this client knows must be present (the server fills defaults); extra kinds are ignored.
  defaults: knownRecord(KINDS, boolean, { requireAll: true }),
  overrides: arraySkipping(overrideOrSkip),
});

const session: Decoder<Session> = object<Session>({
  token: string,
  accountId: string,
  provider: oneOf(AUTH_PROVIDERS),
  expiresAt: timeMs,
});

export const signedIn: Decoder<SignedIn> = object<SignedIn>({ session, account, onboardedAt: nullable(timeMs) });

export const ids: Decoder<string[]> = array(string);
