import XCTest
@testable import TardyMac

final class SharedTardyTests: XCTestCase {
    func testRecognizesPublicAndLegacyLinks() {
        let id = UUID()
        XCTAssertEqual(TardyPost.sharedID(in: "Look https://api.tardy.news/t/\(id)"), id)
        XCTAssertEqual(TardyPost.sharedID(in: "https://tardy.news/viewer.html?id=\(id)"), id)
        XCTAssertNil(TardyPost.sharedID(in: "https://evil.test/t/\(id)"))
        XCTAssertNil(TardyPost.sharedID(in: "https://user@tardy.news/t/\(id)"))
    }
}
