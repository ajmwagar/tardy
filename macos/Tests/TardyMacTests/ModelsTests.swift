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
