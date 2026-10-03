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
                .alert("Tardy hit a snag", isPresented: Binding(
                    get: { model.errorMessage != nil },
                    set: { if !$0 { model.errorMessage = nil } }
                )) {
                    Button("OK", role: .cancel) { model.errorMessage = nil }
                } message: {
                    Text(model.errorMessage ?? "Unknown error")
                }
        }
        .defaultSize(width: 1260, height: 820)
        .windowStyle(.titleBar)
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
