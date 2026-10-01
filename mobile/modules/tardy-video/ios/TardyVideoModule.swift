import AVFoundation
import ExpoModulesCore

/// Exposes `TardyVideoView` to JS. It takes the same player object expo-video's
/// `useVideoPlayer` returns: expo-video's player is a `SharedRef<AVPlayer>`, so playback,
/// events, and looping stay owned by expo-video and this module only draws.
public final class TardyVideoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TardyVideo")

    View(TardyVideoView.self) {
      Prop("player") { (view: TardyVideoView, player: SharedRef<AVPlayer>?) in
        view.player = player?.ref
      }

      Prop("fillTolerance") { (view: TardyVideoView, tolerance: Double?) in
        view.fillTolerance = CGFloat(tolerance ?? 0.25)
      }
    }
  }
}
