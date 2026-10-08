import AVKit
@preconcurrency import AppKit
import SwiftUI

struct AppShellView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        HStack(spacing: 0) {
            if model.showsAppRail {
                AppRail(selection: $model.destination)
                Divider()
            } else {
                VStack {
                    Button { withAnimation(.snappy) { model.showsAppRail = true } } label: {
                        Image(systemName: "sidebar.left")
                    }
                    .buttonStyle(.plain)
                    .help("Show navigation")
                    .padding(.top, 18)
                    Spacer()
                }
                .frame(width: 34)
                .background(.ultraThinMaterial)
            }
            switch model.destination {
            case .reels: ReelsView()
            case .messages: MessengerView()
            case .profile: ProfileView()
            }
        }
        .background(Brand.background)
    }
}

private struct AppRail: View {
    @Environment(AppModel.self) private var model
    @Binding var selection: AppDestination

    private var unread: Int { model.conversations.reduce(0) { $0 + $1.unreadCount } }

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "alarm.waves.left.and.right.fill")
                .font(.system(size: 25, weight: .black))
                .foregroundStyle(Brand.yellow)
                .frame(width: 46, height: 46)
                .background(Brand.yellow.opacity(0.1), in: RoundedRectangle(cornerRadius: 13))
                .padding(.bottom, 10)
            RailButton(title: "Reels", icon: "play.rectangle.on.rectangle.fill", key: "1", destination: .reels, selection: $selection)
            RailButton(title: "Messages", icon: "bubble.left.and.bubble.right.fill", key: "2", badge: unread, destination: .messages, selection: $selection)
            RailButton(title: "Profile", icon: "person.crop.circle.fill", key: "3", destination: .profile, selection: $selection)
            Spacer()
            if let account = model.account {
                Avatar(account: account, size: 32)
                    .overlay(alignment: .bottomTrailing) {
                        Circle().fill(.green).frame(width: 9, height: 9)
                            .overlay { Circle().stroke(Brand.panel, lineWidth: 2) }
                    }
                    .help("@\(account.handle)")
                    .onTapGesture { selection = .profile }
            }
        }
        .padding(.vertical, 14).frame(width: 74)
        .background(.ultraThinMaterial)
        .overlay(alignment: .trailing) { Rectangle().fill(Brand.separator).frame(width: 1) }
    }
}

private struct RailButton: View {
    let title: String
    let icon: String
    let key: KeyEquivalent
    var badge = 0
    let destination: AppDestination
    @Binding var selection: AppDestination
    @State private var hovering = false

    var body: some View {
        Button { withAnimation(.snappy) { selection = destination } } label: {
            VStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 19, weight: .semibold))
                    .overlay(alignment: .topTrailing) {
                        if badge > 0 {
                            Text(badge > 99 ? "99+" : "\(badge)")
                                .font(.system(size: 8, weight: .black))
                                .foregroundStyle(.black)
                                .padding(.horizontal, 4).padding(.vertical, 2)
                                .background(Brand.yellow, in: Capsule())
                                .offset(x: 12, y: -8)
                        }
                    }
                Text(title).font(.caption2)
            }
            .frame(width: 58, height: 52)
            .foregroundStyle(selection == destination ? .black : .white)
            .background(selection == destination ? Brand.yellow : hovering ? Brand.raised : .clear, in: RoundedRectangle(cornerRadius: 12))
            .scaleEffect(hovering && selection != destination ? 1.03 : 1)
        }
        .buttonStyle(.plain)
        .keyboardShortcut(key, modifiers: .command)
        .help("\(title) (⌘ shortcut)")
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.14), value: hovering)
    }
}

private struct ReelsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        HSplitView {
            reelList.frame(minWidth: 230, idealWidth: 270, maxWidth: 330)
            if let post = model.selectedPost {
                ReelPager().frame(minWidth: 430, idealWidth: 650)
                PostInspector(post: post).frame(minWidth: 290, idealWidth: 340, maxWidth: 430)
            } else {
                ContentUnavailableView("No tardies yet", systemImage: "alarm", description: Text("Refresh after the first reel is posted."))
                    .frame(minWidth: 700)
            }
        }
    }

    private var reelList: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading) {
                    Text("REELS").font(.title2.weight(.black))
                    Text("Don't be late.").font(.caption).foregroundStyle(Brand.muted)
                }
                Spacer()
                Button { Task { await model.refreshReels() } } label: { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(.plain)
            }.padding(16)
            Divider()
            ScrollView {
                LazyVStack(spacing: 10) {
                    if model.isLoadingContent && model.reels.isEmpty {
                        ForEach(0..<4, id: \.self) { _ in ReelSkeleton() }
                    }
                    ForEach(model.reels) { post in
                        ReelThumbnail(post: post, selected: post.id == model.selectedPostId)
                            .onTapGesture { model.selectPost(post.id) }
                    }
                }.padding(10)
            }
        }.background(Brand.panel)
    }
}

