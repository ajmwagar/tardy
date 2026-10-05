import Testing
@testable import TardyMac

@Test func compactProjectionPreservesSourcePrefixWithoutInventingSummary() {
    let source = "A useful reply 🟡\nwith details"
    #expect(ChatProjection.preview(source, limit: 16) == String(source.prefix(16)))
    #expect(ChatProjection.preview(source) == source)
    #expect(ChatProjection.preview(source, limit: -1).isEmpty)
}
