import Foundation
import Testing
@testable import TardyMac

@Test func productionAlwaysUsesPublicHTTPS() {
    #expect(ServerEnvironment.production.baseURL.absoluteString == "https://api.tardy.news")
    #expect(ServerEnvironment.production != .local)
    #expect(ServerEnvironment.local.keychainAccount != ServerEnvironment.production.keychainAccount)
}

@Test func appleExchangeUsesExistingServerContract() throws {
    let encoder = JSONEncoder()
    encoder.keyEncodingStrategy = .convertToSnakeCase
    let body = AppleSessionRequest(identityToken: "test-token", authorizationCode: "test-code", nonce: "test-nonce", fullName: nil)
    let json = try #require(JSONSerialization.jsonObject(with: encoder.encode(body)) as? [String: String])
    #expect(json["provider"] == "apple")
    #expect(json["identity_token"] == "test-token")
    #expect(json["authorization_code"] == "test-code")
    #expect(json["nonce"] == "test-nonce")
}