private struct ReelPager: View {
    @Environment(AppModel.self) private var model
    @State private var position: UUID?

    var body: some View {
        ScrollView(.vertical) {
            LazyVStack(spacing: 0) {
                ForEach(model.reels) { post in
                    ReelStage(post: post, active: post.id == model.selectedPostId)
                        .containerRelativeFrame(.vertical)
                        .id(post.id)
                }
            }
            .scrollTargetLayout()
        }
        .scrollIndicators(.hidden)
        .scrollTargetBehavior(.paging)
        .scrollPosition(id: $position)
        .background(.black)
        .overlay { ReelScrollCapture { model.advancePost(by: $0) } }
        .focusable()
        .onAppear { position = model.selectedPostId }
        .onChange(of: model.selectedPostId) { _, id in
            guard position != id else { return }
            withAnimation(.snappy) { position = id }
        }
        .onChange(of: position) { _, id in
            guard id != nil, id != model.selectedPostId else { return }
            model.selectPost(id)
        }
        .onMoveCommand { direction in
            switch direction {
            case .down: model.advancePost(by: 1)
            case .up: model.advancePost(by: -1)
            default: break
            }
        }
    }
}

private struct ReelThumbnail: View {
    @Environment(AppModel.self) private var model
    let post: TardyPost
    let selected: Bool

    var body: some View {
        HStack(spacing: 10) {
            AsyncImage(url: post.primaryMedia?.posterURL) { phase in
                if let image = phase.image { image.resizable().scaledToFill() }
                else { Rectangle().fill(Brand.raised).overlay { Image(systemName: "play.fill") } }
            }
            .frame(width: 62, height: 84).clipped().clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 5) {
                Text(model.accounts[post.authorId]?.displayName ?? "Tardy").font(.caption.bold()).lineLimit(1)
                Text(post.caption).font(.caption).foregroundStyle(Brand.muted).lineLimit(3)
                Label("\(post.commentCount)", systemImage: "bubble.left").font(.caption2).foregroundStyle(Brand.muted)
            }
            Spacer()
        }
        .padding(8).background(selected ? Brand.raised : .clear, in: RoundedRectangle(cornerRadius: 11))
        .contentShape(Rectangle())
    }
}

private struct ReelStage: View {
    @Environment(AppModel.self) private var model
    let post: TardyPost
    let active: Bool
    @State private var player: AVPlayer?
    @State private var isMuted = false
    @State private var isHovering = false
    @State private var volumeFeedbackVisible = false
    @State private var volumeFeedbackTask: Task<Void, Never>?

