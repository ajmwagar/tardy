import SwiftUI

@main
struct TardyMacApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(model)
                .preferredColorScheme(.dark)
                .task { await model.start() }
        }
        .defaultSize(width: 1260, height: 820)
        .windowStyle(.titleBar)
        .windowToolbarStyle(.unifiedCompact(showsTitle: false))
        .commands { TardyCommands() }
    }
}

struct TardyCommands: Commands {
    @FocusedValue(\.sendTardyMessage) private var send

    var body: some Commands {
        CommandMenu("Conversation") {
            Button("Send Message") { send?() }
                .keyboardShortcut(.return, modifiers: .command)
        }
    }
}

private struct SendMessageKey: FocusedValueKey { typealias Value = () -> Void }
extension FocusedValues {
    var sendTardyMessage: (() -> Void)? {
        get { self[SendMessageKey.self] }
        set { self[SendMessageKey.self] = newValue }
    }
}
