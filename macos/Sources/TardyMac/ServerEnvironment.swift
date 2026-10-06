import Foundation

enum ServerEnvironment: String, CaseIterable, Identifiable, Sendable {
    case local, production
    var id: String { rawValue }
    var label: String { self == .local ? "Local" : "Production" }
    var baseURL: URL {
        if self == .production { return URL(string: "https://api.tardy.news")! }
        return URL(string: ProcessInfo.processInfo.environment["TARDY_API_URL"] ?? "http://127.0.0.1:3300")!
    }
    var keychainAccount: String { "session-token:\(baseURL.absoluteString)" }
}
