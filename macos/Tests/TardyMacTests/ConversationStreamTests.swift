import Foundation
import Testing
@testable import TardyMac

private final class ConversationStreamProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
            headerFields: ["Content-Type": "text/event-stream"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        // Split at arbitrary byte boundaries, as a real stream is allowed to do.
        for byte in "event: typing\ndata: []\n\nevent: drafts\r\ndata: []\r\n\r\n".utf8 {
            client?.urlProtocol(self, didLoad: Data([byte]))
        }
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@Test func conversationTransportPreservesEmptyFrameBoundaries() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [ConversationStreamProtocol.self]
    let api = TardyAPI(baseURL: URL(string: "https://tardy.test")!,
        session: URLSession(configuration: configuration))
    await api.authenticate(token: "test-token", profileId: UUID())
    let stream = try await api.conversationEvents(conversation: UUID(), after: 0)
    var kinds: [String] = []
    for try await event in stream {
        switch event {
        case .typing: kinds.append("typing")
        case .drafts: kinds.append("drafts")
        case .messages: kinds.append("messages")
        }
    }
    #expect(kinds == ["typing", "drafts"])
}

@Test func conversationByteParserPreservesUTF8AndCRLF() throws {
    let body = #"[{"conversation_id":"650ffada-b502-4565-86cb-b3331e25bb4e","sender_profile_id":"8ca1e470-bad0-4fec-a0da-7fc1945fbd5b","body":"On it! 👋","status":"writing","detail":"","activities":[],"updated_at":"2026-10-08T07:00:00Z"}]"#
    var parser = ConversationSSEParser()
    var events: [ConversationStreamEvent] = []
    for byte in ": keep-alive\r\nevent: drafts\r\ndata: \(body)\r\n\r\n".utf8 {
        if let event = try parser.consume(byte: byte) { events.append(event) }
    }
    #expect(events.count == 1)
    guard case let .drafts(drafts) = events.first else {
        Issue.record("expected a draft frame")
        return
    }
    #expect(drafts.first?.body == "On it! 👋")
}
