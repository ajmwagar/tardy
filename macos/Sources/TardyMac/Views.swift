import SwiftUI

enum Brand {
    static let yellow = Color(red: 1.0, green: 0.79, blue: 0.06)
    static let background = Color(red: 0.035, green: 0.035, blue: 0.045)
    static let panel = Color(red: 0.075, green: 0.075, blue: 0.09)
    static let raised = Color(red: 0.11, green: 0.11, blue: 0.13)
    static let muted = Color.white.opacity(0.58)
    static let separator = Color.white.opacity(0.08)
    static let glow = Color(red: 1.0, green: 0.68, blue: 0.0)
}

struct TardyBackdrop: View {
    var body: some View {
        ZStack {
            Brand.background
            RadialGradient(
                colors: [Brand.yellow.opacity(0.09), .clear],
                center: .topLeading,
                startRadius: 20,
                endRadius: 560
            )
        }
        .ignoresSafeArea()
    }
}

struct ContentView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            switch model.phase {
            case .loading: LaunchView()
            case .signedOut: SignInView()
            case .ready: AppShellView()
            }
        }
        .frame(minWidth: 980, minHeight: 640)
        .background(Brand.background)
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Menu {
                    ForEach(ServerEnvironment.allCases) { server in
                        Button(server.label) { Task { await model.switchServer(to: server) } }
                    }
                } label: {
                    Label(model.serverEnvironment.label, systemImage: model.serverEnvironment == .local ? "desktopcomputer" : "globe")
                }
                .disabled(model.phase == .loading)
            }
        }
        .overlay(alignment: .top) {
            if let error = model.errorMessage {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                    Text(error).lineLimit(2)
                    Button { model.errorMessage = nil } label: { Image(systemName: "xmark") }
                        .buttonStyle(.plain)
                }
                .font(.caption)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(.red.opacity(0.92), in: Capsule())
                .padding(10)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: model.errorMessage)
    }
}

private struct LaunchView: View {
    @State private var pulsing = false

    var body: some View {
        ZStack {
            TardyBackdrop()
            VStack(spacing: 18) {
                Image(systemName: "alarm.waves.left.and.right.fill")
                    .font(.system(size: 62, weight: .black))
                    .foregroundStyle(Brand.yellow)
                    .scaleEffect(pulsing ? 1.04 : 0.94)
                    .shadow(color: Brand.glow.opacity(0.35), radius: pulsing ? 24 : 10)
                Text("TARDY").font(.system(size: 34, weight: .black, design: .rounded))
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small).tint(Brand.yellow)
                    Text("Getting current…").foregroundStyle(Brand.muted)
                }
            }
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) {
                pulsing = true
            }
        }
    }
}

private struct SignInView: View {
    @Environment(AppModel.self) private var model
    @State private var email = ProcessInfo.processInfo.environment["TARDY_DEV_EMAIL"] ?? ""

    var body: some View {
        ZStack {
            TardyBackdrop()
            VStack(spacing: 22) {
                Image(systemName: "alarm.waves.left.and.right.fill")
                    .font(.system(size: 68, weight: .black))
                    .foregroundStyle(Brand.yellow)
                    .shadow(color: Brand.glow.opacity(0.3), radius: 20)
                Text("TARDY").font(.system(size: 42, weight: .black, design: .rounded))
                Text("Don't be late.").font(.title3).foregroundStyle(Brand.muted)
                Text(model.serverEnvironment.baseURL.absoluteString).font(.caption).foregroundStyle(Brand.muted)
                if model.serverEnvironment == .local {
                TextField("Development email", text: $email)
                    .textFieldStyle(.plain)
                    .padding(11)
                    .frame(width: 320)
                    .background(Brand.raised, in: RoundedRectangle(cornerRadius: 10))
                Button("Preview with local account") {
                    Task { await model.developmentSignIn(email: email) }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .tint(Brand.yellow)
                .foregroundStyle(.black)
                } else {
                    AppleSignInButton()
                }
            }
            .padding(54)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24))
            .overlay { RoundedRectangle(cornerRadius: 24).stroke(Brand.separator) }
        }
    }
}

