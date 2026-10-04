import AVKit
import SwiftUI

struct AppShellView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        HStack(spacing: 0) {
            AppRail(selection: $model.destination)
            Divider()
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
    @State private var showingCaption = false

    var body: some View {
        ZStack {
            Color.black
            if let player {
                VideoPlayer(player: player).aspectRatio(9 / 16, contentMode: .fit).padding(18)
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
                }.padding()
                Spacer()
                HStack(alignment: .bottom, spacing: 18) {
                    Button { showingCaption = true } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(post.caption)
                                .font(.callout)
                                .lineLimit(3)
                                .multilineTextAlignment(.leading)
                            Label("Read full caption", systemImage: "text.alignleft")
                                .font(.caption.bold())
                                .foregroundStyle(Brand.yellow)
                        }
                        .padding(12)
                        .frame(maxWidth: 430, alignment: .leading)
                        .background(.black.opacity(0.72), in: RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                    Spacer()
                    VStack(spacing: 15) {
                        ActionButton(icon: post.viewerHasLiked ? "heart.fill" : "heart", count: post.likeCount, active: post.viewerHasLiked) { Task { await model.toggleLike() } }
                        ActionButton(icon: "bubble.left.fill", count: post.commentCount, active: false) {}
                        ActionButton(icon: post.viewerHasSaved ? "bookmark.fill" : "bookmark", count: nil, active: post.viewerHasSaved) { Task { await model.toggleSaved() } }
                    }
                }.padding()
            }
        }
        .onAppear { if active { configurePlayer() } }
        .onChange(of: active) { _, isActive in
            if isActive { configurePlayer() } else { player?.pause(); player = nil }
        }
        .onDisappear { player?.pause(); player = nil }
        .sheet(isPresented: $showingCaption) {
            LongFormCaptionView(post: post)
                .frame(minWidth: 560, idealWidth: 680, minHeight: 560, idealHeight: 760)
        }
    }

    private func configurePlayer() {
        player?.pause()
        guard post.primaryMedia?.type == "video", let url = post.primaryMedia?.remoteURL else { player = nil; return }
        let next = AVPlayer(url: url)
        player = next
        next.play()
    }
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

private struct PostInspector: View {
    @Environment(AppModel.self) private var model
    let post: TardyPost
    @State private var showingCaption = false

    var body: some View {
        @Bindable var model = model
        VStack(spacing: 0) {
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
                        .lineLimit(8)
                    Button { showingCaption = true } label: {
                        Label("Read full caption", systemImage: "arrow.up.left.and.arrow.down.right")
                            .font(.callout.bold())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Brand.yellow)
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
        .sheet(isPresented: $showingCaption) {
            LongFormCaptionView(post: post)
                .frame(minWidth: 560, idealWidth: 680, minHeight: 560, idealHeight: 760)
        }
    }
}

private struct LongFormCaptionView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let post: TardyPost

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                if let author = model.accounts[post.authorId] {
                    Avatar(account: author, size: 42)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(author.displayName).font(.headline)
                        Text("@\(author.handle)").font(.caption).foregroundStyle(Brand.muted)
                    }
                } else {
                    Text("Tardy").font(.headline)
                }
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
            .padding(20)
            Divider()
            ScrollView {
                Text(.init(post.caption))
                    .font(.system(size: 17))
                    .lineSpacing(7)
                    .textSelection(.enabled)
                    .frame(maxWidth: 680, alignment: .leading)
                    .padding(.horizontal, 28)
                    .padding(.vertical, 26)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
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
                        if profile.ownedByViewer == true { Label("Claimed", systemImage: "person.badge.key.fill").foregroundStyle(Brand.yellow) }
                    }
                    .padding(20)
                    .background(Brand.panel, in: RoundedRectangle(cornerRadius: 16))
                    .overlay { RoundedRectangle(cornerRadius: 16).stroke(Brand.separator) }
                    Divider()
                    Text("TARDIES").font(.caption.bold()).foregroundStyle(Brand.yellow)
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
    }

    private func stat(_ number: Int, _ label: String) -> some View {
        HStack(spacing: 4) { Text("\(number)").bold(); Text(label).foregroundStyle(Brand.muted) }.font(.caption)
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
