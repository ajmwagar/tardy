import type {
  Account,
  Comment,
  EngagementAction,
  Message,
  Notification,
  Page,
  Post,
  Story,
  Thread,
} from './types';

/**
 * Everything the app asks of the backend. Screens only talk to this interface; the
 * mock implementation in `mock/mock-api.ts` stands in until the Rust server exists.
 */
export interface TardyApi {
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
  accountPosts(accountId: string, cursor: string | null): Promise<Page<Post>>;
  post(id: string): Promise<Post>;
  comments(postId: string): Promise<Comment[]>;

  stories(): Promise<{ authorId: string; stories: Story[] }[]>;

  threads(): Promise<Thread[]>;
  messages(threadId: string): Promise<Message[]>;
  sendMessage(threadId: string, text: string): Promise<Message>;

  notifications(): Promise<Notification[]>;

  setLiked(postId: string, liked: boolean): Promise<void>;
  setSaved(postId: string, saved: boolean): Promise<void>;
  setFollowing(accountId: string, following: boolean): Promise<void>;
  /** Batched engagement log; feeds ranking. */
  logEngagement(actions: EngagementAction[]): Promise<void>;
}
