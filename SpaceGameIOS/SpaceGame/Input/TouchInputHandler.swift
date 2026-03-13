// TouchInputHandler.swift
// Translates raw UITouch events into game actions.
//
// Scheme (same feel as the TypeScript engine, optimised for one thumb):
//
//   DRAG  — hold and drag anywhere to thrust in that direction.
//            The further you drag from the touch origin, the more thrust.
//            Releasing decelerates naturally (physics linearDamping).
//
//   TAP   — a touch that lifts within TAP_MAX_DURATION seconds AND
//            has moved less than TAP_MAX_DIST points fires the weapon
//            toward the tap position.
//
// This single-touch model works well for Phase 1 movement testing.
// Phase 2 will optionally add a dedicated right-side fire button.

import SpriteKit

struct FireEvent {
    /// World-space position to fire toward (converted by GameScene before passing to WeaponSystem).
    let screenPosition: CGPoint
}

final class TouchInputHandler {

    // ── Tuning ────────────────────────────────────────────────────────────────
    /// Maximum touch duration for a tap to register as a shot (seconds).
    private let tapMaxDuration: TimeInterval = 0.22
    /// Maximum drag distance for a touch to still be a tap (screen points).
    private let tapMaxDist: CGFloat = 12
    /// Drag distance at which thrust reaches 100%.
    private let fullThrustDist: CGFloat = 80

    // ── State ─────────────────────────────────────────────────────────────────
    private struct TrackedTouch {
        let touch:     UITouch
        let startPos:  CGPoint
        let startTime: TimeInterval
        var currentPos: CGPoint
    }

    private var activeTouches: [UITouch: TrackedTouch] = [:]
    private(set) var pendingFireEvents: [FireEvent] = []

    // ── Read ──────────────────────────────────────────────────────────────────

    /// Normalised thrust vector [-1, 1] in x and y.
    var movementVector: CGVector {
        guard !activeTouches.isEmpty else { return .zero }
        // Use the most recent touch for movement
        guard let tracked = activeTouches.values.max(by: { a, b in
            a.startTime < b.startTime
        }) else { return .zero }

        let dx = tracked.currentPos.x - tracked.startPos.x
        let dy = tracked.currentPos.y - tracked.startPos.y
        let dist = sqrt(dx * dx + dy * dy)
        guard dist > 4 else { return .zero }   // dead zone

        let magnitude = min(dist / fullThrustDist, 1.0)
        return CGVector(dx: (dx / dist) * magnitude,
                        dy: (dy / dist) * magnitude)
    }

    /// Consumes and returns any fire events accumulated since last call.
    func consumeFireEvents() -> [FireEvent] {
        defer { pendingFireEvents.removeAll() }
        return pendingFireEvents
    }

    // ── UITouch event forwarding ───────────────────────────────────────────────

    func touchesBegan(_ touches: Set<UITouch>, currentTime: TimeInterval) {
        for touch in touches {
            let pos = touch.location(in: nil)
            activeTouches[touch] = TrackedTouch(
                touch: touch, startPos: pos,
                startTime: currentTime, currentPos: pos
            )
        }
    }

    func touchesMoved(_ touches: Set<UITouch>) {
        for touch in touches {
            guard activeTouches[touch] != nil else { continue }
            activeTouches[touch]!.currentPos = touch.location(in: nil)
        }
    }

    func touchesEnded(_ touches: Set<UITouch>, currentTime: TimeInterval) {
        for touch in touches {
            guard let tracked = activeTouches.removeValue(forKey: touch) else { continue }
            evaluateTap(tracked: tracked, currentTime: currentTime)
        }
    }

    func touchesCancelled(_ touches: Set<UITouch>) {
        for touch in touches { activeTouches.removeValue(forKey: touch) }
    }

    // ── Tap detection ──────────────────────────────────────────────────────────

    private func evaluateTap(tracked: TrackedTouch, currentTime: TimeInterval) {
        let duration = currentTime - tracked.startTime
        let dx = tracked.currentPos.x - tracked.startPos.x
        let dy = tracked.currentPos.y - tracked.startPos.y
        let dist = sqrt(dx * dx + dy * dy)

        if duration <= tapMaxDuration && dist <= tapMaxDist {
            pendingFireEvents.append(FireEvent(screenPosition: tracked.startPos))
        }
    }
}
