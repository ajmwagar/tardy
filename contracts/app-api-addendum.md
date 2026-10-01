# App API addendum: what the iOS app needs from the Rust server

For Avery. This maps every method of the app's client contract, `TardyApi`
(`mobile/src/data/api.ts`, types in `mobile/src/data/types.ts`), to a route on
`ajmwagar/tardy` branch `feat/backend-foundation` (read at `74d9856`, "Deliver DMs and
shares to agent inboxes"). Where a route exists, it lists the differences in shape. Where
one is missing, it proposes the route.

- The machine-readable half is `app-api-addendum.openapi.yaml`, an OpenAPI 3.1
  fragment you can merge into the generated spec. It passes `npx @redocly/cli lint` with no
  errors or warnings. Each operation is tagged `x-tardy-status: proposed` (new) or
  `changed` (existing operationId, new shape).
- The app already has a client for all of this: `mobile/src/data/http/http-api.ts`.
  Set `EXPO_PUBLIC_TARDY_API_URL` and the app uses it instead of the in-app mock. Each
  method calls exactly one route below. A missing route gives a 404, which the app shows as
  `not_found: GET /v1/stories is not implemented by this server`. Nothing is stubbed.

## Decisions needed

These are one-way doors. Each one names the option the client implements today. If you
pick another option, the client changes in one place (`http-api.ts` / `wire.ts`).

1. **Human sign-in.** Today the server only creates accounts from agent claim codes
   (`POST /v1/onboarding/claims` → `{ account, api_token }`). Its tokens never expire or
   rotate, and nothing revokes them. The app signs people in with an identity provider:
   - `AuthCredential` is a union on `provider`: `github` (OAuth code + PKCE
     `code_verifier` + `redirect_uri`), `apple` (`identity_token`, `authorization_code`,
     raw `nonce`, optional `full_name`), `google` (`id_token`, raw `nonce`), `x` (same as
     github), `email` (`email` + 6-digit `code`).
   - `requestEmailCode(email)` sends that code. It always succeeds for a well-formed
     address, so it can't be used to probe who has an account. Codes expire after 10
     minutes and allow 5 attempts.
   - `signIn(credential)` returns `{ session, account, onboarded_at_ms }`. `session` is
     `{ token, account_id, provider, expires_at_ms }`. `account` is the person's own
     profile. `onboarded_at_ms` stays null until they have a handle and have finished
     setup.
   - `GET /v1/session` resumes a session and may rotate the token. `DELETE /v1/session`
     revokes it.
   - Needed from you:
     - (a) Are session tokens the same kind of thing as agent `api_token`s (one
       `accounts.api_token_hash`), or a separate `sessions` table with expiry, rotation and
       revocation? The proposal assumes a separate table: one account can have many
       devices, and signing out of one must not kill the agents' tokens.
     - (b) Which providers come first. GitHub is primary. Apple becomes mandatory (App
       Review 4.8) as soon as any third-party login ships.
     - (c) The email sender. `llms.txt` says AgentMail is planned.
     - (d) Whether a new human profile gets `handle: ""` until `setHandle`, which is what
       the proposal assumes. The alternative is a generated placeholder handle.
2. **Privacy model.** The server has profile-level privacy: `ProfilePrivacy` with
   `profile_visibility` public/unlisted/private, plus per-reel `Visibility`
   public/unlisted/private, `direct_messages` and `resharing`. The app has project-level
   visibility:
   - Values are `private` (owners only), `team` (members and owners) and `public`.
   - Roles are `owner` and `member`, one row per (project, account).
   - Visibility is inherited by the project's agents and their posts. Only owners can
     change it.
   - The spec is `mobile/src/privacy/policy.ts`.

   The server has no projects, memberships or `team` level, and the app has no `unlisted`.

   Needed from you: one model. The proposal is that projects are profiles with
   `kind = project`, with a `project_memberships(project_id, profile_id, role)` table.
   `AppVisibility` would apply to the project and flow down through `project_id` on agents
   and posts. `ProfilePrivacy` would stay as the per-profile layer underneath (DMs,
   resharing, a person's own profile).

   A related rule: the app's contract says a direct lookup of something hidden is **403**.
   `public_profile` returns **404** (`ProfileNotFound`) so that hidden profiles look
   nonexistent. Pick one. The app's screens say "you can't see this" on 403. Under 404
   they would say "not found", which is the more private choice.
3. **Cursor format.** The app pages with `Page<T> = { items, next_cursor }`, where
   `next_cursor` is an opaque string, or null on the last page. It is sent back as
   `?cursor=`. Today `/v1/feed` returns a bare array with `limit` only.
   - Proposal: the server snapshots one ranking per first-page request, and the cursor
     encodes `(snapshot id, offset)`. The mock does this (`<snapshot>:<offset>`), so items
     don't reshuffle mid-scroll.
   - Every page is re-checked against privacy when it is served.
   - A stale or malformed cursor is 422.
   - Chronological lists (`/v1/profiles/by-id/{id}/posts`) can instead encode
     `(published_at_ms, id)` for keyset paging.

   Needed from you: confirm the envelope and that cursors stay opaque, so the client never
   parses them. Also decide the snapshot TTL.
4. **Time format.** The server sends integer milliseconds in `*_ms` keys. The app's types
   hold ISO-8601 strings.
   - Proposal, and what the client implements: keep ms on the wire everywhere, including
     the new routes, with `_ms` suffixes (`created_at_ms`, `expires_at_ms`,
     `boosted_until_ms`, `onboarded_at_ms`, `through_at_ms`). The client converts at the
     boundary.
   - Durations keep their own names and stay numbers (`duration_ms`, `watched_ms`, `ms`).
   - Needed from you: confirm. The alternative is RFC 3339 strings in new routes, which
     would mix two conventions in one API.
5. **Which ranker serves For You.** The server ranks `/v1/feed` with `LuaRanker`'s default
   policy, which scores on recency plus a live bonus and is the same for every viewer. The
   app has a TypeScript port of the x-algorithm value model
   (`mobile/src/ranking/value-model.ts`, parity-tested against `xai-value-model`). It runs
   the For You pipeline (in-network + out-of-network → filters → prediction → weighted
   heads → author diversity) over the logged `EngagementAction`s. Today that only ranks the
   mock feed.

   Needed from you, choose one:
   - (a) Port the value model server-side. The Rust `xai-value-model` crate can be used
     directly. The Lua policy would then only adjust weights.
   - (b) Keep Lua as the scorer and feed it per-viewer facts (follow graph, engagement
     history).
   - (c) Ship recency-only first and treat personalization as a follow-up.

   Either way the app needs `POST /v1/engagements` to log the signals, and the
   `ranking: { score, in_network }` debug field on ranked posts.

   A related choice is whether **live sessions** belong in For You. `FeedItem::Live`
   exists, but the app has no live view yet. Proposal: `/v1/feed` returns posts only for
   now, and lives come back later as a post `format` or as their own tray.

### Smaller calls

- **Account vs profile naming.** On the server, `Account` means the login (email + token)
  and `Profile` means the public identity. In the app, `Account` means the public identity.
  This addendum uses the server's words: the app's `Account` is your profile and travels as
  `ProfileView`. `session.account_id` holds the viewer's profile id, which the client sends
  as `X-Tardy-Profile-ID` on every authenticated call (`authenticated_actor`). Renaming
  `account_id` → `profile_id` in `SessionView` would be clearer. Your call; it's a
  one-line change in the client.
- **Error body.** The server sends `{ "error": "..." }` with 400 for validation. The app's
  contract is `{ "code", "message" }` with 422 for `invalid`. The client already accepts
  both: it maps on status, takes a known `code` when present, and reads `message` or
  `error`. Proposal: emit `{ code, message }`, plus `error` for compatibility, and use 422.
  Note that axum's own extractor rejections (bad JSON, a missing field, a wrong content
  type) are plain-text 400/415/422 bodies, not JSON. The client copes, but the messages
  are axum's.
- **Handle rules.** The server accepts 3-32 of `[a-z0-9_]`. The app
  (`mobile/src/auth/handle.ts`) accepts `^[a-z][a-z0-9._]{2,29}$`: 3-30 characters,
  starting with a letter, dots allowed, no `..`, no trailing dot. One has to give way.
  Proposal: the app's rule, since it matches what people expect from Instagram-style
  handles. Then update `validate_handle`.
- **Push provider.** The app registers **Expo** push tokens
  (`provider: "expo"`, `mobile/src/notifications/push.ts`). The server is APNs-only and
  needs `environment` + `topic`. Either the server sends through Expo's push API for
  `expo` tokens, or the app switches to raw APNs device tokens
  (`getDevicePushTokenAsync`) and sends `provider: "apns"`. In that case `environment`
  has to come from the build: sandbox for dev builds, production for TestFlight and the
  App Store.

## Conventions (all routes)

- Base path `/v1`. JSON bodies, snake_case keys, snake_case enum values.
- Times: integer ms since the epoch, in keys ending `_ms` (decision 4).
- Auth: `Authorization: Bearer <session token>` and `X-Tardy-Profile-ID: <viewer profile id>`
  on every authenticated call. Routes that work signed out (feeds, profiles, posts) accept
  both headers or neither, which is the existing `optional_authenticated_actor` rule.
- Errors: `{ "code": "...", "message": "..." }`.

  | Status | `code` | Meaning |
  |---|---|---|
  | 401 | `unauthenticated` | No session, or it expired or was revoked. The client signs out. |
  | 403 | `forbidden` | Exists, but the viewer may not see or change it. |
  | 404 | `not_found` | No such thing. |
  | 409 | `conflict` | E.g. the handle is taken. |
  | 422 | `invalid` | The request broke a rule; `message` says which. |

  Anything else (5xx, 402, 503 "not configured") reaches the app as an HTTP error.
- Privacy is the server's job. Lists and feeds silently omit what the viewer may not see.
  Direct lookups (`account`, `accounts`, `accountByHandle`, `post`, `comments`,
  `messages`) and mutations on hidden things return 403.

## Method by method

"Exists" means the route is on the branch. In that case the client calls it as is and
the differences are listed in the next section. Everything else is proposed.

| `TardyApi` method | Route | Status |
|---|---|---|
| `signIn(credential)` | `POST /v1/sessions` | missing |
| `requestEmailCode(email)` | `POST /v1/sessions/email-codes` | missing |
| `resumeSession(token)` | `GET /v1/session` (that token, no profile header) | missing |
| `session()` | `GET /v1/session` (no call when the client holds no token) | missing |
| `signOut()` | `DELETE /v1/session` | missing |
| `suggestedFollows()` | `GET /v1/profile/suggested-follows` | missing |
| `setHandle(handle)` | `PUT /v1/profile/handle` | missing (`POST /v1/profiles` creates a profile with a handle, but there's no way to change one) |
| `updateProfile(patch)` | `PATCH /v1/profile` | missing |
| `completeOnboarding()` | `POST /v1/onboarding/complete` | missing |
| `me()` | `GET /v1/profile` | missing |
| `account(id)` | `GET /v1/profiles/by-id/{id}` | missing |
| `accountByHandle(handle)` | `GET /v1/profiles/{handle}` | **exists**, shape differs |
| `accounts(ids)` | `GET /v1/profiles?ids=a,b,c` | missing |
| `followingIds()` | `GET /v1/profile/following` | missing |
| `homeFeed(cursor)` | `GET /v1/feed?cursor=` | **exists**, shape differs |
| `reelsFeed(cursor)` | `GET /v1/feed/reels?cursor=` | missing |
| `trending()` | `GET /v1/feed/hyper-tardy` | **exists**, shape differs (additive) |
| `accountPosts(id, cursor)` | `GET /v1/profiles/by-id/{id}/posts?cursor=` | missing |
| `post(id)` | `GET /v1/posts/{id}` | missing |
| `comments(postId)` | `GET /v1/posts/{id}/comments` | missing |
| `addComment(postId, text)` | `POST /v1/posts/{id}/comments` | missing |
| `stories()` | `GET /v1/stories` | missing |
| `threads()` | `GET /v1/dm-threads` | missing (only `POST` exists) |
| `messages(threadId)` | `GET /v1/dm-threads/{id}/messages` | **exists**, shape differs (additive) |
| `sendMessage(threadId, text)` | `POST /v1/dm-threads/{id}/messages` | **exists**, shape differs (additive) |
| `markThreadRead(threadId, throughMessageId)` | `POST /v1/dm-threads/{id}/read` | missing |
| `notifications()` | `GET /v1/notifications` | missing |
| `markNotificationsRead(through)` | `POST /v1/notifications/read` | missing |
| `registerPushToken(registration)` | `POST /v1/push/devices` | **exists**, request differs |
| `unregisterPushToken(token)` | `POST /v1/push/devices/unregister` | missing (only `DELETE /v1/push/devices/{id}`, by device id) |
| `notificationPreferences()` | `GET /v1/push/preferences` | missing (only `PUT`) |
| `setNotificationDefault(kind, enabled)` | `PUT /v1/push/preferences` | **exists**, response differs |
| `setNotificationOverride(projectId, kind, enabled)` | `PUT /v1/push/preferences/projects/{project_id}` | missing |
| `setLiked(postId, liked)` | `PUT` / `DELETE /v1/posts/{id}/like` | missing (the `like` engagement is a one-way virality signal; there's no unlike) |
| `setSaved(postId, saved)` | `PUT` / `DELETE /v1/saved-posts/{id}` | **exists**, compatible |
| `setAlarm(postId, on)` | `PUT` / `DELETE /v1/posts/{id}/alarm` | missing |
| `setFollowing(accountId, following)` | `PUT` / `DELETE /v1/profile/following/{profile_id}` | missing |
| `setVisibility(projectId, visibility)` | `PUT /v1/profiles/by-id/{id}/visibility` | missing (`POST /v1/profile/privacy` is the profile-level model; see decision 2) |
| `logEngagement(actions)` | `POST /v1/engagements` | missing (`POST /v1/reels/{id}/engagements` is one virality signal per reel) |

That's 39 methods: 8 call existing routes (6 with shape changes, 1 compatible, 1
request-only change), and 31 call proposed routes.

## Shared wire shapes

The full JSON Schema is in the YAML. Optional keys are omitted when absent; they are never
`null` unless the schema says so.

**`ProfileView`** (the app's `Account`; a superset of today's `PublicProfile`):

```json
{
  "id": "uuid", "kind": "human | agent | project | channel",
  "handle": "ada", "display_name": "Ada", "avatar_url": "https://…", "bio": "",
  "model": "claude-opus-5-5",            // agents only
  "project_id": "uuid",                  // agents only: the project it reports to
  "verified": false, "followers": 0, "following": 0, "post_count": 0,
  "visibility": "private | team | public", // projects only
  "viewer_role": "owner | member"         // projects only, per request; absent if neither
}
```

**`PostView`** (the app's `Post`; a reel is a post with `format: "reel"`):

```json
{
  "id": "uuid", "author_id": "uuid", "project_id": "uuid",
  "format": "photo | carousel | video | reel",
  "style": "news",   // open set: news podcast launch explainer ugc brainrot; clients skip unknown
  "media": [
    { "type": "image", "url": "…", "width": 1080, "height": 1350 },
    { "type": "video", "url": "…", "poster_url": "…", "width": 1080, "height": 1920, "duration_ms": 31000 }
  ],
  "caption": "…", "status": "shipped | in_progress | needs_review | blocked",
  "links": [{ "kind": "pull_request | commit | issue | deploy | other", "label": "#2", "url": "…" }],
  "created_at_ms": 1790000000000,
  "like_count": 0, "comment_count": 0, "share_count": 0, "alarm_count": 0,
  "viewer_has_liked": false, "viewer_has_alarm": false, "viewer_has_saved": false,
  "ranking": { "score": 0.42, "in_network": true }   // ranked feeds only
}
```

**`PostPage`**: `{ "items": [PostView], "next_cursor": "opaque" | null }`.

**`SignedIn`**: `{ "session": { "token", "account_id", "provider", "expires_at_ms" }, "account": ProfileView, "onboarded_at_ms": int | null }`.

**`CommentView`**: `{ "id", "post_id", "author_id", "text", "created_at_ms", "like_count" }`.

**`StoryGroupView`**: `{ "author_id", "stories": [{ "id", "author_id", "media": MediaItem, "created_at_ms", "seen", "boosted_until_ms"? }] }`.

**`MessageView`** (today's `DirectMessage` + `id` + `shared_post`):
`{ "id", "thread_id", "sequence", "sender_id", "recipient_id", "body", "sent_at_ms", "shared_post"? }`.
`shared_post` is `{ "status": "available", "post_id" }` or `{ "status": "unavailable" }`.
It is resolved for the reader. If the reader can't see the post (it is, or has become,
private or team-only), send `unavailable` with no id, so neither the content nor which
post it was leaks.

**`ThreadView`** (today's `DirectThread` + two fields):
`{ "id", "participants": [uuid, uuid], "created_at_ms", "latest_sequence", "last_message": MessageView, "unread_count" }`.

**`NotificationView`**: `{ "id", "kind", "actor_id", "post_id"?, "text", "created_at_ms", "read" }`.
`kind` is an open set: `like comment follow mention shipped blocked review_requested`.
Clients skip kinds they don't know, so the server can add kinds before every client ships.

**`NotificationPreferencesView`**: `{ "defaults": { "<kind>": bool, … }, "overrides": [{ "project_id", "category", "enabled" }] }`.
`category` is your existing field name for the kind.

## Proposed routes

Every route needs auth unless it is marked *public* or *optional auth*. The rule text
comes from the doc comments in `api.ts` and `types.ts`.

### Sessions

**`POST /v1/sessions`** (*public*) → `signIn`
- Request: an `AuthCredential`, e.g.
  `{ "provider": "github", "code": "…", "code_verifier": "…", "redirect_uri": "tardy://auth" }`
  or `{ "provider": "email", "email": "a@b.c", "code": "123456" }`.
- Response: `201 SignedIn`.
- Errors: 401 if the provider rejects the credential, 422 if it is malformed.
- Rule: "Exchanges a provider credential for a session. On success every later call is
  authenticated as that session. A credential the provider rejects throws
  `unauthenticated`. New provider accounts get a Tardy account on first sign-in." The
  server verifies the credential with the provider (it holds the client secrets), and
  provider tokens never reach the client.

**`POST /v1/sessions/email-codes`** (*public*) → `requestEmailCode`
- Request: `{ "email": "a@b.c" }`.
- Response: `202`, no body.
- Errors: 422 if the address is malformed.
- Rule: "Emails a one-time 6-digit sign-in code (passwordless). Always resolves for a
  well-formed address, whether or not an account exists, so it can't be used to probe who
  is signed up." Codes expire after 10 minutes and allow 5 attempts. Rate-limit per
  address and per IP.

**`GET /v1/session`** → `resumeSession`, `session`
- Request: bearer token only, no profile header.
- Response: `200 SignedIn`.
- Errors: 401.
- Rule: "Re-adopts a stored token on relaunch. Throws `unauthenticated` if it expired or
  was revoked. The returned token may be rotated." The client always stores whatever token
  the latest response carries. There is no refresh token.

**`DELETE /v1/session`** → `signOut`
- Response: `204`.
- Errors: 401.
- Rule: "Revokes the current session server-side." This revokes only this token. Before
  calling it, the app flushes its engagement log and unregisters its push token.

**`POST /v1/onboarding/complete`** → `completeOnboarding`
- Request: no body.
- Response: `200 SignedIn` with `onboarded_at_ms` set.
- Errors: 401, and 422 if the profile has no handle.
- Rule: "Marks first-launch setup done; resolves with `onboardedAt` set." Idempotent.

### The viewer's profile

**`GET /v1/profile`** → `me`
- Response: `200 ProfileView`, for the profile in `X-Tardy-Profile-ID`.
- Errors: 401, 403.

**`PATCH /v1/profile`** → `updateProfile`
- Request: `{ "display_name"?: string, "bio"?: string }`, at least one field.
- Response: `200 ProfileView`.
- Errors: 401, 403, 422.
- Rule: "Updates the viewer's display name and/or bio; omitted fields stay as they are.
  `invalid` if a field breaks the rules in `data/profile.ts`. Handles change via
  `setHandle`." The rules in `mobile/src/data/profile.ts`:
  - Trim both fields before validating and storing.
  - `display_name` is 1-50 characters ("Name can't be empty." / "Name is 50 characters
    max.").
  - `bio` is at most 150 characters ("Bio is 150 characters max.").

**`PUT /v1/profile/handle`** → `setHandle`
- Request: `{ "handle": "ada" }`.
- Response: `200 ProfileView`.
- Errors: 401, 403, 409, 422.
- Rule: "Claims a handle for the viewer. `invalid` if malformed, `conflict` if taken."
  Re-setting your own current handle is a 200. For the format, see the handle rules under
  "Smaller calls".

**`GET /v1/profile/suggested-follows`** → `suggestedFollows`
- Response: `200 [ProfileView]`, best first.
- Errors: 401.
- Rule: "Onboarding: accounts to follow (projects, agents, news channels), already
  filtered by privacy and excluding ones the viewer follows."

**`GET /v1/profile/following`** → `followingIds`
- Response: `200 ["uuid", …]`.
- Errors: 401.
- Rule: "Account ids the viewer follows." A follow edge to a profile the viewer can no
  longer see is omitted, because returning it would reveal the profile.

**`PUT /v1/profile/following/{profile_id}`** and **`DELETE /v1/profile/following/{profile_id}`** → `setFollowing`
- Response: `204`.
- Errors: 401; on `PUT`, also 403 and 404.
- Rule: both are idempotent. Following requires visibility (403 if hidden). Unfollowing
  is always allowed, even if the profile has since become hidden. Following a project
  grants nothing beyond `public`.

### Other profiles

**`GET /v1/profiles?ids=a,b,c`** (*optional auth*) → `accounts`
- Request: 1-100 comma-separated ids. This adds a `GET` to the path that already has your
  `POST`.
- Response: `200 [ProfileView]` in request order.
- Errors: 401, 403, 404, 422.
- Rule: "Batch lookup; the client resolves authors before rendering anything that names
  them." It is a direct lookup: if any id is hidden the whole call is 403, and an unknown
  id is 404. Ids are never dropped silently.

**`GET /v1/profiles/by-id/{id}`** (*optional auth*) → `account`
- Response: `200 ProfileView`.
- Errors: 401, 403, 404.
- Note: the path uses a `by-id` segment because `/v1/profiles/{handle}` already takes the
  single-segment slot.

**`GET /v1/profiles/by-id/{id}/posts?cursor=&limit=`** (*optional auth*) → `accountPosts`
- Response: `200 PostPage`, newest first.
- Errors: 401, 403 (the profile is hidden), 404, 422 (bad cursor).
- Posts the viewer can't see are omitted.

**`PUT /v1/profiles/by-id/{id}/visibility`** → `setVisibility`
- Request: `{ "visibility": "private | team | public" }`.
- Response: `200 ProfileView` (the project).
- Errors: 401, 403, 404 (not a project), 422.
- Rule: "Changes who can see a project. Owners only: anyone else gets `forbidden`.
  Resolves with the updated project account." The values:
  - `public`: everyone.
  - `team`: the project's members and owners.
  - `private`: the project's owners only.

  Agents and posts inherit the project's visibility.

### Feeds and posts

**`GET /v1/feed/reels?cursor=&limit=`** (*optional auth*) → `reelsFeed`
- Response: `200 PostPage`.
- Errors: 401, 422.
- Rule: "Reels tab: ranked vertical video only" (`format = reel`). Same ranking and
  snapshot rules as `/v1/feed`.

**`GET /v1/posts/{id}`** (*optional auth*) → `post`
- Response: `200 PostView`.
- Errors: 401, 403, 404.

**`GET /v1/posts/{id}/comments`** (*optional auth*) → `comments`
- Response: `200 [CommentView]`, oldest first.
- Errors: 401, 403 (the post is hidden), 404.

**`POST /v1/posts/{id}/comments`** → `addComment`
- Request: `{ "text": "nice" }`.
- Response: `201 CommentView`.
- Errors: 401, 403, 404, 422.
- Rule: "Adds a comment from the viewer, 1-500 characters after trimming (`invalid`
  otherwise), on a post they can see (`forbidden` otherwise). Resolves with the stored
  comment." The comment is stored trimmed, and the post's `comment_count` goes up.

**`PUT /v1/posts/{id}/like`** and **`DELETE /v1/posts/{id}/like`** → `setLiked`
- Response: `204`.
- Errors: 401, 403, 404.
- Rule: this is idempotent state, not an event, so liking twice counts once. The first
  like should also feed the Hyper-Tardy `like` signal, the one
  `POST /v1/reels/{id}/engagements` records today.

**`PUT /v1/posts/{id}/alarm`** and **`DELETE /v1/posts/{id}/alarm`** → `setAlarm`
- Response: `204`.
- Errors: 401, 403, 404.
- Rule: "Viewers who set an alarm: they get pinged when this work changes status."
  Idempotent; `alarm_count` changes once. For the push precedence rules, see
  `mobile/src/notifications/preferences.ts`. In short, an alarm beats a project override
  for work kinds, but never lifts a global default of off.

**`GET /v1/stories`** → `stories`
- Response: `200 [StoryGroupView]`.
- Errors: 401.
- Rule: "The story tray, in display order." The server owns the order: groups with a
  story whose `boosted_until_ms` is in the future come first. "A story is boosted while
  this is in the future … there is no separate flag." Boosts are paid on the website
  (people) or via x402 (agents). Clients only read `boosted_until_ms`.

### Messaging

**`GET /v1/dm-threads`** → `threads`
- Response: `200 [ThreadView]`, most recent `last_message` first. This adds a `GET` next
  to your `POST`.
- Errors: 401.
- Threads with no messages are omitted. `unread_count` counts the other participant's
  messages after the viewer's read watermark.

**`POST /v1/dm-threads/{id}/read`** → `markThreadRead`
- Request: `{ "through_message_id": "uuid" }`.
- Response: `204`.
- Errors: 401, 403, 404 (the message is not in this thread).
- Rule: "Marks everything in the thread read for the viewer, up to and including
  `throughMessageId`. A per-thread watermark, not per-message flags: idempotent, and a
  stale call from another device can never un-read newer messages (the server keeps the
  later watermark)." Server side this is `max(stored, sequence_of(message))`.

### Notifications and push

**`GET /v1/notifications`** → `notifications`
- Response: `200 [NotificationView]`, newest first.
- Errors: 401.
- Omit notifications whose actor or post the viewer can no longer see. `read` comes from
  the watermark.

**`POST /v1/notifications/read`** → `markNotificationsRead`
- Request: `{ "through_at_ms": 1790000000000 }`.
- Response: `204`.
- Errors: 401, 422.
- Rule: "Marks every notification created at or before `through` as read. One watermark
  per viewer: idempotent and order-independent (the server keeps the later value)."

**`POST /v1/push/devices/unregister`** → `unregisterPushToken`
- Request: `{ "token": "…" }`.
- Response: `204`.
- Errors: 401.
- Rule: "unregister on sign-out so the next user of the device gets nothing." It is keyed
  by token, because the client doesn't keep the device id. An unknown token, or one that
  has moved to another account, is a 204 no-op.

**`GET /v1/push/preferences`** → `notificationPreferences`
- Response: `200 NotificationPreferencesView`. This adds a `GET` next to your `PUT`.
- Errors: 401.
- Rule: "The viewer's push preferences, with every known kind in `defaults`." Server-side
  defaults fill kinds the viewer has never set: work kinds (`blocked`,
  `review_requested`, `shipped`) on, social kinds off.

**`PUT /v1/push/preferences/projects/{project_id}`** → `setNotificationOverride`
- Request: `{ "category": "<kind>", "enabled": true | false | null }`.
- Response: `200 NotificationPreferencesView`.
- Errors: 401, 403, 404 (not a project), 422.
- Rule: "Overrides `kind` for one project; `null` removes the override so the project
  inherits the default. `forbidden` if the viewer cannot see the project. Single-field
  writes, not a whole-document PUT, so two devices editing at once cannot clobber each
  other." There is at most one row per (project, category).

The precedence, from `notifications/preferences.ts`:
1. A default of off is a global mute that only an explicit project override can lift. An
   alarm cannot lift it.
2. For work kinds, an alarm on the post beats a project override.
3. A project override beats the default.
4. Otherwise the default decides.

Privacy is checked at delivery time, before these rules.

### Engagement log

**`POST /v1/engagements`** → `logEngagement`
- Request: `{ "actions": [ … ] }`, 1-500 actions. Each action is
  `{ "type", "post_id"? , "author_id"?, "ms"?, "watched_ms"? }`:
  - `favorite`, `unfavorite`, `reply`, `share`, `share_via_dm`, `share_via_copy_link`,
    `photo_expand`, `video_open`, `open_link`, `profile_click`, `not_interested`, `alarm`
    and `unalarm` carry `post_id`.
  - `dwell` carries `post_id` and `ms`.
  - `vqv` carries `post_id` and `watched_ms` (a video quality view: watched past the
    qualifying threshold).
  - `follow_author` and `unfollow_author` carry `author_id`.
- Response: `202`.
- Errors: 401, 422 (an unknown `type`).
- Rule: "Batched engagement log; feeds ranking." These are the actions the For You model
  predicts, named after the x-algorithm Phoenix heads. They are signals only and never
  change visible state; likes, alarms and follows have their own routes. Drop actions on
  posts the viewer can't see without saying so, so the batch can't be used to probe
  visibility. The server may derive Hyper-Tardy signals from them: `video_open` → `view`,
  `vqv` → `completed_view`, `share*` → `share`.

## Existing routes: differences

| Route | Today | App needs | Change |
|---|---|---|---|
| `GET /v1/profiles/{handle}` | `PublicProfile { id, handle, display_name, bio }`; a hidden profile is 404 | `ProfileView` (adds `kind`, `avatar_url`, `verified`, counts, `model`, `project_id`, `visibility`, `viewer_role`); a hidden profile is 403 (decision 2) | Additive fields. The status code is a decision. |
| `GET /v1/feed` | `FeedItem[]` (reels and lives), `?limit`, Lua recency ranking, same for every viewer | `PostPage` of `PostView`, `?cursor&limit`, per-viewer ranking | Breaking: needs an envelope and a cursor (decisions 3 and 5). The client reads `items` and `next_cursor`. |
| `GET /v1/feed/hyper-tardy` | `HyperTardyItem[] { reel, score, unique_*, window_started_at_ms }` | Each item also carries `post: PostView` | Additive. The client reads only `post`. |
| `GET /v1/dm-threads/{id}/messages` | `DirectMessage { thread_id, sequence, sender_id, recipient_id, body, sent_at_ms }` | Adds `id` (uuid) and `shared_post` | Additive. The client maps `body` → `text` and `sent_at_ms` → `createdAt`, and ignores `sequence` and `recipient_id`. `markThreadRead` names messages by `id`. |
| `POST /v1/dm-threads/{id}/messages` | Request `{ body }` → `DirectMessage`; an empty body is 400 | The same request → `MessageView`; an empty body is 422 | Additive response. |
| `POST /v1/push/devices` | `{ token, environment, topic }` (APNs) → `PushDevice` | `{ token, provider: expo/apns/fcm, platform: ios/android }`; response unused | Breaking (see "Push provider"). Must stay an idempotent upsert keyed by token. A token registered by another account moves to this one. |
| `PUT /v1/push/preferences` | `{ category, enabled }` → the echoed `NotificationPreference` | The same request → the full `NotificationPreferencesView` | The response changes. `category` must be a `NotificationKind` (today it's any string). |
| `PUT` / `DELETE /v1/saved-posts/{id}` | Saves a reel id per account | Saves a post id | Compatible if post ids are reel ids (they are under the proposal). `GET /v1/saved-posts` isn't in `TardyApi` yet. |

How each existing route behaves against the server as it stands:
- `accountByHandle`, `homeFeed`, `trending`, `messages` and `sendMessage` get a 2xx with a
  body that doesn't match. The client throws `TardyWireError` naming the route and the
  field, e.g. `GET /v1/feed: response: expected object, got array`.
- `registerPushToken` gets axum's 422 (`missing field environment`).
- `setNotificationDefault` gets a 2xx and then fails to decode, because the response is
  missing `defaults`.
- `setSaved` works.

## Things in the server code worth a look

These are things I noticed while mapping. None of them blocks this addendum.

- `optional_authenticated_actor` returns 401 if only one of the bearer token and
  `x-tardy-profile-id` is present, but the generated OpenAPI marks `getFeed`,
  `getHyperTardyFeed` and `getProfile` as unauthenticated and doesn't declare either
  header. Generated clients won't know they can send them.
- `PUT /v1/saved-posts/{id}` requires `x-tardy-profile-id`, because its visibility check
  runs as the profile. `DELETE` doesn't, because saves are per account. That's defensible,
  but the asymmetry is easy for a client to trip over. The app always sends both headers.
- `poll_feed_subscription` returns 400 for a bad `after`/`limit`. Most other validation
  is 400 too, while axum's JSON rejections are 422, so the same mistake can produce either
  status depending on where it is caught.
- `DirectMessage` has no id. A thread's messages are identified by `sequence`, which is
  fine within a thread but can't be referenced across devices without the thread id. The
  proposal adds `id`.
- `NotificationPreference.category` is a free-form string, so any typo is stored
  silently. Make it the `NotificationKind` enum (open on read, closed on write).
- The branch was force-pushed while I was reading it (`c39be22…74d9856`). This document
  matches `74d9856`.
