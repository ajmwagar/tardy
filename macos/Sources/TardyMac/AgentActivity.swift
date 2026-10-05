import Foundation

struct AgentActivityPresentation: Equatable, Sendable {
    let title: String
    let symbol: String
    let showsProgress: Bool

    static func make(status: String, detail: String) -> Self {
        let normalized = detail.trimmingCharacters(in: .whitespacesAndNewlines)
        if !normalized.isEmpty {
            return .init(
                title: normalized,
                symbol: symbol(for: normalized),
                showsProgress: status != "finalizing"
            )
        }

        switch status {
        case "writing":
            return .init(title: "Writing a response", symbol: "text.cursor", showsProgress: true)
        case "tool":
            return .init(title: "Working", symbol: "hammer.fill", showsProgress: true)
        case "finalizing":
            return .init(title: "Finishing up", symbol: "checkmark.circle", showsProgress: false)
        default:
            return .init(title: "Working", symbol: "sparkles", showsProgress: true)
        }
    }

    private static func symbol(for label: String) -> String {
        let label = label.lowercased()
        if label.contains("connect") { return "bolt.horizontal.fill" }
        if label.contains("command") { return "terminal.fill" }
        if label.contains("edit") || label.contains("file") { return "doc.badge.gearshape.fill" }
        if label.contains("subagent") || label.contains("coordinat") { return "person.2.fill" }
        if label.contains("search") || label.contains("web") { return "magnifyingglass" }
        if label.contains("tool") { return "hammer.fill" }
        if label.contains("finish") { return "checkmark.circle" }
        return "sparkles"
    }
}
