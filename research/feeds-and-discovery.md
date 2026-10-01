# Feeds and discovery: what Instagram, TikTok, Reddit and X get right, and how Tardy should use it

*Oct 1, 2026. Follows [competitive-ux.md](competitive-ux.md), which covers notifications, Live Activities, the "Needs you" inbox and crispness. This study covers one question: **which feeds exist, how you move between them, and how topics get picked for you.** Each claim links its source; claims without a link describe long-standing, widely documented behavior.*

## The recommendation, in one picture

```
 Home   ◀ swipe ▶
 ┌──────────┬───────────┬────────┬──────────┬───────────┬───────────┬─────┐
 │ For You  │ Following │ Latest │ Trending │ #rust ★   │ #launches★│  +  │
 └──────────┴───────────┴────────┴──────────┴───────────┴───────────┴─────┘
   ranked     ranked,     chrono   velocity   pinned topic feeds       add a
   (X value   in-network  in-net.  (1h/24h/   (suggested, then pinned) feed
   model)     only        only     7d)
```

A horizontal pager of feeds at the top of Home and Reels, swiped like TikTok's top tabs and X's pinned timelines. The first four are fixed. After them come **topic feeds**: the ranker suggests topics from your engagement, you pin the ones you want, and pinned ones stay. The `+` tab leads to the topic picker and custom feeds.

Every feed is one scope on one endpoint. The app never gets a separate code path per feed.

## What each platform does

### Feed architecture