struct MessengerView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        HSplitView {
            if model.showsInboxSidebar {
                InboxSidebar()
                    .frame(minWidth: 250, idealWidth: 300, maxWidth: 360)
            }
            ChatView()
                .frame(minWidth: 480, idealWidth: 680)
            if model.showsContextInspector {
                ContextInspector()
                    .frame(minWidth: 240, idealWidth: 285, maxWidth: 340)
            }
        }
        .animation(.snappy, value: model.showsInboxSidebar)
        .animation(.snappy, value: model.showsContextInspector)
        .tint(Brand.yellow)
        .focusedSceneValue(\.sendTardyMessage) { Task { await model.send() } }
    }
}

private struct InboxSidebar: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text("TARDY").font(.system(size: 20, weight: .black, design: .rounded))
                    Text("Messages").font(.caption).foregroundStyle(Brand.muted)
                }
                Spacer()
                Button { Task { await model.refreshInbox() } } label: { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(.plain).help("Refresh")
            }
            .padding(16)

            TextField("Search conversations", text: $model.search)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal, 12)
                .padding(.bottom, 10)

            List(selection: Binding(get: { model.selectedConversationId }, set: { model.select($0) })) {
                ForEach(model.filteredConversations) { conversation in
                    ConversationRow(conversation: conversation)
                        .tag(conversation.id)
                }
            }
            .listStyle(.sidebar)

            if let account = model.account {
                HStack(spacing: 10) {
                    Avatar(account: account, size: 30)
                    Text("@\(account.handle)").font(.caption).lineLimit(1)
                    Spacer()
                    Button { model.signOut() } label: { Image(systemName: "rectangle.portrait.and.arrow.right") }
                        .buttonStyle(.plain).help("Sign out")
                }
                .padding(12)
                .background(Brand.panel)
            }
        }
    }
}

private struct ConversationRow: View {
    @Environment(AppModel.self) private var model
    let conversation: Conversation

    var body: some View {
        HStack(spacing: 11) {
            let others = conversation.participants.filter { $0 != model.account?.id }
            ZStack {
                ForEach(Array(others.prefix(2).enumerated()), id: \.element) { index, id in
                    Avatar(account: model.accounts[id], size: 34)
                        .offset(x: CGFloat(index * 10 - 5))
                }
            }
            .frame(width: 46, height: 40)
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(conversation.label(accounts: model.accounts, viewer: model.account?.id))
                        .fontWeight(conversation.unreadCount > 0 ? .bold : .semibold).lineLimit(1)
                    if conversation.mode == .work {
                        Image(systemName: "sparkles").font(.caption2).foregroundStyle(Brand.yellow)
                    }
                }
                Text(conversation.lastMessage?.body.isEmpty == false ? conversation.lastMessage!.body : "No messages yet")
                    .font(.caption).foregroundStyle(Brand.muted).lineLimit(1)
            }
            Spacer()
            if conversation.unreadCount > 0 {
                Text("\(conversation.unreadCount)").font(.caption2.bold()).foregroundStyle(.black)
                    .padding(.horizontal, 6).padding(.vertical, 3).background(Brand.yellow, in: Capsule())
            }
        }
        .padding(.vertical, 5)
    }
}

private struct ChatView: View {
    @Environment(AppModel.self) private var model
    @State private var isAtBottom = true
    @AppStorage("chatExpanded") private var expanded = false
    @State private var showsAttachments = false
    @State private var jumpTarget: UUID?
    private let bottomID = "chat-latest"

