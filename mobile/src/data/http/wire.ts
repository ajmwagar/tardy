import { NOTIFICATION_KINDS } from '@/notifications/preferences';
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
const VISIBILITIES = allOf<Visibility>()(['private', 'team', 'public']);
const PROJECT_ROLES = allOf<ProjectRole>()(['owner', 'member']);
const POST_FORMATS = allOf<Post['format']>()(['photo', 'carousel', 'video', 'reel']);
const POST_STYLES = allOf<PostStyle>()(['news', 'podcast', 'launch', 'explainer', 'ugc', 'brainrot']);
const WORK_STATUSES = allOf<WorkStatus>()(['shipped', 'in_progress', 'needs_review', 'blocked']);
const LINK_KINDS = allOf<PostLink['kind']>()(['pull_request', 'commit', 'issue', 'deploy', 'other']);
const AUTH_PROVIDERS = allOf<AuthProvider>()(['github', 'apple', 'google', 'x', 'email']);
const KINDS = allOf<NotificationKind>()(NOTIFICATION_KINDS);

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
  followers: integer,
  following: integer,
  postCount: integer,
  visibility: optional(oneOf(VISIBILITIES)),
  viewerRole: optional(oneOf(PROJECT_ROLES)),
  ownedByViewer: optional(boolean),
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
  }),
  ({ likeCount, mentionedIds, ...rest }) => ({ ...rest, likeCount: likeCount ?? 0, ...(mentionedIds?.length ? { mentionedIds } : {}) }),
);

const story: Decoder<Story> = object<Story>({
  id: string,
  authorId: string,
  media,
  createdAt: timeMs,
  seen: boolean,
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
    sequence: integer,
  }),
  ({ sequence, ...m }) => {
    const sharedPostId = m.sharedLinkId && !m.sharedPost ? parseTardyUrl(m.text) : null;
    const message: Message = sharedPostId ? { ...m, text: '', sharedPost: { status: 'available', postId: sharedPostId } } : m;
    if (message.sharedLinkId === undefined) delete message.sharedLinkId;
    if (message.sharedPost === undefined) delete message.sharedPost;
    return { message, sequence };
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

export const sharedLink: Decoder<SharedLink> = object<SharedLink>({
  id: string,
  canonicalUrl: string,
  provider: string,
  status: knownOf(['queued', 'processing', 'ready', 'failed']),
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
