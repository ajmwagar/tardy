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
        .overlay(alignment: .top) {
            if let error = model.errorMessage {
                Text(error).font(.caption).padding(.horizontal, 12).padding(.vertical, 7)
                    .background(.red.opacity(0.9), in: Capsule()).padding(10)
                    .onTapGesture { model.errorMessage = nil }
            }
        }
    }
}

private struct AppRail: View {
    @Binding var selection: AppDestination

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "alarm.waves.left.and.right.fill")
                .font(.system(size: 28, weight: .black)).foregroundStyle(Brand.yellow).padding(.bottom, 12)
            RailButton(title: "Reels", icon: "play.rectangle.on.rectangle.fill", destination: .reels, selection: $selection)
            RailButton(title: "Messages", icon: "bubble.left.and.bubble.right.fill", destination: .messages, selection: $selection)
            RailButton(title: "Profile", icon: "person.crop.circle.fill", destination: .profile, selection: $selection)
            Spacer()
        }
        .padding(.vertical, 16).frame(width: 82).background(Brand.panel)
    }
}

private struct RailButton: View {
    let title: String
    let icon: String
    let destination: AppDestination
    @Binding var selection: AppDestination

    var body: some View {
        Button { selection = destination } label: {
            VStack(spacing: 5) {
                Image(systemName: icon).font(.title2)
                Text(title).font(.caption2)
            }
            .frame(width: 66, height: 54)
            .foregroundStyle(selection == destination ? .black : .white)
            .background(selection == destination ? Brand.yellow : .clear, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
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
                    ForEach(model.reels) { post in
                        ReelThumbnail(post: post, selected: post.id == model.selectedPostId)
                            .onTapGesture { Task { await model.selectPost(post.id) } }
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
            Task { await model.selectPost(id) }
        }
        .onMoveCommand { direction in
            switch direction {
            case .down: Task { await model.advancePost(by: 1) }
            case .up: Task { await model.advancePost(by: -1) }
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
                        Button { Task { await model.openProfile(author.id) } } label: {
                            HStack { Avatar(account: author, size: 30); Text("@\(author.handle)").font(.caption.bold()) }
                        }.buttonStyle(.plain)
                    }
                    Spacer()
                }.padding()
                Spacer()
                HStack {
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

    var body: some View {
        @Bindable var model = model
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let author = model.accounts[post.authorId] {
                        Button { Task { await model.openProfile(author.id) } } label: {
                            HStack { Avatar(account: author, size: 38); VStack(alignment: .leading) { Text(author.displayName).bold(); Text("@\(author.handle)").font(.caption).foregroundStyle(Brand.muted) }; Spacer(); Image(systemName: "chevron.right") }
                        }.buttonStyle(.plain)
                    }
                    Text("CAPTION").font(.caption.bold()).foregroundStyle(Brand.yellow)
                    Text(.init(post.caption)).textSelection(.enabled).font(.body).lineSpacing(3)
                    Divider()
                    HStack { Text("COMMENTS").font(.caption.bold()).foregroundStyle(Brand.yellow); Spacer(); Text("\(model.comments.count)").font(.caption).foregroundStyle(Brand.muted) }
                    if model.comments.isEmpty { Text("No comments yet.").font(.caption).foregroundStyle(Brand.muted) }
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
        }.background(Brand.panel)
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
                    Divider()
                    Text("TARDIES").font(.caption.bold()).foregroundStyle(Brand.yellow)
                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(model.profilePosts) { post in
                            ProfilePostCard(post: post).onTapGesture { Task { await model.openPost(post) } }
                        }
                    }
                }.padding(26)
            } else {
                ContentUnavailableView("Profile unavailable", systemImage: "person.crop.circle.badge.exclamationmark")
            }
        }.background(Brand.background)
        .task {
            if model.selectedProfile == nil, let id = model.account?.id { await model.openProfile(id) }
        }
    }

    private func stat(_ number: Int, _ label: String) -> some View {
        HStack(spacing: 4) { Text("\(number)").bold(); Text(label).foregroundStyle(Brand.muted) }.font(.caption)
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