    var body: some View {
        @Bindable var model = model
        if let conversation = model.selectedConversation {
            VStack(spacing: 0) {
                ChatHeader(conversation: conversation, expanded: $expanded, showsAttachments: $showsAttachments)
                Divider()
                HStack(spacing: 0) {
                VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ZStack(alignment: .bottomTrailing) {
                        ScrollView {
                            LazyVStack(spacing: 12) {
                                ForEach(model.messages) { message in
                                    MessageRow(message: message, expanded: expanded)
                                        .id(message.id)
                                        .overlay {
                                            RoundedRectangle(cornerRadius: 14)
                                                .stroke(jumpTarget == message.id ? Brand.yellow.opacity(0.8) : .clear, lineWidth: 2)
                                        }
                                }
                                ForEach(model.conversationDrafts) { draft in
                                    DraftMessageRow(draft: draft, expanded: expanded)
                                }
                                if model.conversationDrafts.isEmpty,
                                   model.showsAgentThinking,
                                   let agent = conversation.agentPeer(accounts: model.accounts, viewer: model.account?.id) {
                                    AgentThinkingRow(
                                        agent: agent,
                                        working: model.typingProfileIds.contains(agent.id),
                                        status: model.thinkingStatusText
                                    )
                                } else if let status = model.thinkingStatusText {
                                    Text(status)
                                        .font(.caption)
                                        .foregroundStyle(Brand.muted)
                                }
                                let draftingIds = Set(model.conversationDrafts.map(\.senderProfileId))
                                let typingOnlyIds = model.typingProfileIds.filter { !draftingIds.contains($0) }
                                if !typingOnlyIds.isEmpty { TypingRow(ids: typingOnlyIds) }
                                Color.clear
                                    .frame(height: 1)
                                    .id(bottomID)
                                    .onAppear { isAtBottom = true }
                                    .onDisappear { isAtBottom = false }
                            }
                            .padding(20)
                        }
                        if !isAtBottom {
                            Button {
                                proxy.scrollTo(bottomID, anchor: .bottom)
                                isAtBottom = true
                            } label: {
                                Image(systemName: "arrow.down")
                                    .font(.system(size: 14, weight: .bold))
                                    .frame(width: 34, height: 34)
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(.black)
                            .background(Brand.yellow, in: Circle())
                            .shadow(color: .black.opacity(0.3), radius: 8, y: 3)
                            .padding(18)
                            .help("Jump to latest")
                        }
                    }
                    .onChange(of: model.messages.count) { oldCount, _ in
                        if oldCount == 0 || isAtBottom {
                            proxy.scrollTo(bottomID, anchor: .bottom)
                        }
                    }
                    .onChange(of: model.conversationDrafts) { _, _ in
                        guard isAtBottom else { return }
                        proxy.scrollTo(bottomID, anchor: .bottom)
                    }
                    .onChange(of: model.selectedConversationId) { _, _ in
                        jumpTarget = nil
                        isAtBottom = true
                        Task { @MainActor in proxy.scrollTo(bottomID, anchor: .bottom) }
                    }
                    .onChange(of: jumpTarget) { _, target in
                        if let target { proxy.scrollTo(target, anchor: .center) }
                    }
                }
                Divider()
                ComposerView()
                }
                if showsAttachments {
                    Divider()
                    ConversationAttachmentsView(messages: model.messages, close: { showsAttachments = false }) { id in
                        jumpTarget = nil
                        Task { @MainActor in jumpTarget = id }
                    }
                    .frame(width: 300)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                }
                }
            }
            .background(Brand.background)
        } else {
            ContentUnavailableView("Choose a conversation", systemImage: "bubble.left.and.bubble.right", description: Text("DMs, groups, and agent work threads stay together."))
        }
    }
}

private struct ChatHeader: View {
    @Environment(AppModel.self) private var model
    let conversation: Conversation
    @Binding var expanded: Bool
    @Binding var showsAttachments: Bool

    private var agentPeer: Account? {
        conversation.agentPeer(accounts: model.accounts, viewer: model.account?.id)
    }