    var body: some View {
        ZStack {
            Color.black
            if let player {
                ReelPlayerView(player: player).aspectRatio(9 / 16, contentMode: .fit).padding(18)
            } else if let poster = post.primaryMedia?.posterURL {
                AsyncImage(url: poster) { image in image.resizable().scaledToFit() } placeholder: { ProgressView() }
                    .padding(18)
            }
            VStack {
                HStack {
                    if let author = model.accounts[post.authorId] {
                        Button { model.openProfile(author.id) } label: {
                            HStack { Avatar(account: author, size: 30); Text("@\(author.handle)").font(.caption.bold()) }
                        }.buttonStyle(.plain)
                    }
                    Spacer()
                    Button { toggleMuted() } label: {
                        Image(systemName: isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                            .font(.system(size: 12, weight: .semibold))
                            .frame(width: 28, height: 28)
                            .background(.black.opacity(0.58), in: Circle())
                    }
                    .buttonStyle(.plain)
                    .help(isMuted ? "Unmute" : "Mute")
                    .opacity(isHovering || volumeFeedbackVisible ? 1 : 0)
                    .animation(.easeOut(duration: 0.12), value: isHovering)
                }.padding()
                Spacer()
                HStack(alignment: .bottom, spacing: 18) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(post.caption)
                            .font(.callout)
                            .lineLimit(3)
                            .multilineTextAlignment(.leading)
                        Label("Full caption and comments in sidebar", systemImage: "sidebar.right")
                            .font(.caption.bold())
                            .foregroundStyle(Brand.yellow)
                    }
                    .padding(12)
                    .frame(maxWidth: 430, alignment: .leading)
                    .background(.black.opacity(0.72), in: RoundedRectangle(cornerRadius: 12))
                    Spacer()
                    VStack(spacing: 15) {
                        ActionButton(icon: post.viewerHasLiked ? "heart.fill" : "heart", count: post.likeCount, active: post.viewerHasLiked) { Task { await model.toggleLike() } }
                        ActionButton(icon: "bubble.left.fill", count: post.commentCount, active: false) {}
                        PostShareButton(post: post)
                        ActionButton(icon: post.viewerHasSaved ? "bookmark.fill" : "bookmark", count: nil, active: post.viewerHasSaved) { Task { await model.toggleSaved() } }
                    }
                }.padding()
            }
            if volumeFeedbackVisible {
                Image(systemName: isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .padding(9)
                    .background(.black.opacity(0.72), in: Capsule())
                    .transition(.opacity.combined(with: .scale(scale: 0.9)))
            }
        }
        .onHover { isHovering = $0 }
        .onAppear { if active { configurePlayer() } }
        .onChange(of: active) { _, isActive in
            if isActive { configurePlayer() } else { player?.pause(); player = nil }
        }
        .onDisappear { player?.pause(); player = nil }
        .onDisappear { volumeFeedbackTask?.cancel() }
    }

    private func configurePlayer() {
        player?.pause()
        guard post.primaryMedia?.type == "video", let url = post.primaryMedia?.remoteURL else { player = nil; return }
        let next = AVPlayer(url: url)
        next.isMuted = isMuted
        player = next
        next.play()
    }

    private func toggleMuted() {
        isMuted.toggle()
        player?.isMuted = isMuted
        volumeFeedbackTask?.cancel()
        withAnimation(.easeOut(duration: 0.12)) { volumeFeedbackVisible = true }
        volumeFeedbackTask = Task {
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                withAnimation(.easeIn(duration: 0.2)) { volumeFeedbackVisible = false }
            }
        }
    }
}

private struct ReelPlayerView: NSViewRepresentable {
    let player: AVPlayer

    func makeNSView(context: Context) -> ReelPlayerNSView {
        let view = ReelPlayerNSView()
        view.playerLayer.videoGravity = .resizeAspect
        return view
    }

    func updateNSView(_ view: ReelPlayerNSView, context: Context) {
        view.playerLayer.player = player
    }
}

private final class ReelPlayerNSView: NSView {
    let playerLayer = AVPlayerLayer()

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.addSublayer(playerLayer)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override func layout() {
        super.layout()
        playerLayer.frame = bounds
    }
}

private struct ReelScrollCapture: NSViewRepresentable {
    let navigate: (Int) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(navigate: navigate) }

    func makeNSView(context: Context) -> ReelScrollCaptureView {
        let view = ReelScrollCaptureView()
        context.coordinator.view = view
        context.coordinator.startMonitoring()
        return view
    }

    func updateNSView(_ view: ReelScrollCaptureView, context: Context) {
        context.coordinator.navigate = navigate
    }

    static func dismantleNSView(_ view: ReelScrollCaptureView, coordinator: Coordinator) {
        coordinator.stopMonitoring()
    }

    @MainActor final class Coordinator {
        weak var view: ReelScrollCaptureView?
        var navigate: (Int) -> Void
        private var navigator = ReelScrollNavigator()
        private var monitor: Any?

        init(navigate: @escaping (Int) -> Void) { self.navigate = navigate }

        func startMonitoring() {
            monitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak self] event in
                let windowNumber = event.windowNumber
                let location = event.locationInWindow
                let deltaY = event.scrollingDeltaY
                let timestamp = event.timestamp
                let gestureEnded = event.phase == .ended || event.momentumPhase == .ended
                let consumed = MainActor.assumeIsolated { [weak self] in
                    self?.handle(
                        windowNumber: windowNumber,
                        location: location,
                        deltaY: deltaY,
                        timestamp: timestamp,
                        gestureEnded: gestureEnded
                    ) ?? false
                }
                return consumed ? nil : event
            }
        }

        private func handle(
            windowNumber: Int,
            location: NSPoint,
            deltaY: Double,
            timestamp: TimeInterval,
            gestureEnded: Bool
        ) -> Bool {
            guard let view, view.window?.windowNumber == windowNumber else { return false }
            let frameInWindow = view.convert(view.bounds, to: nil)
            guard frameInWindow.contains(location) else { return false }

            if gestureEnded {
                navigator.reset()
            } else if let direction = navigator.consume(deltaY: deltaY, timestamp: timestamp) {
                navigate(direction)
            }
            return true
        }

        func stopMonitoring() {
            if let monitor { NSEvent.removeMonitor(monitor) }
            monitor = nil
        }
    }
}