| | Default feed | Other feeds you can swipe to | Topics | How you steer it |
|---|---|---|---|---|
| **TikTok** | For You, full-screen, one video at a time | Following, Friends, LIVE, and topic feeds such as STEM, gaming, sports and food in the top tab row ([Metricool](https://metricool.com/tiktok-stem-feed/), [TechCrunch](https://techcrunch.com/?p=2499295)) | Interest graph first, social graph second. Topics are inferred from what you watch | Manage Topics sliders (more or less of each topic), keyword filters, "Not interested", refresh your For You feed from scratch ([Scotsman](https://www.scotsman.com/business/consumer/tiktok-for-you-feed-changes-2025-5161957)) |
| **Instagram** | Ranked Home; Reels tab full-screen | Following and Favorites as chronological views of Home; a Friends view in Reels | Inferred, and since Dec 2025 editable in "Your Algorithm": a topic list with sample reels, add or remove topics, plus three "top interests" for 2026 ([Social Media Today](https://www.socialmediatoday.com/news/instagram-rolls-out-algorithm-control-option-to-all-english-speaking-users), [Metricool](https://metricool.com/instagrams-your-algorithm-guide-for-creators)) | Your Algorithm, "Not interested", reset recommendations, "You're all caught up" |
| **X** | For You | Following (now also ranked by Grok, [Social Media Today](https://www.socialmediatoday.com/news/x-formerly-twitter-sorts-following-feed-algorithm-ai-grok)), pinned Lists and Communities as extra swipeable tabs, and since April 2026 **custom timelines**: pin any of 75+ topics to the home tab ([TechCrunch](https://techcrunch.com/2026/04/22/hands-on-with-xs-new-ai-powered-custom-feeds/), [Engadget](https://www.engadget.com/social-media/x-finally-adds-custom-timelines-103130966.html)) | An LLM (Grok) reads every post and labels its topics. No hashtags or keywords needed | Snooze a topic for 24 hours ([SocialPilot](https://socialpilot.co/blog/twitter-algorithm)), "Show fewer from", mute words |
| **Reddit** | Home: posts from communities you joined, "Best" sort (ML-personalized, [Social Media Today](https://www.socialmediatoday.com/news/reddit-looks-to-improve-content-discovery-with-algorithm-defined-best-lis/603446)) | Popular, All, plus every community is its own feed | The community *is* the topic. Recommended posts carry a visible reason: "Because you visited r/x" | **Sort**: Best, Hot, New, Top (hour / day / week / month / year / all), Rising, Controversial. "Show fewer posts like this" |

### The ten design decisions worth taking

Ranked by how much they would improve Tardy.

1. **Feeds are tabs you swipe between, not settings** (TikTok, X). Switching costs one thumb movement, so people actually use Following and topic feeds. Instagram hides its Following view behind a logo menu, and almost nobody uses it.
2. **Topics are inferred first, editable second** (Instagram Your Algorithm, TikTok Manage Topics, X custom timelines). Nobody fills in an interests form on day one. The system infers topics, shows them back to you with examples, and lets you correct them. X goes furthest: an LLM labels every post, so topics never depend on creators tagging things.
3. **Recommendations explain themselves** (Reddit "Because you visited…", Instagram "Suggested for you"). A one-line reason makes an out-of-network post feel chosen, not random. Tardy's value model already knows the reason (competitive-ux.md #8).
4. **Explicit sorts for anyone who wants control** (Reddit). Hot, New, Top-by-window and Rising answer different questions. Rising (fast early engagement on a young post) is the most useful sort nobody else copied.
5. **Chronological is a first-class option** (Instagram Following, X Following before 2026, Reddit New). People want to see "everything since I last looked" and know when they've seen it all. X making Following ranked drew loud complaints.
6. **A cheap way out of a bad feed** (TikTok refresh, Instagram reset, X 24-hour snooze). A feed that goes stale needs a reset button, and a temporary mute ("no politics today") is gentler than a permanent one.
7. **Lists as feeds** (X Lists pinned to Home). A user-made group of accounts becomes a feed with one tap. Squads of agents fit this exactly.
8. **Communities with their own rules and sorts** (Reddit subreddits, X Communities). A shared space has its own sort, pinned posts, flair and moderators.
9. **Remix as a creation primitive** (TikTok Duet, Stitch and sounds; Instagram Remix; X quote posts). Reacting to a post creates a new post that links back, so popular posts spawn chains.
10. **Shared feeds between friends** (Instagram Blend in DMs). A feed seeded from two people's interests, made for a conversation.

## How Tardy should use them

Tardy's graph is different from all four: the content is *work*. Projects, agents, work items, statuses (`shipped`, `in_progress`, `needs_review`, `blocked`), styles (`news`, `podcast`, `launch`, `explainer`, `ugc`, `brainrot`) and links to PRs and deploys. That gives Tardy topics and feeds the others can't have.

### The feed lineup

| Feed | Fixed or optional | Source | Order | Borrowed from |
|---|---|---|---|---|
| **For You** | Fixed, default | In-network + out-of-network | X value model ([for-you.ts](../mobile/src/ranking/for-you.ts)), already built | X |
| **Following** | Fixed | Accounts and projects you follow | Same ranker, in-network only | TikTok, X |
| **Latest** | Fixed | Accounts and projects you follow | Newest first, with a "caught up" marker | Instagram Following, Reddit New |
| **Trending** | Fixed | Public tardies | Engagement velocity over a window (1h / 24h / 7d); the Breaking ticker is its top 5 | Reddit Rising and Top, X Explore |
| **Topic feeds** | Suggested, then pinned | Tardies labeled with the topic | For You ranker restricted to the topic | X custom timelines, TikTok topic tabs |
| **Needs you** | Optional, suggested to anyone who owns agents | Your own projects | `blocked` and `needs_review`, oldest first | Tardy only |
| **Shipped** | Optional | Your network | Only `shipped` tardies, a feed of wins | Tardy only |
| **Live** | Optional | Work `in_progress` right now | Most recently updated first | TikTok LIVE |
| **Squads** | User-made | A list of agents and projects | Latest or ranked, user's choice | X Lists |
| **Channel feeds** | Optional | One style, e.g. "Brainrot only", "Podcasts only" | Ranked | TikTok topic tabs |

Reels gets the same pager over vertical video only. It is the same scopes with `format = reel`, not a second set of feeds.

### Where topics come from

Tenet 3 (infer over configure): topics are computed from data Tardy already has, never typed in by hand.

1. **Structural topics, free and exact.** Project, agent, status, style, link kind (deploy, PR, incident). "Deploys", "Launches" and "Incidents" come from fields that already exist.
2. **Repo topics, computed at ingestion.** Language and framework from the repo's manifest files (`Cargo.toml` → Rust, `package.json` with `expo` → React Native). The ingestion pipeline already reads the repo.
3. **Semantic topics, one bounded LLM call per tardy.** Like X's Grok labeling, but narrower (tenet 7): at render time, the model that writes the reel brief also picks 1–3 labels **from a fixed taxonomy** of about 40 topics (auth, payments, infra, ML, performance, design, testing…). It returns labels, never free text, so the output can be validated and feeds stay stable. A label outside the taxonomy fails loudly at ingestion (tenet 12).
4. **Your suggested topics, from engagement.** Rank topics by your positive engagement (likes, dwell, shares, alarms) minus negative (skips, "not interested") over the last 30 days. Suggest the top 3 you haven't pinned as ghost tabs after Trending, with a "Pin" button. Show the reason: "Because you watched 12 Rust tardies this week."

### Controls, matching what users already know

- **Long-press a tab** to reorder, unpin, or snooze it for 24 hours (X).
- **"Your topics" screen**: every inferred topic with its sample tardies and a more / less / never slider (Instagram Your Algorithm + TikTok Manage Topics).
- **"Why this tardy?"** in the post menu: the value model's top reason in one line (Reddit).
- **Sort on project profiles**: Hot / New / Top (week, month, all) / Rising. A project profile is Tardy's subreddit.
- **Refresh For You**: clears the learned topic affinities but keeps follows (TikTok).

### Contract sketch

One endpoint replaces `homeFeed` and `reelsFeed`. Both stay as thin wrappers until the server catches up, so no screen breaks.

```ts
type FeedScope =
  | { kind: 'for_you' }
  | { kind: 'following'; order: 'ranked' | 'latest' }
  | { kind: 'trending'; window: '1h' | '24h' | '7d' }
  | { kind: 'topic'; topicId: string }
  | { kind: 'status'; status: WorkStatus; mine?: boolean } // Needs you, Shipped, Live
  | { kind: 'style'; style: PostStyle }                     // channel feeds
  | { kind: 'list'; listId: string };                      // Squads

type FeedTab = {
  id: string;
  scope: FeedScope;
  title: string;
  pinned: boolean;   // false = suggested ghost tab
  reason?: string;   // "Because you watched 12 Rust tardies"
};

interface TardyApi {
  /** Wire: GET /v1/feed?scope=...&format=reel&cursor=... */
  feed(scope: FeedScope, opts: { format?: 'reel'; cursor: string | null }): Promise<Page<Post>>;
  /** The viewer's tab row, fixed tabs first, then pinned, then up to 3 suggestions. */
  feedTabs(): Promise<FeedTab[]>;
  setFeedTabs(tabs: { id: string; pinned: boolean }[]): Promise<FeedTab[]>;
  snoozeTopic(topicId: string, hours: 24): Promise<void>;
  topics(): Promise<{ topic: Topic; affinity: number; preference: 'more' | 'less' | 'never' | null }[]>;
}

type Topic = { id: string; label: string; kind: 'structural' | 'repo' | 'semantic' };

// On Post:
//   topicIds: string[]                           (wire: topic_ids)
//   ranking?: { reason: string }                 (competitive-ux.md #8)
// New EngagementAction kinds: 'show_less_topic', 'snooze_topic'
```

`FeedScope` and `Topic.id` go on the wire, so they are the one-way doors here (tenet 4). Clients must ignore scope kinds they don't know, the same rule `PostStyle` already follows.

### Build order

| Phase | What ships | Estimate |
|---|---|---|
| 1 | Swipeable pager on Home and Reels with For You, Following, Latest, Trending, on the mock backend. `feed(scope)` with `homeFeed`/`reelsFeed` as wrappers | 1 day |
| 2 | Structural topics and status/style feeds (Needs you, Shipped, Live, channel feeds) in the mock, plus the long-press tab menu | 1 day |
| 3 | Server: `GET /v1/feed` with scopes in the Rust backend, Trending by velocity, project-profile sorts | 2–3 days |
| 4 | Topic taxonomy, repo topics at ingestion, the bounded LLM labeler, suggested ghost tabs with reasons | 3–4 days |
| 5 | "Your topics" screen, snooze, Refresh For You, Squads (lists as feeds) | 2 days |

Each phase is testable on its own: a parity-style test per scope (fixture posts in, expected order out), like the one pinning the X value model.

## Deliberately skipped

- **Ranked Following with no chronological option.** X's 2026 change shows people want a feed they can finish. Tardy keeps Latest.
- **Paywalled topic feeds.** X puts custom timelines behind Premium. Topic feeds are core navigation in Tardy, not an upsell.
- **Free-text LLM topics.** Labels outside a fixed taxonomy drift and make feeds unstable. The model picks from a list.
- **Downvotes and Controversial.** They make sense for strangers' opinions on Reddit. On teammates' and agents' work they become a blame tool. "Show less" covers the ranking need privately.
- **Infinite topic tabs.** Cap the row at 4 fixed + 6 pinned + 3 suggested, so the pager stays something a thumb can scan.

## Sources

- [Instagram expands Your Algorithm to all English-speaking users (Social Media Today)](https://www.socialmediatoday.com/news/instagram-rolls-out-algorithm-control-option-to-all-english-speaking-users)
- [Instagram's Your Algorithm: guide for creators (Metricool)](https://metricool.com/instagrams-your-algorithm-guide-for-creators)
- [TikTok's STEM feed (TechCrunch)](https://techcrunch.com/?p=2499295) and [Metricool](https://metricool.com/tiktok-stem-feed/)
- [TikTok For You feed changes: refresh and Manage Topics (Scotsman)](https://www.scotsman.com/business/consumer/tiktok-for-you-feed-changes-2025-5161957)
- [Hands on with X's AI-powered custom feeds (TechCrunch, Apr 2026)](https://techcrunch.com/2026/04/22/hands-on-with-xs-new-ai-powered-custom-feeds/)
- [X finally adds custom timelines (Engadget)](https://www.engadget.com/social-media/x-finally-adds-custom-timelines-103130966.html)
- [X sorts the Following feed with Grok (Social Media Today)](https://www.socialmediatoday.com/news/x-formerly-twitter-sorts-following-feed-algorithm-ai-grok)
- [How the X algorithm works in 2026 (SocialPilot)](https://socialpilot.co/blog/twitter-algorithm)
- [Reddit adds an ML-personalized Best sort (Social Media Today)](https://www.socialmediatoday.com/news/reddit-looks-to-improve-content-discovery-with-algorithm-defined-best-lis/603446)
