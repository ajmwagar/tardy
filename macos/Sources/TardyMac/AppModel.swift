import Foundation
import Observation

@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable { case loading, signedOut, ready }

    var phase: Phase = .loading
    var account: Account?
    var conversations: [Conversation] = []
    var accounts: [UUID: Account] = [:]
    var ownedAgents: [Account] = []
    var selectedConversationId: UUID?
    var messages: [Message] = []
    var typingProfileIds: [UUID] = []
    var composer = ""
    var search = ""
    var errorMessage: String?
    var isSending = false

    let api: TardyAPI
    private var messageTask: Task<Void, Never>?

    init() {
        let configured = ProcessInfo.processInfo.environment["TARDY_API_URL"] ?? "http://127.0.0.1:3300"
        api = TardyAPI(baseURL: URL(string: configured)!)
    }

    var selectedConversation: Conversation? {
        conversations.first { $0.id == selectedConversationId }
    }

    var filteredConversations: [Conversation] {
        guard !search.isEmpty else { return conversations }
        return conversations.filter {
            $0.label(accounts: accounts, viewer: account?.id).localizedCaseInsensitiveContains(search)
        }
    }

    func start() async {
        if ProcessInfo.processInfo.environment["TARDY_DEV_AUTO_SIGN_IN"] == "1" {
            await developmentSignIn(email: nil)
            return
        }
        if let token = KeychainStore.loadToken() {
            await api.authenticate(token: token, profileId: nil)
            do {
                let session = try await api.resumeSession()
                try await adopt(session)
                return
            } catch {
                KeychainStore.clear()
            }
        }
        phase = .signedOut
    }

    func developmentSignIn(email: String?) async {
        phase = .loading
        do {
            let session = try await api.developmentSession(email: email)
            try KeychainStore.saveToken(session.session.token)
            try await adopt(session)
        } catch {
            show(error)
            phase = .signedOut
        }
    }

    func signOut() {
        messageTask?.cancel()
        KeychainStore.clear()
        Task { await api.authenticate(token: nil, profileId: nil) }
        account = nil
        conversations = []
        accounts = [:]
        messages = []
        phase = .signedOut
    }

    func refreshInbox() async {
        guard let account else { return }
        do {
            let rows = try await api.conversations()
            let ids = Set(rows.flatMap(\.participants)).subtracting(accounts.keys)
            if !ids.isEmpty {
                let profiles = try await api.profiles(ids: Array(ids))
                profiles.forEach { accounts[$0.id] = $0 }
            }
            accounts[account.id] = account
            conversations = rows.sorted {
                ($0.lastMessage?.timestamp ?? .distantPast) > ($1.lastMessage?.timestamp ?? .distantPast)
            }
            if selectedConversationId == nil { select(conversations.first?.id) }
        } catch { show(error) }
    }

    func select(_ id: UUID?) {
        guard selectedConversationId != id else { return }
        selectedConversationId = id
        messages = []
        typingProfileIds = []
        messageTask?.cancel()
        guard let id else { return }
        messageTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refreshConversation(id)
                try? await Task.sleep(for: .milliseconds(700))
            }
        }
    }

    func refreshConversation(_ id: UUID) async {
        do {
            let after = messages.last?.sequence ?? 0
            let fresh = try await api.messages(conversation: id, after: after)
            if !fresh.isEmpty {
                messages.append(contentsOf: fresh.filter { message in !messages.contains { $0.id == message.id } })
                if let last = messages.last {
                    try? await api.markRead(conversation: id, through: last.id)
                }
            }
            typingProfileIds = try await api.typing(conversation: id)
        } catch is CancellationError {
        } catch { show(error) }
    }

    func send() async {
        guard let id = selectedConversationId else { return }
        let text = composer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isSending else { return }
        composer = ""
        isSending = true
        defer { isSending = false }
        do {
            try await api.setTyping(conversation: id, active: false)
            let message = try await api.send(conversation: id, body: text)
            if !messages.contains(where: { $0.id == message.id }) { messages.append(message) }
            await refreshInbox()
        } catch {
            composer = text
            show(error)
        }
    }

    func composerChanged() {
        guard let id = selectedConversationId else { return }
        let active = !composer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        Task { try? await api.setTyping(conversation: id, active: active) }
    }

    func react(_ kind: Tapback?, to message: Message) async {
        guard let id = selectedConversationId else { return }
        do {
            let updated = try await api.react(conversation: id, message: message.id, kind: kind)
            if let index = messages.firstIndex(where: { $0.id == updated.id }) { messages[index] = updated }
        } catch { show(error) }
    }

    func summon(_ agent: Account) async {
        guard let id = selectedConversationId else { return }
        do {
            let updated = try await api.summon(conversation: id, agent: agent.id)
            if let index = conversations.firstIndex(where: { $0.id == id }) {
                let old = conversations[index]
                conversations[index] = Conversation(
                    id: updated.id,
                    mode: updated.mode,
                    title: updated.title,
                    participants: updated.participants,
                    lastMessage: old.lastMessage,
                    unreadCount: old.unreadCount
                )
            }
        } catch { show(error) }
    }

    private func adopt(_ envelope: SessionEnvelope) async throws {
        account = envelope.account
        accounts[envelope.account.id] = envelope.account
        await api.authenticate(token: envelope.session.token, profileId: envelope.account.id)
        async let agents = api.ownedAgents(ownerProfileId: envelope.account.id)
        async let inbox: Void = refreshInbox()
        ownedAgents = try await agents
        _ = await inbox
        phase = .ready
    }

    private func show(_ error: Error) {
        errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
}
