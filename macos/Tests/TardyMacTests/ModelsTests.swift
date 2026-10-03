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
