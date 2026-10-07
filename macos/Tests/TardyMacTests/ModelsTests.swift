import Foundation
import Testing
@testable import TardyMac

@Test func messageDecodesWhenServerOmitsEmptyCollections() throws {
    let json = Data(#"{"id":"41782c9a-19c6-4eab-80fb-ef2cc89e87b9","conversation_id":"650ffada-b502-4565-86cb-b3331e25bb4e","sequence":19,"sender_profile_id":"8ca1e470-bad0-4fec-a0da-7fc1945fbd5b","body":"Attached `mobile/METRICS.md`.","shared_link_id":null,"created_at":"2026-10-02T12:25:09.744290Z"}"#.utf8)
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase

    let message = try decoder.decode(Message.self, from: json)

    #expect(message.media.isEmpty)
    #expect(message.reactions.isEmpty)
    #expect(message.readBy.isEmpty)
}

@Test func reelPageDecodesFromPostgresWireShape() throws {
    let json = Data(#"{"items":[{"alarm_count":0,"author_id":"e8b8889f-8c4b-5e48-e614-2f189cbf90a0","caption":"One week of building Tardy.","comment_count":1,"created_at_ms":1790905693799,"format":"reel","id":"10000000-0000-0000-0000-000000000001","like_count":1,"links":[],"media":[{"duration_ms":32000,"height":1920,"poster_url":"https://example.test/poster.jpg","type":"video","url":"https://example.test/reel.mp4","width":1080}],"repost_count":0,"share_count":0,"viewer_has_alarm":false,"viewer_has_liked":false,"viewer_has_reposted":false,"viewer_has_saved":false}],"next_cursor":null}"#.utf8)
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase

    let page = try decoder.decode(PostPage.self, from: json)

    #expect(page.items.count == 1)
    #expect(page.items[0].primaryMedia?.durationMs == 32_000)
    #expect(page.items[0].commentCount == 1)
}

@Test func feedArticleDecodesWithoutVideoMedia() throws {
    let json = Data(##"{"alarm_count":0,"author_id":"e8b8889f-8c4b-5e48-e614-2f189cbf90a0","caption":"Summary","article":{"title":"Evidence","markdown":"# Result","html":"<h1>Result</h1>"},"comment_count":0,"created_at_ms":1790905693799,"format":"article","id":"10000000-0000-0000-0000-000000000001","like_count":0,"media":[],"repost_count":0,"share_count":0,"viewer_has_alarm":false,"viewer_has_liked":false,"viewer_has_reposted":false,"viewer_has_saved":false}"##.utf8)
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    let post = try decoder.decode(TardyPost.self, from: json)
    #expect(post.article?.markdown == "# Result")
    #expect(post.format == "article")
    #expect(post.primaryMedia == nil)
}

@Test func commentDecodesWithoutOptionalEngagementFields() throws {
    let json = Data(#"{"id":"9c6917c9-7a94-4067-8999-0fbf798fe6c3","post_id":"10000000-0000-0000-0000-000000000001","author_profile_id":"a47035bb-b26d-4f1f-8d71-6f9789927868","body":"Stay tardy","mentioned_profile_ids":[],"created_at":"2026-10-02T02:07:58.514543Z"}"#.utf8)
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase

    let comment = try decoder.decode(PostComment.self, from: json)

    #expect(comment.body == "Stay tardy")
    #expect(comment.likeCount == nil)
    #expect(comment.reactions == nil)
}

@Test func conversationUsesExplicitTitle() {
    let id = UUID()
    let conversation = Conversation(id: id, mode: .work, title: "Ship Room", participants: [], lastMessage: nil, unreadCount: 0)
    #expect(conversation.label(accounts: [:], viewer: nil) == "Ship Room")
}

@Test func conversationDerivesParticipantNames() {
    let viewer = UUID()
    let friend = UUID()
    let account = Account(id: friend, kind: .human, handle: "james", displayName: "James", avatarUrl: "", bio: "", verified: false, verificationTier: nil, followers: 0, following: 0, postCount: 0, ownedByViewer: nil)
    let conversation = Conversation(id: UUID(), mode: .dm, title: nil, participants: [viewer, friend], lastMessage: nil, unreadCount: 0)
    #expect(conversation.label(accounts: [friend: account], viewer: viewer) == "James")
}

@Test func twoPersonAgentConversationFindsItsPeer() {
    let viewer = UUID()
    let agentId = UUID()
    let agent = Account(id: agentId, kind: .agent, handle: "codex_avery", displayName: "codex_avery", avatarUrl: "", bio: "", verified: false, verificationTier: nil, followers: 0, following: 0, postCount: 0, ownedByViewer: true)
    let conversation = Conversation(id: UUID(), mode: .work, title: nil, participants: [viewer, agentId], lastMessage: nil, unreadCount: 0)

    #expect(conversation.agentPeer(accounts: [agentId: agent], viewer: viewer)?.id == agentId)
}

@Test func inboxHidesOnlyRedundantEmptyDirectChats() throws {
    let viewer = UUID()
    let friend = UUID()
    let emptyA = Conversation(id: UUID(), mode: .dm, title: nil, participants: [viewer, friend], lastMessage: nil, unreadCount: 0)
    let emptyB = Conversation(id: UUID(), mode: .dm, title: nil, participants: [friend, viewer], lastMessage: nil, unreadCount: 0)
    let group = Conversation(id: UUID(), mode: .dm, title: "Planning", participants: [viewer, friend], lastMessage: nil, unreadCount: 0)

    let collapsed = Conversation.hidingRedundantEmptyDirects([emptyA, emptyB, group])

    #expect(collapsed.map(\.id) == [emptyA.id, group.id])
}

@Test func conversationSSEParserDecodesResumableMessageFrame() throws {
    var parser = ConversationSSEParser()
    let json = #"[{"id":"41782c9a-19c6-4eab-80fb-ef2cc89e87b9","conversation_id":"650ffada-b502-4565-86cb-b3331e25bb4e","sequence":19,"sender_profile_id":"8ca1e470-bad0-4fec-a0da-7fc1945fbd5b","body":"Streaming now","shared_link_id":null,"created_at":"2026-10-02T12:25:09.744290Z"}]"#

    #expect(try parser.consume(line: "id: 19") == nil)
    #expect(try parser.consume(line: "event: messages") == nil)
    #expect(try parser.consume(line: "data: \(json)") == nil)
    let event = try parser.consume(line: "")
    guard case let .messages(messages, cursor) = event else {
        Issue.record("expected a messages event")
        return
    }
    #expect(cursor == 19)
    #expect(messages.count == 1)
    #expect(messages[0].body == "Streaming now")
}

@Test func conversationSSEParserIgnoresKeepAliveAndDecodesTyping() throws {
    var parser = ConversationSSEParser()
    #expect(try parser.consume(line: ": keep-alive") == nil)
    #expect(try parser.consume(line: "event: typing") == nil)
    #expect(try parser.consume(line: "data: [\"8ca1e470-bad0-4fec-a0da-7fc1945fbd5b\"]") == nil)
    let event = try parser.consume(line: "")
    guard case let .typing(ids) = event else {
        Issue.record("expected a typing event")
        return
    }
    #expect(ids == [UUID(uuidString: "8ca1e470-bad0-4fec-a0da-7fc1945fbd5b")!])
}

@Test func conversationSSEParserDecodesAgentDrafts() throws {
    var parser = ConversationSSEParser()
    let json = #"[{"conversation_id":"650ffada-b502-4565-86cb-b3331e25bb4e","sender_profile_id":"8ca1e470-bad0-4fec-a0da-7fc1945fbd5b","body":"Partial **Markdown**","status":"writing","detail":"","activities":[{"id":"cmd-1","kind":"command","title":"Running tests","phase":"running"}],"updated_at":"2026-10-04T22:15:00Z"}]"#
    #expect(try parser.consume(line: "event: drafts") == nil)
    #expect(try parser.consume(line: "data: \(json)") == nil)
    let event = try parser.consume(line: "")
    guard case let .drafts(drafts) = event else {
        Issue.record("expected a drafts event")
        return
    }
    #expect(drafts.count == 1)
    #expect(drafts[0].body == "Partial **Markdown**")
    #expect(drafts[0].status == "writing")
    #expect(drafts[0].activityItems == [ConversationActivity(id: "cmd-1", kind: "command", title: "Running tests", phase: "running")])
}

@Test func conversationSSEParserAcceptsDraftWithoutStructuredActivities() throws {
    var parser = ConversationSSEParser()
    let json = #"[{"conversation_id":"650ffada-b502-4565-86cb-b3331e25bb4e","sender_profile_id":"8ca1e470-bad0-4fec-a0da-7fc1945fbd5b","body":"Older server","status":"writing","detail":"","updated_at":"2026-10-04T22:15:00Z"}]"#
    _ = try parser.consume(line: "event: drafts")
    _ = try parser.consume(line: "data: \(json)")
    guard case let .drafts(drafts) = try parser.consume(line: "") else {
        Issue.record("expected a drafts event")
        return
    }
    #expect(drafts[0].activityItems.isEmpty)
}

@Test func markdownTablesBecomeStructuredBlocks() {
    let blocks = MarkdownBlocks.parse("""
    Here is the comparison:

    | Runtime | State | Latency |
    | :--- | ---: | --- |
    | Codex | live | **fast** |
    | OpenCode | ready | 200 ms |

    More detail follows.
    """)

    #expect(blocks.count == 3)
    #expect(blocks[0] == .prose("Here is the comparison:"))
    #expect(blocks[1] == .table(
        headers: ["Runtime", "State", "Latency"],
        rows: [["Codex", "live", "**fast**"], ["OpenCode", "ready", "200 ms"]]
    ))
    #expect(blocks[2] == .prose("More detail follows."))
}

@Test func escapedPipesStayInsideMarkdownTableCells() {
    let blocks = MarkdownBlocks.parse("""
    | Expression | Meaning |
    | --- | --- |
    | `a \\| b` | union |
    """)
    #expect(blocks == [.table(headers: ["Expression", "Meaning"], rows: [["`a | b`", "union"]])])
}