    private var agentIsWorking: Bool {
        agentPeer.map { model.typingProfileIds.contains($0.id) } ?? false
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: conversation.mode == .work ? "person.3.sequence.fill" : "bubble.left.and.bubble.right.fill")
                .foregroundStyle(conversation.mode == .work ? Brand.yellow : .secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(conversation.label(accounts: model.accounts, viewer: model.account?.id)).font(.headline)
                Text(agentPeer != nil ? "1:1 agent session" : conversation.mode == .work ? "Shared agent thread" : "Direct messages")
                    .font(.caption).foregroundStyle(Brand.muted)
            }
            Spacer()
            Picker("Reply presentation", selection: $expanded) {
                Text("Chat").tag(false)
                Text("Expanded").tag(true)
            }.pickerStyle(.segmented).labelsHidden().frame(width: 150)
            Button {
                withAnimation(.snappy) {
                    showsAttachments.toggle()
                    if showsAttachments { model.showsContextInspector = false }
                }
            } label: { Image(systemName: "photo.on.rectangle") }
                .buttonStyle(.plain)
                .foregroundStyle(showsAttachments ? Brand.yellow : Brand.muted)
                .help("Browse media and files")
            Button {
                model.showsAgentThinking.toggle()
                model.thinkingStatusText = nil
            } label: {
                Image(systemName: model.showsAgentThinking ? "brain.fill" : "brain")
                    .foregroundStyle(model.showsAgentThinking ? Brand.yellow : Brand.muted)
            }
            .buttonStyle(.plain)
            .help("Toggle agent work view (/thinking)")
            Menu {
                Button(model.showsAppRail ? "Hide app navigation" : "Show app navigation") { model.showsAppRail.toggle() }
                Button(model.showsInboxSidebar ? "Hide conversations" : "Show conversations") { model.showsInboxSidebar.toggle() }
                Button(model.showsContextInspector ? "Hide context" : "Show context") {
                    model.showsContextInspector.toggle()
                    if model.showsContextInspector { showsAttachments = false }
                }
            } label: { Image(systemName: "ellipsis") }
            .menuStyle(.borderlessButton).fixedSize().help("Conversation layout")
            if agentIsWorking {
                HStack(spacing: 6) {
                    Circle().fill(.green).frame(width: 7, height: 7)
                    Text("Working").font(.caption.weight(.medium))
                }
                .foregroundStyle(.green)
            } else {
                HStack(spacing: 5) {
                    Circle()
                        .fill(model.conversationStreamState == .live ? .green : Brand.muted)
                        .frame(width: 6, height: 6)
                    Text(model.conversationStreamState == .live ? "Live" : agentPeer != nil ? "Private" : "\(conversation.participants.count) members")
                }
                .font(.caption).foregroundStyle(Brand.muted)
            }
        }
        .padding(.horizontal, 18).frame(height: 58)
        .background(.ultraThinMaterial)
    }
}

private struct AgentThinkingRow: View {
    let agent: Account
    let working: Bool
    let status: String?
    @State private var phase = 0

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: "brain.head.profile.fill").foregroundStyle(Brand.yellow)
            VStack(alignment: .leading, spacing: 3) {
                Text(working ? "\(agent.displayName) is working\(["", ".", "..", "..."][phase])" : "\(agent.displayName) is ready")
                    .font(.caption.bold())
                Text(status ?? "Tool progress, edits, and streamed replies appear here. Private model reasoning stays private.")
                    .font(.caption2)
                    .foregroundStyle(Brand.muted)
            }
            Spacer()
        }
        .padding(10)
        .background(Brand.yellow.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
        .task(id: working) {
            while working && !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(350))
                phase = (phase + 1) % 4
            }
        }
    }
}

private struct DraftMessageRow: View {
    @Environment(AppModel.self) private var model
    let draft: ConversationDraft
    var expanded = true

    private var activity: AgentActivityPresentation {
        .make(status: draft.status, detail: draft.detail)
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 9) {
            Button { model.openProfile(draft.senderProfileId) } label: {
                Avatar(account: model.accounts[draft.senderProfileId], size: 28)
            }
            .buttonStyle(.plain)
            .help("Open profile")
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                    Button { model.openProfile(draft.senderProfileId) } label: {
                        Text(model.accounts[draft.senderProfileId]?.displayName ?? "Tardy")
                            .font(.caption.bold())
                    }
                    .buttonStyle(.plain)
                    Image(systemName: activity.symbol)
                        .font(.caption2.bold())
                    Text(activity.title)
                        .font(.caption2.bold())
                        .foregroundStyle(Brand.yellow)
                    if activity.showsProgress {
                        ProgressView().controlSize(.mini)
                    }
                }
                if draft.body.isEmpty {
                    Text("Live agent activity will appear here.")
                        .font(.caption)
                        .foregroundStyle(Brand.muted)
                } else {
                    ChatReplyView(source: draft.body, expanded: expanded)
                        .textSelection(.enabled)
                }
                if model.showsAgentThinking, !draft.activityItems.isEmpty {
                    AgentActivityTimeline(activities: draft.activityItems)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(Brand.raised, in: RoundedRectangle(cornerRadius: 14))
            .overlay(alignment: .leading) {
                Capsule()
                    .fill(Brand.yellow)
                    .frame(width: 3)
                    .padding(.vertical, 9)
            }
            Spacer(minLength: 90)
        }
    }
}

private struct AgentActivityTimeline: View {
    let activities: [ConversationActivity]
    @State private var expanded = true

