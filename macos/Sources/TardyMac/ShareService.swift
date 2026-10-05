import AppKit
import Foundation

extension Notification.Name {
    static let tardySharedContent = Notification.Name("dev.fpl.tardy.shared-content")
}

@MainActor
final class TardyAppDelegate: NSObject, NSApplicationDelegate {
    private let shareService = TardyShareService()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.servicesProvider = shareService
        NSUpdateDynamicServices()
    }
}

@MainActor
final class TardyShareService: NSObject {
    @objc func shareToTardy(
        _ pasteboard: NSPasteboard,
        userData: String,
        error: AutoreleasingUnsafeMutablePointer<NSString?>
    ) {
        let value = pasteboard.string(forType: .URL)
            ?? pasteboard.string(forType: .fileURL)
            ?? pasteboard.string(forType: .string)
        guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            error.pointee = "Tardy could not read the shared URL, file, or text." as NSString
            return
        }
        NSApp.activate(ignoringOtherApps: true)
        NotificationCenter.default.post(name: .tardySharedContent, object: value)
    }
}
