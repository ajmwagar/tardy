import Foundation

struct ReelScrollNavigator {
    static let defaultThreshold = 44.0
    static let defaultCooldown: TimeInterval = 0.45

    var threshold = defaultThreshold
    var cooldown = defaultCooldown

    private(set) var accumulatedDelta = 0.0
    private(set) var lastNavigationTime: TimeInterval?

    mutating func consume(deltaY: Double, timestamp: TimeInterval) -> Int? {
        guard deltaY != 0 else { return nil }

        if let lastNavigationTime, timestamp - lastNavigationTime < cooldown {
            return nil
        }

        if accumulatedDelta != 0, accumulatedDelta.sign != deltaY.sign {
            accumulatedDelta = 0
        }
        accumulatedDelta += deltaY

        guard abs(accumulatedDelta) >= threshold else { return nil }
        let direction = accumulatedDelta < 0 ? 1 : -1
        accumulatedDelta = 0
        lastNavigationTime = timestamp
        return direction
    }

    mutating func reset() {
        accumulatedDelta = 0
    }
}