    private var completedCount: Int {
        activities.count(where: { $0.phase == "completed" })
    }

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 7) {
                ForEach(activities) { activity in
                    let presentation = AgentActivityPresentation.make(activity: activity)
                    HStack(spacing: 8) {
                        Image(systemName: presentation.symbol)
                            .frame(width: 14)
                            .foregroundStyle(activity.phase == "failed" ? .red : Brand.yellow)
                        Text(presentation.title)
                            .lineLimit(2)
                            .textSelection(.enabled)
                        Spacer(minLength: 8)
                        if presentation.showsProgress {
                            ProgressView().controlSize(.mini)
                        } else {
                            Image(systemName: activity.phase == "failed" ? "xmark.circle.fill" : "checkmark.circle.fill")
                                .foregroundStyle(activity.phase == "failed" ? .red : .green)
                        }
                    }
                    .font(.caption)
                }
            }
            .padding(.top, 7)
        } label: {
            Text("Activity · \(completedCount)/\(activities.count)")
                .font(.caption2.bold())
                .foregroundStyle(Brand.muted)
        }
        .disclosureGroupStyle(.automatic)
    }
}

private struct MessageRow: View {
    @Environment(AppModel.self) private var model
    let message: Message
    var expanded = true
    private var mine: Bool { message.senderProfileId == model.account?.id }

    var body: some View {
        HStack(alignment: .bottom, spacing: 9) {
            if mine { Spacer(minLength: 90) }
            if !mine {
                Button { model.openProfile(message.senderProfileId) } label: {
                    Avatar(account: model.accounts[message.senderProfileId], size: 28)
                }
                .buttonStyle(.plain)
                .help("Open profile")
            }
            VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
                if !mine {
                    Button { model.openProfile(message.senderProfileId) } label: {
                        Text(model.accounts[message.senderProfileId]?.displayName ?? "Tardy")
                            .font(.caption.bold()).foregroundStyle(Brand.muted)
                    }
                    .buttonStyle(.plain)
                }
                VStack(alignment: .leading, spacing: 8) {
                    if !message.body.isEmpty {
                        ChatReplyView(source: message.body, expanded: expanded)
                    }
                    ForEach(message.media) { media in MessageAttachmentView(media: media) }
                }
                .frame(maxWidth: expanded ? 760 : 560, alignment: .leading)
                .padding(.horizontal, 12).padding(.vertical, 9)
                .background(mine ? Brand.yellow : Brand.raised, in: RoundedRectangle(cornerRadius: 14))
                .foregroundStyle(mine ? .black : .white)
                .contextMenu {
                    ForEach(Tapback.allCases, id: \.self) { kind in
                        Button { Task { await model.react(kind, to: message) } } label: {
                            Label(kind.rawValue.capitalized, systemImage: kind.symbol)
                        }
                    }
                    Divider()
                    Button("Remove reaction") { Task { await model.react(nil, to: message) } }
                }
                if !message.reactions.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(message.reactions, id: \.kind) { reaction in
                            if let kind = Tapback(rawValue: reaction.kind) {
                                Label("\(reaction.accountIds.count)", systemImage: kind.symbol)
                                    .font(.caption2).padding(.horizontal, 6).padding(.vertical, 3)
                                    .background(Brand.panel, in: Capsule())
                            }
                        }
                    }
                }
                HStack(spacing: 6) {
                    if let date = message.timestamp { Text(date, style: .time) }
                    if mine && !message.readBy.isEmpty { Text("Read") }
                    else if mine { Text("Delivered") }
                }
                .font(.caption2).foregroundStyle(Brand.muted)
            }
            if !mine { Spacer(minLength: 90) }
        }
    }
}

private struct MessageAttachmentView: View {
    let media: MessageMedia
    @State private var showsPreview = false
    var body: some View {
        Button { showsPreview = true } label: {
            if media.type == "image", let url = media.remoteURL {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image): image.resizable().scaledToFit()
                    case .failure: Label("Photo unavailable", systemImage: "photo")
                    default: ProgressView()
                    }
                }.frame(maxWidth: 360, maxHeight: 280).clipShape(RoundedRectangle(cornerRadius: 9))
            } else {
                Label(media.fileName ?? media.type.capitalized, systemImage: media.type == "video" ? "play.rectangle.fill" : media.type == "audio" ? "waveform" : "doc.fill")
            }
        }
        .buttonStyle(.plain)
        .help("Preview attachment")
        .popover(isPresented: $showsPreview) {
            AttachmentPreview(media: media).padding(16).frame(width: 480)
        }
    }
}

