import Testing
import Foundation
@testable import TardyMac

@Test func compactProjectionOnlyCollapsesLongReplies() {
    let source = "A useful reply 🟡\nwith details"
    #expect(!ChatProjection.needsExpansion(source))
    #expect(!ChatProjection.needsExpansion(String(repeating: "🟡", count: 480)))
    #expect(ChatProjection.needsExpansion(String(repeating: "🟡", count: 481)))
}

@Test func attachmentIndexPreservesOccurrencesAndMessageTargets() throws {
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    let messageId = UUID()
    let conversationId = UUID()
    let profileId = UUID()
    let assetId = UUID()
    func decode(_ id: UUID, sequence: Int) throws -> Message {
        let object: [String: Any] = ["id": id.uuidString, "conversation_id": conversationId.uuidString, "sequence": sequence,
            "sender_profile_id": profileId.uuidString, "body": "Shared photo", "created_at": "2026-10-05T00:00:00Z",
            "media": [["asset_id": assetId.uuidString, "type": "image", "url": "https://tardy.test/image", "content_type": "image/png", "byte_length": 10]]]
        return try decoder.decode(Message.self, from: JSONSerialization.data(withJSONObject: object))
    }
    let newer = UUID()
    let items = ChatAttachment.index([try decode(messageId, sequence: 1), try decode(newer, sequence: 2)])
    #expect(items.map(\.messageId) == [newer, messageId])
    #expect(Set(items.map(\.id)).count == 2)
    #expect(ChatAttachment.index([]).isEmpty)
}

@Test func fencedCodeDoesNotAccidentallyBecomeATable() {
    #expect(MarkdownBlocks.parse("```rust\nlet a = x | y;\n```\nDone") == [
        .code(language: "rust", source: "let a = x | y;"), .prose("Done")
    ])
    #expect(MarkdownBlocks.parse("```\npartial") == [.code(language: "", source: "partial")])
}
