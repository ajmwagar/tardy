import Foundation

struct SessionEnvelope: Codable, Sendable {
    let session: Session
    let account: Account
    let onboardedAtMs: UInt64?
}

struct Session: Codable, Sendable {
    let token: String
    let accountId: UUID
    let provider: String
    let expiresAtMs: UInt64
}

struct Account: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let kind: AccountKind
    let handle: String
    let displayName: String
    let avatarUrl: String
    let bio: String
    let verified: Bool
    let verificationTier: String?
    let followers: Int
    let following: Int
    let postCount: Int
    let ownedByViewer: Bool?

    var avatarURL: URL? { URL(string: avatarUrl) }
}

enum AccountKind: String, Codable, Sendable {
    case human, agent, project, channel
}

enum ConversationMode: String, Codable, Sendable {
    case dm, work
}

enum AppDestination: String, CaseIterable, Identifiable, Sendable {
    case reels, messages, profile
    var id: String { rawValue }
}

struct PostPage: Codable, Sendable {
    let items: [TardyPost]
    let nextCursor: String?
}

struct TardyPost: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let authorId: UUID
    let format: String
    let media: [PostMedia]
    let caption: String
    let createdAtMs: UInt64
    var likeCount: Int
    var commentCount: Int
    let shareCount: Int
    let repostCount: Int
    let alarmCount: Int
    var viewerHasLiked: Bool
    var viewerHasSaved: Bool
    let viewerHasReposted: Bool
    let viewerHasAlarm: Bool

    var primaryMedia: PostMedia? { media.first }
}

struct PostMedia: Codable, Hashable, Sendable {
    let type: String
    let url: String
    let posterUrl: String?
    let width: Int
    let height: Int
    let durationMs: Int?

    var remoteURL: URL? { URL(string: url) }
    var posterURL: URL? { posterUrl.flatMap(URL.init(string:)) }
}

struct PostComment: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let postId: UUID
    let authorProfileId: UUID
    let body: String
    let mentionedProfileIds: [UUID]
    let createdAt: String
    let likeCount: Int?
    let reactions: [ReactionSummary]?
}

struct AddCommentRequest: Encodable, Sendable {
    let body: String
    let mentionedProfileIds: [UUID]
}

struct Conversation: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let mode: ConversationMode
    let title: String?
    let participants: [UUID]
    let lastMessage: Message?
    let unreadCount: Int

    func agentPeer(accounts: [UUID: Account], viewer: UUID?) -> Account? {
        guard participants.count == 2 else { return nil }
        return participants
            .filter { $0 != viewer }
            .compactMap { accounts[$0] }
            .first { $0.kind == .agent }
    }

    func label(accounts: [UUID: Account], viewer: UUID?) -> String {
        if let title, !title.isEmpty { return title }
        let names = participants
            .filter { $0 != viewer }
            .compactMap { accounts[$0]?.displayName }
        return names.isEmpty ? "Conversation" : names.joined(separator: ", ")
    }
}

struct Message: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let conversationId: UUID
    let sequence: Int
    let senderProfileId: UUID
    let body: String
    let sharedLinkId: UUID?
    let media: [MessageMedia]
    let createdAt: String
    let reactions: [ReactionSummary]
    let readBy: [UUID]

    private enum CodingKeys: String, CodingKey {
        case id, conversationId, sequence, senderProfileId, body, sharedLinkId
        case media, createdAt, reactions, readBy
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(UUID.self, forKey: .id)
        conversationId = try values.decode(UUID.self, forKey: .conversationId)
        sequence = try values.decode(Int.self, forKey: .sequence)
        senderProfileId = try values.decode(UUID.self, forKey: .senderProfileId)
        body = try values.decode(String.self, forKey: .body)
        sharedLinkId = try values.decodeIfPresent(UUID.self, forKey: .sharedLinkId)
        media = try values.decodeIfPresent([MessageMedia].self, forKey: .media) ?? []
        createdAt = try values.decode(String.self, forKey: .createdAt)
        reactions = try values.decodeIfPresent([ReactionSummary].self, forKey: .reactions) ?? []
        readBy = try values.decodeIfPresent([UUID].self, forKey: .readBy) ?? []
    }

    var timestamp: Date? { ISO8601DateFormatter.tardy.date(from: createdAt) }
}

struct MessageMedia: Codable, Identifiable, Hashable, Sendable {
    let assetId: UUID
    let type: String
    let url: String
    let contentType: String
    let byteLength: UInt64
    let width: UInt32?
    let height: UInt32?
    let fileName: String?
    let altText: String?

    var id: UUID { assetId }
    var remoteURL: URL? { URL(string: url) }
}

struct ReactionSummary: Codable, Hashable, Sendable {
    let kind: String
    let accountIds: [UUID]
}

struct SendMessage: Encodable, Sendable {
    let body: String
    let sharedLinkId: UUID?
}

struct ReactionRequest: Encodable, Sendable { let kind: String }
struct SummonRequest: Encodable, Sendable {
    let agentProfileId: UUID
    let includeAnchorShare: Bool
}
struct ReadRequest: Encodable, Sendable { let throughMessageId: UUID }
struct DevelopmentSessionRequest: Encodable, Sendable { let email: String? }

enum Tapback: String, CaseIterable, Sendable {
    case like, love, laugh, emphasize, question, seen, done

    var symbol: String {
        switch self {
        case .like: "hand.thumbsup.fill"
        case .love: "heart.fill"
        case .laugh: "face.smiling.fill"
        case .emphasize: "exclamationmark.bubble.fill"
        case .question: "questionmark.bubble.fill"
        case .seen: "eyes"
        case .done: "checkmark.circle.fill"
        }
    }
}

enum ConversationStreamEvent: Sendable {
    case messages([Message], cursor: Int?)
    case typing([UUID])
}

enum ConversationStreamState: Equatable, Sendable {
    case disconnected, connecting, live, reconnecting
}

extension ISO8601DateFormatter {
    static var tardy: ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }
}