private struct TypingRow: View {
    @Environment(AppModel.self) private var model
    let ids: [UUID]
    @State private var phase = 0
    var body: some View {
        HStack {
            Text(ids.compactMap { model.accounts[$0]?.displayName }.joined(separator: ", "))
            Text(["·", "··", "···"][phase]).monospaced().frame(width: 24, alignment: .leading)
            Spacer()
        }
        .font(.caption).foregroundStyle(Brand.muted)
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(350)); phase = (phase + 1) % 3
            }
        }
    }
}

private struct ComposerView: View {
    @Environment(AppModel.self) private var model
    @State private var selectedSuggestion = 0

    private struct SlashCommand: Identifiable {
        let name: String
        let summary: String
        var id: String { name }
    }

    private enum Suggestion: Identifiable {
        case mention(Account)
        case command(SlashCommand)

        var id: String {
            switch self {
            case let .mention(account): "mention:\(account.id)"
            case let .command(command): "command:\(command.name)"
            }
        }
    }

    private static let commands = [
        SlashCommand(name: "/thinking", summary: "Toggle live agent work status"),
        SlashCommand(name: "/status", summary: "Show this agent session’s state"),
        SlashCommand(name: "/stop", summary: "Stop and pause current agent work"),
        SlashCommand(name: "/resume", summary: "Resume queued work in this chat"),
        SlashCommand(name: "/reset-session", summary: "Start a fresh agent session"),
        SlashCommand(name: "/new-worktree", summary: "Create isolated project work"),
        SlashCommand(name: "/tardy", summary: "Publish the last result as a Tardy"),
    ]

    private var mentionToken: (range: Range<String.Index>, query: String)? {
        guard let at = model.composer.lastIndex(of: "@") else { return nil }
        if at != model.composer.startIndex {
            let before = model.composer[model.composer.index(before: at)]
            guard before.isWhitespace else { return nil }
        }
        let after = model.composer.index(after: at)
        let suffix = model.composer[after...]
        guard !suffix.contains(where: \Character.isWhitespace) else { return nil }
        return (at..<model.composer.endIndex, String(suffix).lowercased())
    }

    private var mentionCandidates: [Account] {
        guard let token = mentionToken else { return [] }
        let participantIDs = model.selectedConversation?.participants ?? []
        let preferred = participantIDs.compactMap { model.accounts[$0] } + model.ownedAgents
        var seen = Set<UUID>()
        return preferred.filter { account in
            guard account.id != model.account?.id, seen.insert(account.id).inserted else { return false }
            return token.query.isEmpty
                || account.handle.lowercased().hasPrefix(token.query)
                || account.displayName.lowercased().contains(token.query)
        }.prefix(6).map { $0 }
    }

    private var commandCandidates: [SlashCommand] {
        let text = model.composer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.hasPrefix("/"), !text.dropFirst().contains(where: \Character.isWhitespace) else { return [] }
        return Self.commands.filter { text == "/" || $0.name.hasPrefix(text.lowercased()) }
    }

    private var suggestions: [Suggestion] {
        if !mentionCandidates.isEmpty { return mentionCandidates.map(Suggestion.mention) }
        return commandCandidates.map(Suggestion.command)
    }

    private func acceptMention(_ account: Account) {
        guard let token = mentionToken else { return }
        model.composer.replaceSubrange(token.range, with: "@\(account.handle) ")
        selectedSuggestion = 0
        model.composerChanged()
    }

    private func acceptCommand(_ command: SlashCommand) {
        model.composer = "\(command.name) "
        selectedSuggestion = 0
        model.composerChanged()
    }

    private func acceptSuggestion(_ suggestion: Suggestion? = nil) {
        guard let suggestion = suggestion ?? suggestions[safe: min(selectedSuggestion, suggestions.count - 1)] else { return }
        switch suggestion {
        case let .mention(account): acceptMention(account)
        case let .command(command): acceptCommand(command)
        }
    }

