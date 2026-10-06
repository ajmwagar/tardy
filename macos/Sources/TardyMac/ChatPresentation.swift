import SwiftUI
import AVKit

/// A presentation-only projection: never rewrites or summarizes the stored reply.
enum ChatProjection {
    static let compactLimit = 480
    static func needsExpansion(_ source: String) -> Bool { source.count > compactLimit }
}

struct ChatReplyView: View {
    let source: String
    let expanded: Bool
    @State private var readsFullReply = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if expanded || readsFullReply || !ChatProjection.needsExpansion(source) {
                RichMarkdownView(source: source)
            } else {
                Text((try? AttributedString(markdown: source, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(source))
                    .lineLimit(8).textSelection(.enabled)
            }
            if !expanded && ChatProjection.needsExpansion(source) {
                Button {
                    readsFullReply.toggle()
                } label: {
                    Label(readsFullReply ? "Show less" : "Read full reply", systemImage: readsFullReply ? "chevron.up" : "chevron.down")
                }.buttonStyle(.plain).font(.caption.weight(.semibold))
            }
        }
    }
}

struct ChatAttachment: Identifiable {
    let messageId: UUID
    let media: MessageMedia
    var id: String { "\(messageId):\(media.id)" }

    static func index(_ messages: [Message]) -> [ChatAttachment] {
        messages.reversed().flatMap { message in
            message.media.map { ChatAttachment(messageId: message.id, media: $0) }
        }
    }
}

struct ConversationAttachmentsView: View {
    let messages: [Message]
    let close: () -> Void
    let showInChat: (UUID) -> Void
    @State private var selectedId: String?
    @State private var filter = "All"
    private var items: [ChatAttachment] {
        ChatAttachment.index(messages).filter { filter == "All" || (filter == "Photos" ? $0.media.type == "image" : $0.media.type != "image") }
    }
    private var selected: ChatAttachment? { items.first { $0.id == selectedId } }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Media & files").font(.headline)
                Spacer()
                Button(action: close) { Image(systemName: "xmark") }.buttonStyle(.plain).help("Close media panel")
            }
            Picker("Attachment type", selection: $filter) {
                ForEach(["All", "Photos", "Files"], id: \.self) { Text($0).tag($0) }
            }.pickerStyle(.segmented).labelsHidden()
            if let selected {
                HStack {
                    Button { selectedId = nil } label: { Label("All attachments", systemImage: "chevron.left") }
                    Spacer()
                }.buttonStyle(.plain).font(.caption)
                AttachmentPreview(media: selected.media)
                Text(selected.media.fileName ?? selected.media.altText ?? selected.media.type.capitalized)
                    .font(.caption).textSelection(.enabled)
                HStack {
                    Button { step(-1) } label: { Image(systemName: "chevron.left") }
                        .disabled(items.first?.id == selected.id).help("Previous attachment")
                    Spacer()
                    Button("Show in chat") { showInChat(selected.messageId) }
                    Spacer()
                    Button { step(1) } label: { Image(systemName: "chevron.right") }
                        .disabled(items.last?.id == selected.id).help("Next attachment")
                }
                Spacer()
            } else if items.isEmpty {
                ContentUnavailableView("No attachments", systemImage: "photo.on.rectangle", description: Text("Photos and files shared here will appear together."))
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                        ForEach(items) { item in
                            Button { selectedId = item.id } label: {
                                VStack(alignment: .leading, spacing: 6) {
                                    AttachmentThumbnail(media: item.media)
                                        .frame(height: 110).frame(maxWidth: .infinity)
                                        .background(Brand.raised, in: RoundedRectangle(cornerRadius: 8))
                                        .clipped()
                                    Text(item.media.fileName ?? item.media.altText ?? item.media.type.capitalized)
                                        .font(.caption).lineLimit(2).frame(height: 32, alignment: .topLeading)
                                }
                            }
                            .buttonStyle(.plain)
                            .contextMenu { Button("Show in chat") { showInChat(item.messageId) } }
                        }
                    }
                }
            }
            Text("\(items.count) attachments · loaded messages").font(.caption2).foregroundStyle(Brand.muted)
        }.padding(16).background(Brand.panel)
            .onChange(of: filter) { _, _ in selectedId = nil }
            .onChange(of: messages.first?.conversationId) { _, _ in selectedId = nil }
    }

    private func step(_ offset: Int) {
        guard let index = items.firstIndex(where: { $0.id == selectedId }), items.indices.contains(index + offset) else { return }
        selectedId = items[index + offset].id
    }
}

struct AttachmentThumbnail: View {
    let media: MessageMedia
    var body: some View {
        if media.type == "image", let url = media.remoteURL {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image): image.resizable().scaledToFill()
                case .failure: Image(systemName: "photo.badge.exclamationmark").foregroundStyle(Brand.muted)
                default: ProgressView()
                }
            }
        } else {
            Image(systemName: media.type == "video" ? "play.rectangle" : media.type == "audio" ? "waveform" : "doc.text")
                .font(.system(size: 28)).foregroundStyle(Brand.yellow)
        }
    }
}

struct AttachmentPreview: View {
    let media: MessageMedia
    @State private var player: AVPlayer?
    var body: some View {
        VStack(spacing: 12) {
            if media.type == "image", let url = media.remoteURL {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image): image.resizable().scaledToFit()
                    case .failure:
                        VStack(spacing: 10) {
                            Image(systemName: "photo.badge.exclamationmark").font(.title).foregroundStyle(Brand.muted)
                            Text("Photo unavailable").font(.callout.weight(.semibold))
                            Text("The media URL may have expired or the file is missing.").font(.caption).foregroundStyle(Brand.muted).multilineTextAlignment(.center)
                        }.frame(height: 180)
                    default: ProgressView()
                    }
                }.frame(maxHeight: 380)
            } else if media.type == "video" || media.type == "audio" {
                VideoPlayer(player: player).frame(height: media.type == "audio" ? 80 : 240)
            } else {
                AttachmentThumbnail(media: media).frame(height: 120)
                Text("Open this document in your preferred viewer.").font(.caption).foregroundStyle(Brand.muted)
            }
            if let url = media.remoteURL {
                Link(destination: url) { Label("Open original", systemImage: "arrow.up.right.square") }.font(.caption)
            }
        }
        .task(id: media.id) {
            player?.pause()
            player = (media.type == "video" || media.type == "audio") ? media.remoteURL.map { AVPlayer(url: $0) } : nil
        }
        .onDisappear { player?.pause() }
    }
}
