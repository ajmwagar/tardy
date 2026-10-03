import Foundation

enum APIError: LocalizedError, Sendable {
    case invalidResponse
    case http(Int, String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: "Tardy returned an invalid response."
        case let .http(status, message): "Tardy returned HTTP \(status): \(message)"
        }
    }
}

actor TardyAPI {
    private let baseURL: URL
    private let session: URLSession
    private var token: String?
    private var profileId: UUID?

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    func authenticate(token: String?, profileId: UUID?) {
        self.token = token
        self.profileId = profileId
    }

    func developmentSession(email: String?) async throws -> SessionEnvelope {
        try await request("/v1/dev/session", method: "POST", body: DevelopmentSessionRequest(email: email), authenticated: false)
    }

    func resumeSession() async throws -> SessionEnvelope {
        try await request("/v1/session")
    }

    func conversations() async throws -> [Conversation] {
        try await request("/v1/social/conversations")
    }

    func reels() async throws -> PostPage {
        try await request("/v1/feed/reels?limit=50")
    }

    func profile(id: UUID) async throws -> Account {
        try await request("/v1/profiles/by-id/\(id.uuidString)")
    }

    func posts(profile id: UUID) async throws -> PostPage {
        try await request("/v1/profiles/by-id/\(id.uuidString)/posts")
    }

    func comments(post id: UUID) async throws -> [PostComment] {
        try await request("/v1/social/posts/\(id.uuidString)/comments")
    }

    func addComment(post id: UUID, body: String) async throws -> PostComment {
        try await request(
            "/v1/social/posts/\(id.uuidString)/comments",
            method: "POST",
            body: AddCommentRequest(body: body, mentionedProfileIds: [])
        )
    }

    func setLiked(post id: UUID, liked: Bool) async throws {
        try await requestEmpty("/v1/posts/\(id.uuidString)/like", method: liked ? "PUT" : "DELETE")
    }

    func setSaved(post id: UUID, saved: Bool) async throws {
        try await requestEmpty("/v1/saved-posts/\(id.uuidString)", method: saved ? "PUT" : "DELETE")
    }

    func messages(conversation: UUID, after: Int = 0) async throws -> [Message] {
        try await request("/v1/social/conversations/\(conversation.uuidString)/messages?after=\(after)&limit=100")
    }

    func send(conversation: UUID, body: String, sharedLinkId: UUID? = nil) async throws -> Message {
        try await request(
            "/v1/social/conversations/\(conversation.uuidString)/messages",
            method: "POST",
            body: SendMessage(body: body, sharedLinkId: sharedLinkId)
        )
    }

    func profiles(ids: [UUID]) async throws -> [Account] {
        guard !ids.isEmpty else { return [] }
        let value = ids.map(\.uuidString).joined(separator: ",")
        return try await request("/v1/profiles?ids=\(value)")
    }

    func ownedAgents(ownerProfileId: UUID) async throws -> [Account] {
        try await request("/v1/profiles/by-id/\(ownerProfileId.uuidString)/agents")
    }

    func typing(conversation: UUID) async throws -> [UUID] {
        try await request("/v1/social/conversations/\(conversation.uuidString)/typing")
    }

    func setTyping(conversation: UUID, active: Bool) async throws {
        try await requestEmpty(
            "/v1/social/conversations/\(conversation.uuidString)/typing",
            method: active ? "PUT" : "DELETE"
        )
    }

    func react(conversation: UUID, message: UUID, kind: Tapback?) async throws -> Message {
        let path = "/v1/social/conversations/\(conversation.uuidString)/messages/\(message.uuidString)/reaction"
        if let kind {
            return try await request(path, method: "PUT", body: ReactionRequest(kind: kind.rawValue))
        }
        return try await request(path, method: "DELETE", body: Optional<String>.none)
    }

    func markRead(conversation: UUID, through message: UUID) async throws {
        try await requestEmpty(
            "/v1/social/conversations/\(conversation.uuidString)/read",
            method: "POST",
            body: ReadRequest(throughMessageId: message)
        )
    }

    func summon(conversation: UUID, agent: UUID) async throws -> Conversation {
        try await request(
            "/v1/social/conversations/\(conversation.uuidString)/agents",
            method: "POST",
            body: SummonRequest(agentProfileId: agent, includeAnchorShare: true)
        )
    }

    private func request<Response: Decodable & Sendable>(
        _ path: String,
        method: String = "GET",
        body: (any Encodable & Sendable)? = nil,
        authenticated: Bool = true
    ) async throws -> Response {
        let (data, _) = try await perform(path, method: method, body: body, authenticated: authenticated)
        guard !data.isEmpty else { throw APIError.invalidResponse }
        return try Self.decoder.decode(Response.self, from: data)
    }

    private func requestEmpty(
        _ path: String,
        method: String,
        body: (any Encodable & Sendable)? = nil
    ) async throws {
        _ = try await perform(path, method: method, body: body, authenticated: true)
    }

    private func perform(
        _ path: String,
        method: String,
        body: (any Encodable & Sendable)?,
        authenticated: Bool
    ) async throws -> (Data, HTTPURLResponse) {
        guard let url = URL(string: path, relativeTo: baseURL) else { throw APIError.invalidResponse }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = try JSONEncoder.tardy.encode(AnyEncodable(body))
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if authenticated {
            guard let token else { throw APIError.http(401, "No saved session") }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            if let profileId { request.setValue(profileId.uuidString, forHTTPHeaderField: "X-Tardy-Profile-Id") }
        }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(response.statusCode) else {
            let message = (try? JSONDecoder().decode(ErrorBody.self, from: data).error)
                ?? String(data: data, encoding: .utf8)
                ?? "Unknown error"
            throw APIError.http(response.statusCode, message)
        }
        return (data, response)
    }

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()
}

private struct ErrorBody: Decodable { let error: String }

private struct AnyEncodable: Encodable, @unchecked Sendable {
    private let encodeValue: (Encoder) throws -> Void
    init(_ value: any Encodable) { encodeValue = value.encode }
    func encode(to encoder: Encoder) throws { try encodeValue(encoder) }
}

private extension JSONEncoder {
    static let tardy: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        return encoder
    }()
}
