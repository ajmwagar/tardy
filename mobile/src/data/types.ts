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
  verified: boolean;
  followers: number;
  following: number;
  postCount: number;
  /** Project profiles only: who can see its posts. */
  visibility?: 'private' | 'team' | 'public';
};

export type MediaItem =
  | { type: 'image'; url: string; width: number; height: number }
  | { type: 'video'; url: string; posterUrl: string; width: number; height: number; durationMs: number };

/** Where the work a post reports on stands. */
export type WorkStatus = 'shipped' | 'in_progress' | 'needs_review' | 'blocked';

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
  /** `reel` posts are vertical video and also appear in the Reels tab. */
  format: 'photo' | 'carousel' | 'video' | 'reel';
  media: MediaItem[];
  caption: string;
  status?: WorkStatus;
  links: PostLink[];
  createdAt: string;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  viewerHasLiked: boolean;
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
};

export type Story = {
  id: string;
  authorId: string;
  media: MediaItem;
  createdAt: string;
  seen: boolean;
};

export type Thread = {
  id: string;
  participantIds: string[];
  lastMessage: Message;
  unreadCount: number;
};

export type Message = {
  id: string;
  threadId: string;
  senderId: string;
  text: string;
  createdAt: string;
  /** A post shared into the conversation. */
  sharedPostId?: string;
};

export type Notification = {
  id: string;
  kind: 'like' | 'comment' | 'follow' | 'mention' | 'shipped' | 'blocked' | 'review_requested';
  actorId: string;
  postId?: string;
  text: string;
  createdAt: string;
  read: boolean;
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
  | { type: 'follow_author' | 'unfollow_author'; authorId: string };
