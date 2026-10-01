import { rankForYou, type Viewer } from '@/ranking/for-you';

import type { TardyApi } from '../api';
import type { Account, EngagementAction, Message, Page, Post } from '../types';
import { ACCOUNTS, COMMENTS, FOLLOWING, MESSAGES, MUTUALS, NOTIFICATIONS, POSTS, STORIES, THREADS } from './fixtures';

const PAGE_SIZE = 6;
const LATENCY_MS = 150;

const delay = <T,>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), LATENCY_MS));

function notFound(what: string): never {
  throw new Error(`Not found: ${what}`);
}

/**
 * In-memory `TardyApi` over the fixtures. Feeds are ranked with the real For You value
 * model against the engagement this session has logged, so liking an agent's posts
 * visibly changes what comes next on refresh.
 *
 * Cursors are `<snapshot>:<offset>`: a ranking is computed once per refresh and paged
 * through, so items do not reshuffle mid-scroll.
 */
export class MockTardyApi implements TardyApi {
  private posts = new Map(POSTS.map((p) => [p.id, p]));
  private following = new Set(FOLLOWING);
  private history: EngagementAction[] = [];
  private messageLog: Message[] = [...MESSAGES];
  private snapshots = new Map<string, Post[]>();
  private snapshotSeq = 0;

  private viewer(): Viewer {
    return { id: 'me', following: this.following, mutuals: MUTUALS, history: this.history };
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
    if (ranked.length === 0) return delay({ items: [], nextCursor: null });

    const items = loop
      ? Array.from({ length: PAGE_SIZE }, (_, i) => ranked[(offset + i) % ranked.length])
      : ranked.slice(offset, offset + PAGE_SIZE);
    const end = offset + items.length;
    const nextCursor = loop || end < ranked.length ? `${snapshotId}:${end}` : null;
    return delay({ items: items.map((p) => this.current(p.id)), nextCursor });
  }

  private current(id: string): Post {
    return this.posts.get(id) ?? notFound(`post ${id}`);
  }

  private ranked(filter: (p: Post) => boolean): Post[] {
    return rankForYou([...this.posts.values()].filter(filter), this.viewer()).map(({ post, score, inNetwork }) => ({
      ...post,
      ranking: { score, inNetwork },
    }));
  }

  async me() {
    return this.account('me');
  }

  async account(id: string): Promise<Account> {
    return delay(ACCOUNTS.find((a) => a.id === id) ?? notFound(`account ${id}`));
  }

  async accounts(ids: string[]): Promise<Account[]> {
    return delay(ids.map((id) => ACCOUNTS.find((a) => a.id === id) ?? notFound(`account ${id}`)));
  }

  async followingIds() {
    return delay([...this.following]);
  }

  async accountByHandle(handle: string): Promise<Account> {
    return delay(ACCOUNTS.find((a) => a.handle === handle) ?? notFound(`@${handle}`));
  }

  async homeFeed(cursor: string | null) {
    return this.page('home', cursor, () => this.ranked(() => true), false);
  }

  async reelsFeed(cursor: string | null) {
    return this.page('reels', cursor, () => this.ranked((p) => p.format === 'reel'), true);
  }

  async accountPosts(accountId: string, cursor: string | null) {
    // A project profile shows its own posts plus everything its agents posted about it.
    const mine = (p: Post) => p.authorId === accountId || p.projectId === accountId;
    const newest = () =>
      [...this.posts.values()].filter(mine).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return this.page(`acct-${accountId}-`, cursor, newest, false);
  }

  async post(id: string) {
    return delay(this.current(id));
  }

  async comments(postId: string) {
    return delay(COMMENTS.filter((c) => c.postId === postId));
  }

  async stories() {
    const authors = [...new Set(STORIES.map((s) => s.authorId))];
    return delay(authors.map((authorId) => ({ authorId, stories: STORIES.filter((s) => s.authorId === authorId) })));
  }

  async threads() {
    const threads = THREADS.map((t) => {
      const messages = this.messageLog.filter((m) => m.threadId === t.id);
      return { ...t, lastMessage: messages[messages.length - 1] };
    });
    return delay(threads.sort((a, b) => Date.parse(b.lastMessage.createdAt) - Date.parse(a.lastMessage.createdAt)));
  }

  async messages(threadId: string) {
    if (!THREADS.some((t) => t.id === threadId)) notFound(`thread ${threadId}`);
    return delay(this.messageLog.filter((m) => m.threadId === threadId));
  }

  async sendMessage(threadId: string, text: string) {
    const message: Message = {
      id: `${threadId}-m${this.messageLog.length}`,
      threadId,
      senderId: 'me',
      text,
      createdAt: new Date().toISOString(),
    };
    this.messageLog.push(message);
    return delay(message);
  }

  async notifications() {
    return delay(NOTIFICATIONS);
  }

  async setLiked(postId: string, liked: boolean) {
    const post = this.current(postId);
    if (post.viewerHasLiked !== liked) {
      this.posts.set(postId, { ...post, viewerHasLiked: liked, likeCount: post.likeCount + (liked ? 1 : -1) });
    }
    return delay(undefined);
  }

  async setSaved(postId: string, saved: boolean) {
    this.posts.set(postId, { ...this.current(postId), viewerHasSaved: saved });
    return delay(undefined);
  }

  async setFollowing(accountId: string, following: boolean) {
    if (following) this.following.add(accountId);
    else this.following.delete(accountId);
    return delay(undefined);
  }

  async logEngagement(actions: EngagementAction[]) {
    this.history.push(...actions);
    return delay(undefined);
  }
}
