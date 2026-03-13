// ProjectileNode.swift
// A fired projectile — bullet, plasma bolt, or homing missile.
//
// Projectiles are moved manually (not through SpriteKit physics impulses) so
// homing missiles can steer every frame, and straight shots travel in a
// pixel-perfect line without physics engine jitter.
//
// Contact detection still uses the physics body (categoryBitMask), but
// collisionBitMask = .none so projectiles pass through geometry.

import SpriteKit

final class ProjectileNode: SKNode {

    // ── Properties ────────────────────────────────────────────────────────────
    let weaponType:  WeaponType
    let damage:      CGFloat
    let isHoming:    Bool
    var velocity:    CGVector
    var lifetime:    TimeInterval

    /// For homing missiles — the closest enemy when the missile was fired.
    weak var homingTarget: SKNode?

    private let visualNode: SKShapeNode

    // ── Init ──────────────────────────────────────────────────────────────────

    init(config: WeaponConfig, velocity: CGVector) {
        self.weaponType = config.type
        self.damage     = config.damage
        self.isHoming   = config.isHoming
        self.velocity   = velocity
        self.lifetime   = config.lifetime

        // Visual shape — elongated capsule pointing in the direction of travel
        let w = config.projectileSize * 2.5
        let h = config.projectileSize * 0.5
        let path = CGPath(ellipseIn: CGRect(x: -w / 2, y: -h / 2, width: w, height: h),
                          transform: nil)
        visualNode = SKShapeNode(path: path)
        visualNode.fillColor   = config.color
        visualNode.strokeColor = config.color.withAlphaComponent(0.5)
        visualNode.lineWidth   = 1
        visualNode.zPosition   = 8

        super.init()

        name = "projectile"
        zPosition = 8
        addChild(visualNode)

        // Rotate visual to face direction of travel
        let angle = atan2(velocity.dy, velocity.dx)
        zRotation = angle

        setupPhysics(radius: config.projectileSize)
    }

    required init?(coder: NSCoder) { fatalError() }

    // ── Physics ───────────────────────────────────────────────────────────────

    private func setupPhysics(radius: CGFloat) {
        let body = SKPhysicsBody(circleOfRadius: radius)
        body.isDynamic         = false   // moved manually; contact-only
        body.categoryBitMask   = PhysicsCategory.playerBullet
        body.contactTestBitMask = PhysicsCategory.enemy | PhysicsCategory.asteroid
        body.collisionBitMask  = PhysicsCategory.none
        body.affectedByGravity = false
        physicsBody = body
    }

    // ── Per-frame update ──────────────────────────────────────────────────────

    /// Returns true when the projectile should be removed from the scene.
    func update(dt: TimeInterval) -> Bool {
        lifetime -= dt
        guard lifetime > 0 else { return true }

        // Homing — steer toward target each frame
        if isHoming, let target = homingTarget, target.parent != nil {
            steerToward(target: target.position, dt: dt)
        }

        // Advance position
        position.x += velocity.dx * CGFloat(dt)
        position.y += velocity.dy * CGFloat(dt)

        // Keep visual rotated toward travel direction
        zRotation = atan2(velocity.dy, velocity.dx)

        // Fade near end of life
        let fadeStart = 0.3
        if lifetime < fadeStart {
            alpha = CGFloat(lifetime / fadeStart)
        }

        return false
    }

    // ── Homing steering ───────────────────────────────────────────────────────

    private let homingTurnRateRadPerSec: CGFloat = 3.5   // radians/second

    private func steerToward(target: CGPoint, dt: TimeInterval) {
        let dx = target.x - position.x
        let dy = target.y - position.y
        let desiredAngle = atan2(dy, dx)

        var diff = desiredAngle - atan2(velocity.dy, velocity.dx)
        // Normalise to [-π, π]
        while diff > .pi  { diff -= .pi * 2 }
        while diff < -.pi { diff += .pi * 2 }

        let maxTurn = homingTurnRateRadPerSec * CGFloat(dt)
        let turn = abs(diff) < maxTurn ? diff : copysign(maxTurn, diff)

        let currentAngle = atan2(velocity.dy, velocity.dx) + turn
        let speed = sqrt(velocity.dx * velocity.dx + velocity.dy * velocity.dy)
        velocity = CGVector(dx: cos(currentAngle) * speed,
                            dy: sin(currentAngle) * speed)
    }

    // ── Enemy projectile variant ──────────────────────────────────────────────

    /// Creates an enemy bullet (different category, red colour).
    static func makeEnemyBullet(from position: CGPoint,
                                toward target: CGPoint,
                                spreadDegrees: CGFloat = EnemyConstants.weaponSpreadDeg) -> ProjectileNode {
        let baseAngle = atan2(target.y - position.y, target.x - position.x)
        let spread = spreadDegrees * .pi / 180
        let angle = baseAngle + CGFloat.random(in: -spread/2...spread/2)

        let speed = EnemyConstants.weaponSpeed
        let vel = CGVector(dx: cos(angle) * speed, dy: sin(angle) * speed)

        let config = WeaponConfig(
            type: .blaster, name: "Enemy Shot",
            cooldown: EnemyConstants.weaponCooldown,
            speed: speed, damage: EnemyConstants.weaponDamage,
            lifetime: EnemyConstants.weaponLifetime,
            color: UIColor(red: 1, green: 0.4, blue: 0.1, alpha: 1),
            projectileSize: 4,
            count: 1, spreadDegrees: 0,
            recoilMultiplier: 0, isHoming: false, burstCount: 1, burstDelay: 0
        )
        let bullet = ProjectileNode(config: config, velocity: vel)
        bullet.position = position
        // Override category so player bullets don't hit it and it hits the player
        bullet.physicsBody?.categoryBitMask   = PhysicsCategory.enemyBullet
        bullet.physicsBody?.contactTestBitMask = PhysicsCategory.player
        return bullet
    }
}
