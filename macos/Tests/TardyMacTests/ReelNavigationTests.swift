import Testing
@testable import TardyMac

@Test func reelScrollAccumulatesUntilThreshold() {
    var navigator = ReelScrollNavigator(threshold: 40, cooldown: 0.5)

    #expect(navigator.consume(deltaY: -15, timestamp: 1) == nil)
    #expect(navigator.consume(deltaY: -24, timestamp: 1.05) == nil)
    #expect(navigator.consume(deltaY: -2, timestamp: 1.1) == 1)
}

@Test func reelScrollMapsUpwardGestureToPrevious() {
    var navigator = ReelScrollNavigator(threshold: 30, cooldown: 0.5)

    #expect(navigator.consume(deltaY: 30, timestamp: 1) == -1)
}

@Test func reelScrollIgnoresMomentumDuringCooldown() {
    var navigator = ReelScrollNavigator(threshold: 30, cooldown: 0.5)

    #expect(navigator.consume(deltaY: -30, timestamp: 1) == 1)
    #expect(navigator.consume(deltaY: -100, timestamp: 1.2) == nil)
    #expect(navigator.consume(deltaY: -30, timestamp: 1.51) == 1)
}

@Test func reelScrollDirectionChangeDiscardsEarlierMovement() {
    var navigator = ReelScrollNavigator(threshold: 40, cooldown: 0)

    #expect(navigator.consume(deltaY: -30, timestamp: 1) == nil)
    #expect(navigator.consume(deltaY: 15, timestamp: 1.1) == nil)
    #expect(navigator.accumulatedDelta == 15)
    #expect(navigator.consume(deltaY: 25, timestamp: 1.2) == -1)
}