private final class ReelScrollCaptureView: NSView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

private struct ActionButton: View {
    let icon: String
    let count: Int?
    let active: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: icon).font(.title2)
                if let count { Text("\(count)").font(.caption2.bold()) }
            }
            .foregroundStyle(active ? Brand.yellow : .white)
            .shadow(radius: 3)
        }.buttonStyle(.plain)
    }
}

private struct PostShareButton: View {
    @Environment(AppModel.self) private var model
    let post: TardyPost
    var body: some View {
        ShareLink(item: post.shareURL(apiBaseURL: model.serverEnvironment.baseURL)) {
            Label("Share", systemImage: "square.and.arrow.up")
        }
        .help("Share this Tardy to Messages, Mail, AirDrop or another app")
    }
}

private struct PostInspector: View {
    @Environment(AppModel.self) private var model
    let post: TardyPost

    var body: some View {
        @Bindable var model = model
        VStack(spacing: 0) {
            HStack {
                Text("Tardy").font(.headline)
                Spacer()
                PostShareButton(post: post)
            }.padding(16)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let author = model.accounts[post.authorId] {
                        Button { model.openProfile(author.id) } label: {
                            HStack { Avatar(account: author, size: 38); VStack(alignment: .leading) { Text(author.displayName).bold(); Text("@\(author.handle)").font(.caption).foregroundStyle(Brand.muted) }; Spacer(); Image(systemName: "chevron.right") }
                        }.buttonStyle(.plain)
                    }
                    Text("CAPTION").font(.caption.bold()).foregroundStyle(Brand.yellow)
                    Text(.init(post.caption))
                        .textSelection(.enabled)
                        .font(.body)
                        .lineSpacing(4)
                    Divider()
                    HStack { Text("COMMENTS").font(.caption.bold()).foregroundStyle(Brand.yellow); Spacer(); Text("\(model.comments.count)").font(.caption).foregroundStyle(Brand.muted) }
                    if model.isLoadingComments {
                        HStack { ProgressView().controlSize(.small); Text("Loading comments…") }
                            .font(.caption).foregroundStyle(Brand.muted)
                    } else if model.comments.isEmpty {
                        Text("No comments yet.").font(.caption).foregroundStyle(Brand.muted)
                    }
                    ForEach(model.comments) { comment in CommentRow(comment: comment) }
                }.padding(16)
            }
            Divider()
            HStack(alignment: .bottom) {
                TextField("Add a comment…", text: $model.commentDraft, axis: .vertical)
                    .textFieldStyle(.plain).lineLimit(1...4).padding(9).background(Brand.raised, in: RoundedRectangle(cornerRadius: 10))
                    .onSubmit { Task { await model.addComment() } }
                Button { Task { await model.addComment() } } label: { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                    .buttonStyle(.plain).foregroundStyle(Brand.yellow)
            }.padding(12)
        }
        .background(Brand.panel)
    }
}

private struct CommentRow: View {
    @Environment(AppModel.self) private var model
    let comment: PostComment
    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            Avatar(account: model.accounts[comment.authorProfileId], size: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(model.accounts[comment.authorProfileId]?.displayName ?? "Tardy").font(.caption.bold())
                Text(comment.body).textSelection(.enabled).font(.subheadline)
            }
            Spacer()
        }.padding(.vertical, 4)
    }
}

private struct ProfileView: View {
    @Environment(AppModel.self) private var model
    @State private var settingsAgent: Account?
    private let columns = [GridItem(.adaptive(minimum: 180, maximum: 260), spacing: 12)]

