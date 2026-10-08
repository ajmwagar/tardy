import Foundation

enum ServerEnvironment: String, CaseIterable, Identifiable, Sendable {
    case local, production, devOverlay
    var id: String { rawValue }
    var label: String {
        switch self {
        case .local: "Local (isolated)"
        case .production: "Production"
        case .devOverlay: "Dev overlay · production writes"
        }
    }
    var baseURL: URL {
        if self == .production { return URL(string: "https://api.tardy.news")! }
        if self == .devOverlay { return URL(string: ProcessInfo.processInfo.environment["TARDY_DEV_OVERLAY_URL"] ?? "http://127.0.0.1:3400")! }
        return URL(string: ProcessInfo.processInfo.environment["TARDY_API_URL"] ?? "http://127.0.0.1:3300")!
    }
    var keychainAccount: String {
        // Overlay uses the same production identity, never the isolated dev token.
        "session-token:\(self == .devOverlay ? ServerEnvironment.production.baseURL.absoluteString : baseURL.absoluteString)"
    }
}
