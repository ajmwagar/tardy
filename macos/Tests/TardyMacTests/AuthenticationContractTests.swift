import Foundation
import CryptoKit
import Testing
@testable import TardyMac

@Test func cancelledNetworkRequestsAreNotUserFacingFailures() {
    #expect(isRequestCancellation(CancellationError()))
    #expect(isRequestCancellation(URLError(.cancelled)))
    #expect(!isRequestCancellation(URLError(.timedOut)))
    #expect(!isRequestCancellation(APIError.http(403, "Forbidden")))
}

@Test @MainActor func appleAuthorizationPreservesRawNonceAndConsumesItOnce() {
    let transaction = AppleAuthorizationTransaction()
    let challenge = transaction.begin()
    let raw = transaction.consume(state: challenge.state)
    #expect(raw != nil)
    let hash = SHA256.hash(data: Data((raw ?? "").utf8)).map { String(format: "%02x", $0) }.joined()
    #expect(hash == challenge.hashedNonce)
    #expect(transaction.consume(state: challenge.state) == nil)
}

@Test @MainActor func appleAuthorizationRejectsStaleAndCancelledRequests() {
    let transaction = AppleAuthorizationTransaction()
    let old = transaction.begin()
    let repeated = transaction.begin()
    #expect(repeated.state == old.state)
    #expect(repeated.hashedNonce == old.hashedNonce)
    #expect(transaction.consume(state: old.state) != nil)
    let cancelled = transaction.begin()
    transaction.cancel()
    #expect(transaction.consume(state: cancelled.state) == nil)
}

// A fixed transport contract avoids mutable global handlers across parallel tests.
private final class AppleSessionProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let valid = request.url?.path == "/v1/sessions"
            && request.httpMethod == "POST"
            && request.value(forHTTPHeaderField: "Authorization") == nil
            && request.value(forHTTPHeaderField: "X-Tardy-Profile-Id") == nil
        let response = HTTPURLResponse(url: request.url!, statusCode: valid ? 200 : 405, httpVersion: nil, headerFields: nil)!
        let body = valid ? #"{"session":{"token":"test-session","account_id":"00000000-0000-0000-0000-000000000001","provider":"apple","expires_at_ms":1799999999999},"account":{"id":"00000000-0000-0000-0000-000000000002","kind":"human","handle":"avery","display_name":"Avery","avatar_url":"","bio":"","verified":false,"followers":0,"following":0,"post_count":0}}"# : #"{"error":"Wrong Apple session exchange contract"}"#
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@Test func appleSignInPostsToProductionSessionCreationRouteWithoutOldToken() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [AppleSessionProtocol.self]
    let api = TardyAPI(baseURL: ServerEnvironment.production.baseURL, session: URLSession(configuration: configuration))
    await api.authenticate(token: "stale-local-token", profileId: UUID())
    let envelope = try await api.appleSession(AppleSessionRequest(identityToken: "test-token", authorizationCode: "test-code", nonce: "test-nonce", fullName: nil))
    #expect(envelope.session.provider == "apple")
    #expect(envelope.account.handle == "avery")
}
