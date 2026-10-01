import AVFoundation
import ExpoModulesCore
import UIKit

/// Edge-to-edge video for Reels.
///
/// expo-video renders through AVPlayerViewController, which lays video out inside the
/// safe area and leaves black bands under the status bar and tab bar. This view draws with
/// plain AVPlayerLayers, which ignore the safe area, so the video can reach every edge.
///
/// Two layers share one AVPlayer (one decode, one audio track):
/// - `backdrop`: aspect-fill, enlarged, under a native blur. It shows the live frame.
/// - `foreground`: the sharp video.
///
/// Adaptive fit: when the video's aspect ratio is within `fillTolerance` of the view's, the
/// foreground fills the screen and the backdrop is hidden (nothing to blur). Otherwise the
/// whole video is shown sharp over its own live blur, with feathered edges, instead of being
/// cropped or letterboxed in black.
final class TardyVideoView: ExpoView {
  /// Fraction of aspect-ratio mismatch still treated as "close enough to fill".
  var fillTolerance: CGFloat = 0.25 {
    didSet { setNeedsLayout() }
  }

  var player: AVPlayer? {
    didSet {
      guard player !== oldValue else { return }
      backdrop.player = player
      foreground.player = player
      observePresentationSize()
    }
  }

  /// How far the backdrop overshoots the view, so the blur has no visible edges.
  private static let backdropOvershoot: CGFloat = 0.12
  /// Height of the fade between the sharp video and the blurred backdrop.
  private static let feather: CGFloat = 36

  private let backdrop = AVPlayerLayer()
  private let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
  private let foreground = AVPlayerLayer()
  private let featherMask = CAGradientLayer()

  private var itemObservation: NSKeyValueObservation?
  private var sizeObservation: NSKeyValueObservation?
  private var presentationSize: CGSize = .zero

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .black
    insetsLayoutMarginsFromSafeArea = false

    backdrop.videoGravity = .resizeAspectFill
    foreground.videoGravity = .resizeAspectFill
    featherMask.colors = [UIColor.clear.cgColor, UIColor.black.cgColor, UIColor.black.cgColor, UIColor.clear.cgColor]

    layer.addSublayer(backdrop)
    blur.isUserInteractionEnabled = false
    addSubview(blur)
    // Added after the blur's layer, so it composites above it.
    layer.addSublayer(foreground)
  }

  deinit {
    itemObservation?.invalidate()
    sizeObservation?.invalidate()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    defer { CATransaction.commit() }

    let overshoot = Self.backdropOvershoot
    backdrop.frame = bounds.insetBy(dx: -bounds.width * overshoot, dy: -bounds.height * overshoot)
    blur.frame = bounds
    foreground.frame = bounds

    guard bounds.width > 0, bounds.height > 0, presentationSize.width > 0, presentationSize.height > 0 else {
      // Unknown size yet: fill, which is right for the common (portrait) case.
      applyFill(true)
      return
    }

    let videoAspect = presentationSize.width / presentationSize.height
    let viewAspect = bounds.width / bounds.height
    applyFill(abs(videoAspect - viewAspect) / viewAspect <= fillTolerance)
  }

  private func applyFill(_ fill: Bool) {
    foreground.videoGravity = fill ? .resizeAspectFill : .resizeAspect
    backdrop.isHidden = fill
    blur.isHidden = fill
    foreground.mask = fill ? nil : featherMaskForVideoRect()
  }

  /// Fades the top and bottom (or left and right) edges of the fitted video into the blur.
  private func featherMaskForVideoRect() -> CALayer {
    let videoRect = AVMakeRect(aspectRatio: presentationSize, insideRect: bounds)
    featherMask.frame = bounds
    let letterboxedVertically = videoRect.height < bounds.height
    if letterboxedVertically {
      featherMask.startPoint = CGPoint(x: 0.5, y: 0)
      featherMask.endPoint = CGPoint(x: 0.5, y: 1)
      let top = videoRect.minY / bounds.height
      let bottom = videoRect.maxY / bounds.height
      let f = Self.feather / bounds.height
      featherMask.locations = [top, top + f, bottom - f, bottom].map { NSNumber(value: Double($0)) }
    } else {
      featherMask.startPoint = CGPoint(x: 0, y: 0.5)
      featherMask.endPoint = CGPoint(x: 1, y: 0.5)
      let left = videoRect.minX / bounds.width
      let right = videoRect.maxX / bounds.width
      let f = Self.feather / bounds.width
      featherMask.locations = [left, left + f, right - f, right].map { NSNumber(value: Double($0)) }
    }
    return featherMask
  }

  /// Re-lays out whenever the current item or its natural size changes (HLS variants and
  /// item swaps can change it mid-playback).
  private func observePresentationSize() {
    itemObservation?.invalidate()
    sizeObservation?.invalidate()
    presentationSize = .zero
    itemObservation = player?.observe(\.currentItem, options: [.initial, .new]) { [weak self] player, _ in
      DispatchQueue.main.async {
        self?.sizeObservation?.invalidate()
        self?.sizeObservation = player.currentItem?.observe(\.presentationSize, options: [.initial, .new]) { item, _ in
          DispatchQueue.main.async {
            self?.presentationSize = item.presentationSize
            self?.setNeedsLayout()
          }
        }
      }
    }
  }
}