    var body: some View {
        @Bindable var model = model
        VStack(alignment: .leading, spacing: 6) {
            if !suggestions.isEmpty {
                AutocompletePalette(
                    items: suggestions,
                    selection: $selectedSuggestion,
                    onSelect: acceptSuggestion
                ) { suggestion in
                    HStack(spacing: 9) {
                        switch suggestion {
                        case let .mention(account):
                            Group {
                                Avatar(account: account, size: 28)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(account.displayName).font(.subheadline.weight(.semibold))
                                    Text("@\(account.handle)").font(.caption).foregroundStyle(Brand.muted)
                                }
                                Spacer()
                                if account.kind == .agent {
                                    Label("Tardy", systemImage: "sparkles")
                                        .font(.caption2.bold()).foregroundStyle(Brand.yellow)
                                }
                            }
                        case let .command(command):
                            Group {
                                Image(systemName: "terminal.fill")
                                    .frame(width: 24).foregroundStyle(Brand.yellow)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(command.name).font(.system(.subheadline, design: .monospaced).bold())
                                    Text(command.summary).font(.caption).foregroundStyle(Brand.muted)
                                }
                                Spacer()
                            }
                        }
                    }
                }
            }
            HStack(alignment: .bottom, spacing: 10) {
                Button { } label: { Image(systemName: "plus.circle.fill").font(.title2) }
                    .buttonStyle(.plain).foregroundStyle(Brand.yellow).help("Attach a file")
                TextField("Message…  Use @ to summon a Tardy", text: $model.composer, axis: .vertical)
                    .textFieldStyle(.plain).lineLimit(1...6).padding(10)
                    .background(Brand.raised, in: RoundedRectangle(cornerRadius: 12))
                    .onChange(of: model.composer) { _, _ in
                        selectedSuggestion = 0
                        model.composerChanged()
                    }
                    .onSubmit {
                        if suggestions.isEmpty { Task { await model.send() } }
                        else { acceptSuggestion() }
                    }
                    .onKeyPress(.tab) {
                        guard !suggestions.isEmpty else { return .ignored }
                        acceptSuggestion()
                        return .handled
                    }
                    .onKeyPress(.upArrow) {
                        guard !suggestions.isEmpty else { return .ignored }
                        selectedSuggestion = max(0, selectedSuggestion - 1)
                        return .handled
                    }
                    .onKeyPress(.downArrow) {
                        guard !suggestions.isEmpty else { return .ignored }
                        selectedSuggestion = min(suggestions.count - 1, selectedSuggestion + 1)
                        return .handled
                    }
                Button { Task { await model.send() } } label: {
                    Image(systemName: "arrow.up.circle.fill").font(.system(size: 27))
                }
                .buttonStyle(.plain).foregroundStyle(Brand.yellow)
                .disabled(model.composer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isSending)
            }
        }
        .padding(14).background(Brand.panel)
    }
}

private struct AutocompletePalette<Item: Identifiable, Row: View>: View {
    let items: [Item]
    @Binding var selection: Int
    let onSelect: (Item) -> Void
    let row: (Item) -> Row

    init(
        items: [Item],
        selection: Binding<Int>,
        onSelect: @escaping (Item) -> Void,
        @ViewBuilder row: @escaping (Item) -> Row
    ) {
        self.items = items
        _selection = selection
        self.onSelect = onSelect
        self.row = row
    }

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                Button { onSelect(item) } label: {
                    row(item)
                        .padding(.horizontal, 10).padding(.vertical, 7)
                        .background(index == selection ? Brand.raised : Color.clear)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(5)
        .background(Brand.panel, in: RoundedRectangle(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).stroke(Brand.yellow.opacity(0.25)) }
        .frame(maxWidth: 460)
    }
}

private extension Collection {
    subscript(safe index: Index) -> Element? { indices.contains(index) ? self[index] : nil }
}

