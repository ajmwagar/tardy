import Foundation

struct LocalCodexSession: Decodable, Identifiable, Sendable {
    let id: String
    let title: String
    let project: String?
    let status: String
    let updatedAt: Int64?
}

/// The Rust host owns Codex transport and credential reads. Swift is only a client.
enum LocalCodexSessions {
    static func discover() async throws -> [LocalCodexSession] {
        let data = try await invoke(arguments: ["sessions"])
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode([LocalCodexSession].self, from: data)
    }

    static func connect(_ session: LocalCodexSession, agent: Account, api: URL, installation: String) async throws -> UUID {
        guard !agent.handle.isEmpty, agent.handle.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" || $0 == "." || $0 == "-" }) else {
            throw BridgeError.invalidAgent
        }
        let environment = api.host == "api.tardy.news" ? "production" : "development"
        let credential = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".config/tardy/agents/\(agent.handle)/\(environment).json").path
        let data = try await invoke(arguments: ["connect-session", agent.id.uuidString.lowercased(), api.absoluteString, installation, session.id], credential: credential)
        struct Connected: Decodable { let conversationId: UUID }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(Connected.self, from: data).conversationId
    }

    private static func invoke(arguments: [String], credential: String? = nil) async throws -> Data {
        try await Task.detached {
            let process = Process()
            process.executableURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/bin/tardy-agent-host")
            process.arguments = arguments
            var environment = ProcessInfo.processInfo.environment
            if let credential { environment["TARDY_STATE_PATH"] = credential }
            process.environment = environment
            let output = Pipe()
            process.standardOutput = output
            // Do not forward arbitrary host diagnostics or credential paths into chat.
            process.standardError = FileHandle.nullDevice
            try process.run()
            let data = output.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else { throw BridgeError.unavailable }
            return data
        }.value
    }

    enum BridgeError: LocalizedError {
        case invalidAgent, unavailable
        var errorDescription: String? {
            switch self {
            case .invalidAgent: "Invalid agent handle."
            case .unavailable: "Could not reach the local Codex host. Check that Codex is open, the Tardy host is installed, and this agent has a matching local credential."
            }
        }
    }
}
