import SwiftUI

/// A presentation-only projection: never rewrites or summarizes the stored reply.
enum ChatProjection {
    static func preview(_ source: String, limit: Int = 480) -> String {
        String(source.prefix(max(0, limit)))
    }
}

struct ChatReplyView: View {
    let source: String
    let expanded: Bool
    @State private var readsFullReply = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if expanded || readsFullReply || source.count <= 480 {
                RichMarkdownView(source: source)
            } else {
                // Plain preview avoids rendering a cut-off Markdown fence/table.
                Text(ChatProjection.preview(source) + "…").textSelection(.enabled)
            }
            if !expanded && source.count > 480 {
                Button(readsFullReply ? "Show less" : "Read full reply") {
                    readsFullReply.toggle()
                }.buttonStyle(.plain).font(.caption.bold())
            }
        }
    }
}

struct ConversationAttachmentsView: View {
    let messages: [Message]
    let showInChat: (UUID) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Media & files").font(.title2.bold())
                Spacer()
                Button("Done") { dismiss() }
            }
            Text("Attachments in loaded messages").font(.caption).foregroundStyle(.secondary)
            if messages.allSatisfy({ $0.media.isEmpty }) {
                ContentUnavailableView("No attachments yet", systemImage: "photo.on.rectangle")
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 16) {
                        ForEach(messages.reversed()) { message in
                            ForEach(message.media) { media in
                                VStack(alignment: .leading, spacing: 6) {
                                    if media.type == "image", let url = media.remoteURL {
                                        Link(destination: url) {
                                            AsyncImage(url: url) { image in
                                                image.resizable().scaledToFit()
                                            } placeholder: { ProgressView() }
                                            .frame(maxWidth: 440, maxHeight: 260)
                                        }
                                    } else if let url = media.remoteURL {
                                        Link(media.fileName ?? media.type.capitalized, destination: url)
                                    }
                                    Text(media.altText ?? media.fileName ?? media.type.capitalized)
                                        .font(.caption).foregroundStyle(.secondary)
                                    Button("Show in chat") { showInChat(message.id) }
                                }
                            }
                        }
                    }
                }
            }
        }.padding(20).frame(width: 520, height: 580)
    }
}