private struct ContextInspector: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("CONTEXT").font(.caption.bold()).foregroundStyle(Brand.yellow)
                if let conversation = model.selectedConversation {
                    if let agent = conversation.agentPeer(accounts: model.accounts, viewer: model.account?.id) {
                        AgentWorkPanel(
                            agent: agent,
                            working: model.typingProfileIds.contains(agent.id),
                            messages: model.messages
                        )
                        Divider()
                    }
                    SectionLabel("In this chat")
                    ForEach(conversation.participants, id: \.self) { id in
                        if let account = model.accounts[id] {
                            Button { model.openProfile(account.id) } label: {
                                ParticipantRow(account: account, active: true)
                            }
                            .buttonStyle(.plain)
                            .help("Open @\(account.handle)")
                        }
                    }
                    let availableAgents = model.ownedAgents.filter { !conversation.participants.contains($0.id) }
                    if !availableAgents.isEmpty {
                        Divider()
                        SectionLabel("Add a Tardy")
                        Text("Invite one of your agents into this chat to start shared work.")
                            .font(.caption).foregroundStyle(Brand.muted)
                        ForEach(availableAgents) { agent in
                            HStack {
                                Button { model.openProfile(agent.id) } label: {
                                    ParticipantRow(account: agent, active: false)
                                }
                                .buttonStyle(.plain)
                                .help("Open @\(agent.handle)")
                                Spacer()
                                Button("Add") { Task { await model.summon(agent) } }
                                    .buttonStyle(.bordered).controlSize(.small)
                            }
                        }
                    }
                    Divider()
                    SectionLabel("Thread")
                    Label(conversation.mode == .work ? "Agent context enabled" : "Chat until an agent is summoned", systemImage: conversation.mode == .work ? "sparkles" : "bubble.left")
                        .font(.caption).foregroundStyle(Brand.muted)
                }
            }
            .padding(18)
        }
        .background(Brand.panel)
    }
}

private struct AgentWorkPanel: View {
    let agent: Account
    let working: Bool
    let messages: [Message]
    @State private var expanded = true

    private var recentArtifacts: [MessageMedia] {
        Array(messages.reversed().filter { $0.senderProfileId == agent.id }.flatMap(\.media).prefix(5))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button { withAnimation(.snappy) { expanded.toggle() } } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("LIVE WORK").font(.caption.bold()).foregroundStyle(Brand.yellow)
                        Text(working ? "\(agent.displayName) is working" : "Session ready")
                            .font(.subheadline.weight(.semibold)).foregroundStyle(.white)
                    }
                    Spacer()
                    if working { ProgressView().controlSize(.small).tint(Brand.yellow) }
                    Image(systemName: expanded ? "chevron.up" : "chevron.down")
                        .font(.caption).foregroundStyle(Brand.muted)
                }
            }
            .buttonStyle(.plain)

            if expanded {
                Label("Durable 1:1 context", systemImage: "arrow.triangle.2.circlepath")
                    .font(.caption).foregroundStyle(Brand.muted)
                if recentArtifacts.isEmpty {
                    Text(working ? "Commands, edits, tests, and artifacts will appear here as the host reports them." : "No recent artifacts in this session.")
                        .font(.caption).foregroundStyle(Brand.muted)
                } else {
                    ForEach(recentArtifacts) { media in
                        HStack(spacing: 8) {
                            Image(systemName: media.type == "image" ? "photo" : media.type == "video" ? "play.rectangle" : "doc")
                                .foregroundStyle(Brand.yellow)
                            Text(media.fileName ?? media.type.capitalized).font(.caption).lineLimit(1)
                        }
                    }
                }
                Text("Shows work telemetry, not private model reasoning.")
                    .font(.caption2).foregroundStyle(Brand.muted.opacity(0.75))
            }
        }
        .padding(12)
        .background(Brand.raised, in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct ParticipantRow: View {
    let account: Account
    let active: Bool
    var body: some View {
        HStack(spacing: 9) {
            Avatar(account: account, size: 30)
            VStack(alignment: .leading, spacing: 1) {
                Text(account.displayName).font(.subheadline.weight(.medium)).lineLimit(1)
                Text("@\(account.handle)").font(.caption2).foregroundStyle(Brand.muted)
            }
            if account.kind == .agent { Image(systemName: "sparkles").font(.caption2).foregroundStyle(Brand.yellow) }
            if active { Circle().fill(.green).frame(width: 6, height: 6) }
        }
    }
}

private struct SectionLabel: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View { Text(text).font(.caption.bold()).foregroundStyle(Brand.muted) }
}

struct Avatar: View {
    let account: Account?
    let size: CGFloat
    var body: some View {
        AsyncImage(url: account?.avatarURL) { phase in
            if let image = phase.image { image.resizable().scaledToFill() }
            else {
                ZStack {
                    Circle().fill(account?.kind == .agent ? Brand.yellow : Brand.raised)
                    Text(account?.displayName.first.map(String.init) ?? "?")
                        .font(.system(size: size * 0.38, weight: .bold)).foregroundStyle(account?.kind == .agent ? .black : .white)
                }
            }
        }
        .frame(width: size, height: size).clipShape(Circle())
    }
}
