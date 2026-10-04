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
    var destination: AppDestination = .reels {
        didSet { destinationChanged() }
    }
    var reels: [TardyPost] = []
    var selectedPostId: UUID?
    var comments: [PostComment] = []
    var commentDraft = ""
    var selectedProfile: Account?
    var profilePosts: [TardyPost] = []
    var isLoadingContent = false
    var isLoadingComments = false
    var isLoadingProfile = false
    var showsAppRail = true
    var showsInboxSidebar = true
    var showsContextInspector = true
    var showsAgentThinking = false
    var conversationStreamState: ConversationStreamState = .disconnected
    var thinkingStatusText: String?

    let api: TardyAPI
    private var messageTask: Task<Void, Never>?
    private var postDetailsTask: Task<Void, Never>?
    private var profileTask: Task<Void, Never>?
    private var typingTask: Task<Void, Never>?

    init() {
        let configured = ProcessInfo.processInfo.environment["TARDY_API_URL"] ?? "http://127.0.0.1:3300"
        api = TardyAPI(baseURL: URL(string: configured)!)
    }

    var selectedConversation: Conversation? {
        conversations.first { $0.id == selectedConversationId }
    }

    var selectedPost: TardyPost? {
        reels.first { $0.id == selectedPostId }
            ?? profilePosts.first { $0.id == selectedPostId }
    }

    var filteredConversations: [Conversation] {
        guard !search.isEmpty else { return conversations }
        return conversations.filter {
            $0.label(accounts: accounts, viewer: account?.id).localizedCaseInsensitiveContains(search)
        }
    }

    func start() async {
        if ProcessInfo.processInfo.environment["TARDY_DEV_AUTO_SIGN_IN"] == "1" {
            await developmentSignIn(email: ProcessInfo.processInfo.environment["TARDY_DEV_EMAIL"])
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
        postDetailsTask?.cancel()
        profileTask?.cancel()
        typingTask?.cancel()
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
            conversations = rows.sorted {
                ($0.lastMessage?.timestamp ?? .distantPast) > ($1.lastMessage?.timestamp ?? .distantPast)
            }
            if selectedConversationId == nil { select(conversations.first?.id) }
            let ids = Set(rows.flatMap(\.participants)).subtracting(accounts.keys)
            if !ids.isEmpty {
                let profiles = try await api.profiles(ids: Array(ids))
                profiles.forEach { accounts[$0.id] = $0 }
            }
            accounts[account.id] = account
        } catch { show(error) }
    }

    func refreshReels() async {
        isLoadingContent = true
        do {
            let page = try await api.reels()
            reels = page.items
            isLoadingContent = false
            if selectedPostId == nil || !reels.contains(where: { $0.id == selectedPostId }) {
                selectPost(reels.first?.id)
            }
            prefetchPosters(in: reels)
            let ids = Set(reels.map(\.authorId)).subtracting(accounts.keys)
            if !ids.isEmpty {
                let profiles = try await api.profiles(ids: Array(ids))
                profiles.forEach { accounts[$0.id] = $0 }
            }
        } catch {
            isLoadingContent = false
            show(error)
        }
    }

    func selectPost(_ id: UUID?) {
        guard selectedPostId != id else { return }
        postDetailsTask?.cancel()
        selectedPostId = id
        comments = []
        isLoadingComments = id != nil
        guard let post = selectedPost else { return }
        postDetailsTask = Task { [weak self] in
            guard let self else { return }
            do {
                async let loadedComments = api.comments(post: post.id)
                async let author = api.profile(id: post.authorId)
                let (newComments, profile) = try await (loadedComments, author)
                try Task.checkCancellation()
                guard selectedPostId == post.id else { return }
                comments = newComments
                accounts[profile.id] = profile
                isLoadingComments = false
                let missing = Set(newComments.map(\.authorProfileId)).subtracting(accounts.keys)
                if !missing.isEmpty {
                    let profiles = try await api.profiles(ids: Array(missing))
                    try Task.checkCancellation()
                    guard selectedPostId == post.id else { return }
                    profiles.forEach { accounts[$0.id] = $0 }
                }
            } catch is CancellationError {
            } catch {
                guard selectedPostId == post.id else { return }
                isLoadingComments = false
                show(error)
            }
        }
    }

    func advancePost(by delta: Int) {
        guard !reels.isEmpty else { return }
        let current = reels.firstIndex { $0.id == selectedPostId } ?? 0
        let next = min(max(current + delta, 0), reels.count - 1)
        guard next != current else { return }
        selectPost(reels[next].id)
    }

    func openProfile(_ id: UUID) {
        destination = .profile
        profileTask?.cancel()
        selectedProfile = accounts[id]
        profilePosts = []
        isLoadingProfile = true
        profileTask = Task { [weak self] in
            guard let self else { return }
            do {
                async let profile = api.profile(id: id)
                async let posts = api.posts(profile: id)
                let (loadedProfile, page) = try await (profile, posts)
                try Task.checkCancellation()
                selectedProfile = loadedProfile
                profilePosts = page.items
                accounts[loadedProfile.id] = loadedProfile
                isLoadingProfile = false
                prefetchPosters(in: page.items)
            } catch is CancellationError {
            } catch {
                isLoadingProfile = false
                show(error)
            }
        }
    }

    func openPost(_ post: TardyPost) {
        if !reels.contains(where: { $0.id == post.id }) { reels.insert(post, at: 0) }
        destination = .reels
        selectPost(post.id)
    }

    func addComment() async {
        guard let post = selectedPost else { return }
        let text = commentDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        commentDraft = ""
        do {
            let comment = try await api.addComment(post: post.id, body: text)
            comments.append(comment)
            updatePost(post.id) { $0.commentCount += 1 }
        } catch {
            commentDraft = text
            show(error)
        }
    }

    func toggleLike() async {
        guard let post = selectedPost else { return }
        let next = !post.viewerHasLiked
        updatePost(post.id) {
            $0.viewerHasLiked = next
            $0.likeCount += next ? 1 : -1
        }
        do { try await api.setLiked(post: post.id, liked: next) }
        catch {
            updatePost(post.id) {
                $0.viewerHasLiked = !next
                $0.likeCount += next ? -1 : 1
            }
            show(error)
        }
    }

    func toggleSaved() async {
        guard let post = selectedPost else { return }
        let next = !post.viewerHasSaved
        updatePost(post.id) { $0.viewerHasSaved = next }
        do { try await api.setSaved(post: post.id, saved: next) }
        catch {
            updatePost(post.id) { $0.viewerHasSaved = !next }
            show(error)
        }
    }

    func select(_ id: UUID?) {
        guard selectedConversationId != id else { return }
        selectedConversationId = id
        messages = []
        typingProfileIds = []
        messageTask?.cancel()
        guard let id else { return }
        guard destination == .messages else { return }
        startMessageStream(id)
    }

    private func startMessageStream(_ id: UUID) {
        messageTask?.cancel()
        messageTask = Task { [weak self] in
            guard let self else { return }
            await refreshConversation(id)
            var reconnects = 0
            while !Task.isCancelled, destination == .messages, selectedConversationId == id {
                conversationStreamState = reconnects == 0 ? .connecting : .reconnecting
                do {
                    let after = messages.last?.sequence ?? 0
                    let stream = try await api.conversationEvents(conversation: id, after: after)
                    conversationStreamState = .live
                    reconnects = 0
                    for try await event in stream {
                        try Task.checkCancellation()
                        guard destination == .messages, selectedConversationId == id else { return }
                        await apply(event, conversation: id)
                    }
                } catch is CancellationError {
                    return
                } catch {
                    reconnects += 1
                    conversationStreamState = .reconnecting
                    await refreshConversation(id)
                    let delay = min(4_000, 250 * (1 << min(reconnects, 4)))
                    try? await Task.sleep(for: .milliseconds(delay))
                }
            }
            conversationStreamState = .disconnected
        }
    }

    private func apply(_ event: ConversationStreamEvent, conversation id: UUID) async {
        switch event {
        case let .messages(fresh, _):
            guard !fresh.isEmpty else { return }
            for message in fresh {
                if let index = messages.firstIndex(where: { $0.id == message.id }) {
                    messages[index] = message
                } else {
                    messages.append(message)
                }
            }
            messages.sort { $0.sequence < $1.sequence }
            let missing = Set(fresh.map(\.senderProfileId)).subtracting(accounts.keys)
            if !missing.isEmpty, let profiles = try? await api.profiles(ids: Array(missing)) {
                profiles.forEach { accounts[$0.id] = $0 }
            }
            if let last = messages.last { try? await api.markRead(conversation: id, through: last.id) }
            Task { [weak self] in await self?.refreshInbox() }
        case let .typing(ids):
            typingProfileIds = ids
        }
    }

    func refreshConversation(_ id: UUID) async {
        guard destination == .messages, selectedConversationId == id else { return }
        do {
            let after = messages.last?.sequence ?? 0
            async let messageRequest = api.messages(conversation: id, after: after)
            async let typingRequest = api.typing(conversation: id)
            let (fresh, typing) = try await (messageRequest, typingRequest)
            try Task.checkCancellation()
            guard destination == .messages, selectedConversationId == id else { return }
            if !fresh.isEmpty {
                messages.append(contentsOf: fresh.filter { message in !messages.contains { $0.id == message.id } })
                if let last = messages.last {
                    try? await api.markRead(conversation: id, through: last.id)
                }
            }
            typingProfileIds = typing
        } catch is CancellationError {
        } catch { show(error) }
    }

    func send() async {
        guard let id = selectedConversationId else { return }
        let text = composer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isSending else { return }
        composer = ""
        if handleLocalCommand(text) { return }
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

    private func handleLocalCommand(_ text: String) -> Bool {
        let words = text.lowercased().split(whereSeparator: \.isWhitespace)
        guard words.first == "/thinking" else { return false }
        switch words.dropFirst().first {
        case "on": showsAgentThinking = true
        case "off": showsAgentThinking = false
        default: showsAgentThinking.toggle()
        }
        thinkingStatusText = showsAgentThinking
            ? "Thinking view on — showing agent work status and streamed updates."
            : "Thinking view off."
        return true
    }

    func composerChanged() {
        guard let id = selectedConversationId else { return }
        let active = !composer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        typingTask?.cancel()
        typingTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(200))
            guard !Task.isCancelled, let self, destination == .messages else { return }
            try? await api.setTyping(conversation: id, active: active)
        }
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
        // Authentication is enough to render the shell. Each surface owns its loading state,
        // so a slow feed, inbox, or agent lookup never holds the whole window hostage.
        phase = .ready
        Task { [weak self] in
            guard let self else { return }
            do { ownedAgents = try await api.ownedAgents(ownerProfileId: envelope.account.id) }
            catch { show(error) }
        }
        Task { [weak self] in await self?.refreshInbox() }
        Task { [weak self] in await self?.refreshReels() }
    }

    private func updatePost(_ id: UUID, _ mutation: (inout TardyPost) -> Void) {
        if let index = reels.firstIndex(where: { $0.id == id }) { mutation(&reels[index]) }
        if let index = profilePosts.firstIndex(where: { $0.id == id }) { mutation(&profilePosts[index]) }
    }

    private func destinationChanged() {
        if destination == .messages, let id = selectedConversationId {
            startMessageStream(id)
        } else {
            messageTask?.cancel()
            messageTask = nil
            conversationStreamState = .disconnected
        }
    }

    private func prefetchPosters(in posts: [TardyPost]) {
        let urls = posts.prefix(8).compactMap { $0.primaryMedia?.posterURL }
        Task {
            await withTaskGroup(of: Void.self) { group in
                for url in urls {
                    group.addTask { _ = try? await URLSession.shared.data(from: url) }
                }
            }
        }
    }

    private func show(_ error: Error) {
        errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
}
