import XCTest
@testable import TardyMac

final class LocalCodexSessionsTests: XCTestCase {
    func testDiscoveryContainsMetadataOnly() throws {
        let data = Data("""
        [{"id":"thread","title":"Project","project":"tardy","status":"active","updated_at":123}]
        """.utf8)
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let sessions = try decoder.decode([LocalCodexSession].self, from: data)
        XCTAssertEqual(sessions[0].project, "tardy")
        XCTAssertEqual(sessions[0].status, "active")
        XCTAssertEqual(sessions[0].updatedAt, 123)
    }
}