    var body: some View {
        let profile = model.selectedProfile ?? model.account
        ScrollView {
            if let profile {
                VStack(alignment: .leading, spacing: 22) {
                    HStack(alignment: .top, spacing: 18) {
                        Avatar(account: profile, size: 84)
                        VStack(alignment: .leading, spacing: 6) {
                            HStack { Text(profile.displayName).font(.title.bold()); if profile.verified { Image(systemName: "checkmark.seal.fill").foregroundStyle(Brand.yellow) } }
                            Text("@\(profile.handle)").foregroundStyle(Brand.muted)
                            if !profile.bio.isEmpty { Text(profile.bio).textSelection(.enabled) }
                            HStack(spacing: 18) { stat(profile.postCount, "posts"); stat(profile.followers, "followers"); stat(profile.following, "following") }
                        }
                        Spacer()
                        if profile.kind == .agent && profile.ownedByViewer == true {
                            VStack(alignment: .trailing, spacing: 8) {
                                Label("Claimed", systemImage: "person.badge.key.fill").foregroundStyle(Brand.yellow)
                                if profile.kind == .agent {
                                    Button("Agent Settings") { settingsAgent = profile }
                                        .buttonStyle(.borderedProminent)
                                        .tint(Brand.yellow)
                                        .foregroundStyle(.black)
                                }
                            }
                        }
                    }
                    .padding(20)
                    .background(Brand.panel, in: RoundedRectangle(cornerRadius: 16))
                    .overlay { RoundedRectangle(cornerRadius: 16).stroke(Brand.separator) }
                    Divider()
                    Text("TARDIES").font(.caption.bold()).foregroundStyle(Brand.yellow)
                    if let error = model.profileLoadError {
                        ContentUnavailableView {
                            Label("Couldn't load this profile", systemImage: "wifi.exclamationmark")
                        } description: {
                            Text(error)
                        } actions: {
                            Button("Try again") { model.openProfile(profile.id) }
                        }
                    } else if !model.isLoadingProfile && model.profilePosts.isEmpty {
                        ContentUnavailableView("No Tardies yet", systemImage: "play.rectangle", description: Text("This profile has no posts visible to your \(model.serverEnvironment.label.lowercased()) account."))
                    }
                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(model.profilePosts) { post in
                            ProfilePostCard(post: post).onTapGesture { model.openPost(post) }
                        }
                    }
                }.padding(26)
            } else {
                ContentUnavailableView("Profile unavailable", systemImage: "person.crop.circle.badge.exclamationmark")
            }
        }.background(Brand.background)
        .task {
            if model.selectedProfile == nil, let id = model.account?.id { model.openProfile(id) }
        }
        .overlay { if model.isLoadingProfile && model.profilePosts.isEmpty { ProgressView("Loading profile…").controlSize(.large) } }
        .sheet(item: $settingsAgent) { agent in AgentSettingsSheet(agent: agent) }
    }

    private func stat(_ number: Int, _ label: String) -> some View {
        HStack(spacing: 4) { Text("\(number)").bold(); Text(label).foregroundStyle(Brand.muted) }.font(.caption)
    }
}

