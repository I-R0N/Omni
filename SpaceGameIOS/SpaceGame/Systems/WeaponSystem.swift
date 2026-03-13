// WeaponSystem.swift
// Handles firing logic for all 5 player weapon types.
//
// Port of the weapon system from GameEngine.ts / SpaceGameEngine.ts.
//
// Weapon types:
//   Blaster  — single fast shot
//   Shotgun  — 6-pellet wide spread, short range
//   Cannon   — high-damage plasma bolt with strong recoil
//   Homing   — heat-seeker that steers toward nearest enemy / asteroid
//   Burst    — 3-shot burst with a short delay between each shot

import SpriteKit

final class WeaponSystem {

    // ── State ─────────────────────────────────────────────────────────────────
    private unowned let scene: SKScene
    private unowned let player: PlayerNode

    /// Queued burst shots remaining (Burst weapon only)
    private var burstQueue: [(angle: CGFloat, delay: TimeInterval)] = []
    private var burstAccumulator: TimeInterval = 0

    // ── Init ──────────────────────────────────────────────────────────────────

    init(scene: SKScene, player: PlayerNode) {
        self.scene  = scene
        self.player = player
    }

    // ── Per-frame update ──────────────────────────────────────────────────────

    func update(dt: TimeInterval) {
        // Drain the burst queue
        guard !burstQueue.isEmpty else { return }
        burstAccumulator += dt
        while !burstQueue.isEmpty && burstAccumulator >= burstQueue[0].delay {
            burstAccumulator -= burstQueue[0].delay
            let angle = burstQueue.removeFirst().angle
            spawnBullet(angle: angle, config: WeaponConstants.all[.burst]!)
        }
    }

    // ── Fire ──────────────────────────────────────────────────────────────────

    /// Called when the player fires toward a world-space point.
    /// Returns false if on cooldown.
    @discardableResult
    func fire(toward worldTarget: CGPoint,
              availableTargets: [SKNode]) -> Bool {
        guard player.weaponCooldown <= 0 else { return false }
        guard let config = WeaponConstants.all[player.currentWeapon] else { return false }

        player.weaponCooldown = player.effectiveCooldown

        let baseAngle = atan2(worldTarget.y - player.position.y,
                              worldTarget.x - player.position.x)

        switch player.currentWeapon {
        case .blaster:  fireBlaster(angle: baseAngle, config: config)
        case .shotgun:  fireShotgun(angle: baseAngle, config: config)
        case .cannon:   fireCannon(angle: baseAngle, config: config)
        case .homing:   fireHoming(angle: baseAngle, config: config, targets: availableTargets)
        case .burst:    fireBurst(angle: baseAngle, config: config)
        }
        return true
    }

    // ── Weapon implementations ────────────────────────────────────────────────

    private func fireBlaster(angle: CGFloat, config: WeaponConfig) {
        let jitter = degreesToRad(config.spreadDegrees)
        let a = angle + CGFloat.random(in: -jitter/2...jitter/2)
        spawnBullet(angle: a, config: config)
        applyRecoil(angle: a, config: config)
    }

    private func fireShotgun(angle: CGFloat, config: WeaponConfig) {
        let halfSpread = degreesToRad(config.spreadDegrees) / 2
        let count = player.effectiveProjectileCount
        for i in 0..<count {
            let t = count > 1 ? CGFloat(i) / CGFloat(count - 1) : 0.5
            let a = angle - halfSpread + t * (halfSpread * 2)
            spawnBullet(angle: a, config: config)
        }
        applyRecoil(angle: angle, config: config)
    }

    private func fireCannon(angle: CGFloat, config: WeaponConfig) {
        spawnBullet(angle: angle, config: config)
        applyRecoil(angle: angle, config: config)
    }

    private func fireHoming(angle: CGFloat, config: WeaponConfig, targets: [SKNode]) {
        let jitter = degreesToRad(config.spreadDegrees)
        let a = angle + CGFloat.random(in: -jitter/2...jitter/2)
        let bullet = spawnBullet(angle: a, config: config)

        // Lock onto nearest target
        let nearest = targets.min(by: { a, b in
            distSq(from: player.position, to: a.position) <
            distSq(from: player.position, to: b.position)
        })
        bullet.homingTarget = nearest
        applyRecoil(angle: angle, config: config)
    }

    private func fireBurst(angle: CGFloat, config: WeaponConfig) {
        // Enqueue 3 shots with increasing delay between each
        burstQueue.removeAll()
        burstAccumulator = 0
        let delay = config.burstDelay
        for i in 0..<config.burstCount {
            let jitter = degreesToRad(config.spreadDegrees)
            let a = angle + CGFloat.random(in: -jitter/2...jitter/2)
            burstQueue.append((angle: a, delay: i == 0 ? 0 : delay))
        }
        applyRecoil(angle: angle, config: config)
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    @discardableResult
    private func spawnBullet(angle: CGFloat, config: WeaponConfig) -> ProjectileNode {
        let speed = config.speed
        let velocity = CGVector(dx: cos(angle) * speed, dy: sin(angle) * speed)

        let bullet = ProjectileNode(config: config, velocity: velocity)

        // Spawn at muzzle — slightly in front of the player sprite
        let muzzleOffset: CGFloat = PlayerConstants.radius + config.projectileSize + 4
        bullet.position = CGPoint(
            x: player.position.x + cos(angle) * muzzleOffset,
            y: player.position.y + sin(angle) * muzzleOffset
        )

        // Scale damage for power-up multiplier
        // (ProjectileNode.damage is let, so we store multiplier externally in GameScene
        // and apply it in the contact handler — no change here)

        scene.addChild(bullet)
        return bullet
    }

    private func applyRecoil(angle: CGFloat, config: WeaponConfig) {
        guard config.recoilMultiplier > 0 else { return }
        let impulse = config.recoilMultiplier * 18
        player.physicsBody?.applyImpulse(
            CGVector(dx: -cos(angle) * impulse, dy: -sin(angle) * impulse)
        )
    }

    private func degreesToRad(_ deg: CGFloat) -> CGFloat { deg * .pi / 180 }

    private func distSq(from a: CGPoint, to b: CGPoint) -> CGFloat {
        let dx = b.x - a.x; let dy = b.y - a.y
        return dx * dx + dy * dy
    }
}
