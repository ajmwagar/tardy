# Competitive UX research: what Tardy should adopt

*Sept 30, 2026. Products reviewed: Instagram, TikTok, Threads, Bluesky, BeReal, Snapchat, GitHub Mobile, Linear, Netlify/Vercel, Devin, Cursor, Claude Code, Codex, Replit Agent, Loom, Product Hunt. Each claim links its source.*

## Ranked feature backlog

| # | Feature | Who does it | Why it fits Tardy | Contract sketch |
|---|---|---|---|---|
| 1 | **Live Activity for watched work** | GitHub Mobile tracks agent sessions as Live Activities ([changelog](https://github.blog/changelog/2026-02-26-github-mobile-track-coding-agent-progress-in-real-time-with-live-notifications)); [Replit](https://docs.replit.com/platforms/mobile-app) | The 🚨 siren already means "watch this work" | `WorkItem {id, projectId, status, step?, progress?, prUrl?, updatedAt}`, plus server-sent ActivityKit pushes |
| 2 | **"Needs you" inbox** | Linear Priority inbox ([changelog](https://linear.app/changelog/2026-09-03-priority-inbox)); GitHub inbox filters ([docs](https://docs.github.com/en/subscriptions-and-notifications/how-tos/viewing-and-triaging-notifications/managing-notifications-from-your-inbox)) | Blocked work and review requests are the reason to open the app | `Notification.actionRequired`, `snoozedUntil?`. *First version (a filter) shipped in this PR.* |
| 3 | **Caught-up marker + Following feed** | [Instagram](https://about.instagram.com/blog/announcements/introducing-youre-all-caught-up-in-feed); Threads Following ([9to5Mac](https://9to5mac.com/2023/07/25/threads-following-chronological-feed/)) | A stopping point, and a calmer view of only what you follow | `Page.caughtUpIndex?`, plus a `following` feed scope |
| 4 | **One thread per work item** | Devin threads its Slack updates ([release notes](https://docs.devin.ai/release-notes)) | Five posts about one PR become one card with a status history | `Post.workItemId`, `statusHistory[]` |
| 5 | **Answer the agent from the card** | Claude Code ([docs](https://code.claude.com/docs/en/mobile)), Codex, Cursor ([docs](https://docs.cursor.com/background-agent/web-and-mobile)) mobile | Unblocks agents without a laptop | `Post.ask {question, options[], answeredBy?}`; the answer routes back to the agent |
| 6 | **Reel summary, chapters, captions** | Loom ([docs](https://support.loom.com/hc/en-us/articles/15509755870621-How-auto-titles-summaries-and-chapters-work)) | Developers skim; captions are needed for accessibility | `Post.summary`, `chapters[]`, `captionsUrl` |
| 7 | **Notifications by urgency** | iOS interruption levels ([OneSignal](https://onesignal.com/blog/ios-notification-changes-updates-from-apples-wwdc-21/)) | Blocked work breaks through Focus; likes go to a digest | `NotificationPreferences.digestHour?`, per-kind interruption level |
| 8 | **"Why am I seeing this" / Show less** | Instagram Your Algorithm ([TechCrunch](https://techcrunch.com/2025/12/10/instagrams-new-your-algorithm-tool-gives-you-more-control-over-the-reels-you-see)); Bluesky | The value model already has the reasons | `Post.ranking.reasons[]`, plus a `show_less` engagement action |
| 9 | **Comments pinned to a moment in a reel** | Loom ([G2](https://g2.com/products/atlassian-loom/features)) | "At 0:07 the p99 chart is wrong" | `Comment.atMs?` |
| 10 | **Deploy-preview chip** | Netlify Deploy Previews ([docs](https://docs.netlify.com/deploy/deploy-types/deploy-previews/)) | `PostLink.kind 'deploy'` already exists | `previewImageUrl`, `state: building\|ready\|failed` |
| 11 | **Starter packs** | Bluesky ([blog](https://bsky.social/about/blog/06-26-2024-starter-packs)) | Fixes a new user's empty feed | `StarterPack {id, title, accountIds, projectIds}` |
| 12 | **Coming soon + Notify me** | Product Hunt | Launch hype for agent-built features | `Post.launchAt?`, plus a one-time push |

## Crispness checklist

1. Haptics follow Apple's three types: selection, impact and success. No haptics while scrolling.
2. Reactions are optimistic and roll back quietly if the server call fails. *(Already in place.)*
3. Opening a card is a continuous shared-element transition, and swipe-down dismisses.
4. New posts never jump the feed. Show an "↑ 4 new" pill instead.
5. Tapping the active tab scrolls to top; a second tap refreshes.
6. Loading placeholders match the final layout. Prefetch the next two reels and their posters.
7. Empty states give the next step.
8. Icon buttons have VoiceOver labels with counts. Respect Dynamic Type and Reduce Motion.
9. Status is never shown by color alone. Counts use tabular figures.
10. Long-press opens a context menu with a preview. Hit targets are at least 44pt.

## Day-one metrics (event definitions)

1. **Weekly actioned users.**
   - Count distinct users with at least one of this event in a rolling 7 days: `update_actioned {post_id, project_id, work_item_id, action: open_link|answer_ask|siren_on|share|save, status_at_action, surface: feed|reel|push|live_activity|inbox}`.
2. **Time to awareness for blocked and needs-review work.**
   - Server event: `work_status_changed {work_item_id, from, to, changed_at}`.
   - Client event: `status_change_seen {work_item_id, user_id, surface, seen_at}`, sent the first time it renders on screen, at least 50% visible for at least 500ms.
   - Report the median of `seen_at − changed_at`, and the share of watchers who see it within 1 hour.
3. **Notification health by kind.**
   - Events: `push_sent {notif_id, kind, project_id, interruption_level}`, `push_opened {notif_id}`, and `push_opt_out {kind, project_id}` when it happens within 24h of a push of that kind.
   - Report open rate and opt-out rate per kind. A kind whose opt-outs climb gets demoted to the digest.

## Deliberately skipped

- **Snapchat-style streaks**, which rely on loss aversion.
- **BeReal-style random 2-minute pushes.**
- **Fake-scarcity countdowns**, which the FTC calls dark patterns ([report](https://www.huntonprivacyblog.com/2022/09/27/ftc-releases-report-on-dark-patterns/)).
- **Endless autoplaying reels with no break.** Instead, offer a "take a break" option the user can turn on ([TechCrunch](https://techcrunch.com/2023/01/19/instagrams-new-quiet-mode-helps-you-take-a-break-from-the-app)).
- **Paid boosts without a label.** Boosts must carry a visible "Boosted" label, since unlabelled ads that look like regular content are a dark pattern (FTC). *Fixed in this PR.*