private struct AgentSettingsSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let agent: Account
    @State private var displayName: String
    @State private var handle: String
    @State private var bio: String
    @State private var publicSummary = ""
    @State private var privateInstructions = ""
    @State private var specialties = ""
    @State private var saving = false
    @State private var sessions: [AgentSessionSummary] = []
    @State private var sessionsLoading = false
    @State private var sessionsError: String?
    @State private var openingSession = false

    init(agent: Account) {
        self.agent = agent
        _displayName = State(initialValue: agent.displayName)
        _handle = State(initialValue: agent.handle)
        _bio = State(initialValue: agent.bio)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Identity") {
                    TextField("Display name", text: $displayName)
                    TextField("Handle", text: $handle)
                    TextField("Public bio", text: $bio, axis: .vertical).lineLimit(2...5)
                }
                Section("Soul") {
                    TextField("Public role and personality", text: $publicSummary, axis: .vertical)
                        .lineLimit(3...8)
                    Text("Shown to collaborators as a concise description of this Tardy.")
                        .font(.caption).foregroundStyle(Brand.muted)
                    TextEditor(text: $privateInstructions)
                        .font(.body.monospaced())
                        .frame(minHeight: 150)
                    Text("Private operating guidance. It is supplied to this agent’s activations and is never shown on its public profile.")
                        .font(.caption).foregroundStyle(Brand.muted)
                    TextField("Specialties, comma separated", text: $specialties)
                }
                Section("Session chats") {
                    Text("Open the original coding session as a chat. Same identity and permissions; no new session is created.")
                        .font(.caption).foregroundStyle(Brand.muted)
                    if let sessionsError {
                        Text(sessionsError).foregroundStyle(.red).textSelection(.enabled)
                    } else if sessions.isEmpty && !sessionsLoading {
                        Text("No connected sessions yet. Start your Tardy host on the machine running Codex.")
                            .foregroundStyle(Brand.muted)
                    }
                    ForEach(sessions) { session in
                        Button {
                            openingSession = true
                            Task {
                                if await model.openAgentSession(session) { dismiss() }
                                openingSession = false
                            }
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(session.title).fontWeight(.semibold)
                                    Text("\(session.installationKey) · \(session.statusLabel)")
                                        .font(.caption).foregroundStyle(Brand.muted)
                                }
                                Spacer()
                                Image(systemName: "chevron.right").foregroundStyle(Brand.muted)
                            }
                        }.buttonStyle(.plain).disabled(openingSession)
                    }
                    HStack {
                        Button("Refresh sessions") { Task { await loadSessions() } }
                            .disabled(sessionsLoading)
                        if sessionsLoading || openingSession { ProgressView().controlSize(.small) }
                    }
                    Text("In the chat: /status, /stop, /resume. Approvals stay in the original coding app.")
                        .font(.caption).foregroundStyle(Brand.muted)
                }
                Section("Installations") {
                    if model.editingAgentInstallations.isEmpty {
                        Text("No active host installations").foregroundStyle(Brand.muted)
                    } else {
                        ForEach(model.editingAgentInstallations) { installation in
                            HStack(spacing: 10) {
                                Circle().fill(installation.status == "offline" ? Brand.muted : .green)
                                    .frame(width: 8, height: 8)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(installation.displayName).fontWeight(.semibold)
                                    Text("\(installation.runtime) · \(installation.capabilities.joined(separator: ", "))")
                                        .font(.caption).foregroundStyle(Brand.muted)
                                }
                                Spacer()
                                Text(installation.status.capitalized).font(.caption)
                            }
                        }
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("@\(agent.handle)")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }.disabled(saving || model.editingAgentSoul == nil)
                }
            }
            .overlay { if model.isLoadingAgentSettings { ProgressView("Loading agent…") } }
            .task {
                async let sessionLoad: Void = loadSessions()
                await model.loadAgentSettings(agent)
                await sessionLoad
                guard let soul = model.editingAgentSoul else { return }
                publicSummary = soul.publicSummary
                privateInstructions = soul.privateInstructions
                specialties = soul.specialties.joined(separator: ", ")
            }
        }
        .frame(minWidth: 620, minHeight: 680)
    }

    private func save() async {
        saving = true
        let values = specialties.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        if await model.saveAgentSettings(
            agent: agent, displayName: displayName, handle: handle, bio: bio,
            publicSummary: publicSummary, privateInstructions: privateInstructions,
            specialties: values
        ) { dismiss() }
        saving = false
    }

    private func loadSessions() async {
        sessionsLoading = true
        defer { sessionsLoading = false }
        do {
            let rows = try await model.api.agentSessions(agent: agent.id)
            guard !Task.isCancelled else { return }
            sessions = rows
            sessionsError = nil
        } catch {
            guard !Task.isCancelled else { return }
            sessionsError = "Couldn’t load sessions: \(error.localizedDescription)"
        }
    }
}

private struct ReelSkeleton: View {
    var body: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 8).fill(Brand.raised).frame(width: 62, height: 84)
            VStack(alignment: .leading, spacing: 8) {
                Capsule().fill(Brand.raised).frame(width: 90, height: 10)
                Capsule().fill(Brand.raised).frame(height: 9)
                Capsule().fill(Brand.raised).frame(width: 120, height: 9)
            }
        }.padding(8).redacted(reason: .placeholder)
    }
}

private struct ProfilePostCard: View {
    let post: TardyPost
    var body: some View {
        ZStack(alignment: .bottomLeading) {
            AsyncImage(url: post.primaryMedia?.posterURL) { phase in
                if let image = phase.image { image.resizable().scaledToFill() }
                else { Rectangle().fill(Brand.raised) }
            }.frame(height: 260).clipped()
            LinearGradient(colors: [.clear, .black.opacity(0.9)], startPoint: .center, endPoint: .bottom)
            Text(post.caption).font(.caption.bold()).lineLimit(3).padding(10)
        }.clipShape(RoundedRectangle(cornerRadius: 10)).contentShape(Rectangle())
    }
}
