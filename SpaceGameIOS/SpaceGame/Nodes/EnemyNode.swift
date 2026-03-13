// EnemyNode.swift
// Enemy ship — Phase 3 will fully activate this.
// Phase 1: class is complete and testable; GameScene.enemySpawnEnabled = false.
//
// AI states (mirrors the TS AISystem state machine):
//   idle     — drifting; transitions to chase when player enters visionRange
//   chase    — flies toward player
//   skirmish — maintains preferredDistance, strafes perpendicular
//   orbit    — circles the player at orbitRadius
//   snipe    — backs away to preferredDistance, then fires precision shot

import SpriteKit

final class EnemyNode: SKNode {

    // ── Properties ────────────────────────────────────────────────────────────
    let subtype:         EnemySubtype
    var currentHealth:   CGFloat
    var weaponCooldown:  TimeInterval = 0

    enum AIState { case idle, chase, skirmish, orbit, snipe }
    var aiState: AIState = .idle
    private var aiTimer: TimeInterval = 0

    /// Delayed aim position — enemies aim at where the player WAS, not where
    /// they are now, creating a reaction delay that makes dodging possible.
    private var delayedPlayerPosition: CGPoint = .zero
    private var reactionDelay: TimeInterval = 0

    private let spriteNode: SKShapeNode

    // ── Init ──────────────────────────────────────────────────────────────────

    init(subtype: EnemySubtype) {
        self.subtype = subtype
        self.currentHealth = subtype.baseHealth
        self.reactionDelay = TimeInterval.random(
            in: EnemyConstants.reactionDelayMin...EnemyConstants.reactionDelayMax
        )

        // Build an angular ship silhouette
        let r = EnemyConstants.radius
        let path = CGMutablePath()
        path.move(to: CGPoint(x: r, y: 0))
        path.addLine(to: CGPoint(x: -r * 0.6, y:  r * 0.7))
        path.addLine(to: CGPoint(x: -r * 0.3, y:  0))
        path.addLine(to: CGPoint(x: -r * 0.6, y: -r * 0.7))
        path.closeSubpath()

        spriteNode = SKShapeNode(path: path)
        spriteNode.fillColor   = subtype.color.withAlphaComponent(0.85)
        spriteNode.strokeColor = subtype.color
        spriteNode.lineWidth   = 1.5
        spriteNode.zPosition   = 10

        super.init()

        name = "enemy_\(subtype)"
        zPosition = 10
        addChild(spriteNode)
        setupPhysics()
    }

    required init?(coder: NSCoder) { fatalError() }

    // ── Physics ───────────────────────────────────────────────────────────────

    private func setupPhysics() {
        let body = SKPhysicsBody(circleOfRadius: EnemyConstants.radius)
        body.categoryBitMask    = PhysicsCategory.enemy
        body.contactTestBitMask = PhysicsCategory.playerBullet | PhysicsCategory.player
        body.collisionBitMask   = PhysicsCategory.none
        body.linearDamping      = 0.6
        body.angularDamping     = 10
        body.allowsRotation     = false
        body.affectedByGravity  = false
        body.mass               = 1.0
        physicsBody = body
    }

    // ── Spawn factory ─────────────────────────────────────────────────────────

    static func spawn(subtype: EnemySubtype, at position: CGPoint) -> EnemyNode {
        let node = EnemyNode(subtype: subtype)
        node.position = position
        return node
    }

    // ── Per-frame AI update ───────────────────────────────────────────────────

    /// Called every frame by AISystem. Returns a bullet node if the enemy
    /// decides to fire this frame, otherwise nil.
    func update(dt: TimeInterval, playerPosition: CGPoint) -> ProjectileNode? {
        aiTimer -= dt
        weaponCooldown = max(0, weaponCooldown - dt)

        // Update delayed aim position (reaction-time simulation)
        reactionDelay -= dt
        if reactionDelay <= 0 {
            delayedPlayerPosition = playerPosition
            reactionDelay = TimeInterval.random(
                in: EnemyConstants.reactionDelayMin...EnemyConstants.reactionDelayMax
            )
        }

        let toPlayer = vector(to: playerPosition)
        let distSq   = toPlayer.dx * toPlayer.dx + toPlayer.dy * toPlayer.dy
        let visionSq = subtype.visionRange * subtype.visionRange

        // State transitions
        if distSq < visionSq {
            switch subtype {
            case .skirmisher:   aiState = .skirmish
            case .orbiter:      aiState = .orbit
            case .sniper:       aiState = .snipe
            default:            aiState = .chase
            }
        } else {
            aiState = .idle
        }

        // Apply behaviour
        switch aiState {
        case .idle:     applyIdleDrift()
        case .chase:    applyChase(toward: playerPosition, dt: dt)
        case .skirmish: applySkirmish(toward: playerPosition, dt: dt)
        case .orbit:    applyOrbit(around: playerPosition, dt: dt)
        case .snipe:    applySnipe(toward: playerPosition, dt: dt)
        }

        // Face direction of travel
        if let vel = physicsBody?.velocity {
            let speed = sqrt(vel.dx * vel.dx + vel.dy * vel.dy)
            if speed > 20 { zRotation = atan2(vel.dy, vel.dx) }
        }

        // Shoot if in range and cooldown expired
        if aiState != .idle && weaponCooldown <= 0 {
            return tryFire()
        }
        return nil
    }

    // ── AI behaviours ─────────────────────────────────────────────────────────

    private func applyIdleDrift() {
        guard let body = physicsBody else { return }
        // Slow to a stop over time
        body.velocity = CGVector(dx: body.velocity.dx * 0.99,
                                 dy: body.velocity.dy * 0.99)
    }

    private func applyChase(toward target: CGPoint, dt: TimeInterval) {
        guard let body = physicsBody else { return }
        let dir = normalised(vector(to: target))
        let force = CGFloat(subtype.baseSpeed * 6)
        body.applyImpulse(CGVector(dx: dir.dx * force * CGFloat(dt),
                                   dy: dir.dy * force * CGFloat(dt)))
        capSpeed(to: subtype.baseSpeed)
    }

    private func applySkirmish(toward target: CGPoint, dt: TimeInterval) {
        guard let body = physicsBody else { return }
        let toTarget = vector(to: target)
        let dist = sqrt(toTarget.dx * toTarget.dx + toTarget.dy * toTarget.dy)
        let pref = subtype.preferredDistance

        let radialDir = normalised(toTarget)
        let perpDir   = CGVector(dx: -radialDir.dy, dy: radialDir.dx)

        // Move toward preferred distance, strafe perpendicular
        let radialCoeff: CGFloat = dist < pref ? -1 : 1
        let strafeCoeff: CGFloat = aiTimer < 0 ? 1 : -1
        if aiTimer < 0 { aiTimer = TimeInterval.random(in: 1.5...3.0) }

        let force = subtype.baseSpeed * 5 * CGFloat(dt)
        body.applyImpulse(CGVector(dx: (radialDir.dx * radialCoeff + perpDir.dx * strafeCoeff) * force,
                                   dy: (radialDir.dy * radialCoeff + perpDir.dy * strafeCoeff) * force))
        capSpeed(to: subtype.baseSpeed)
    }

    private func applyOrbit(around target: CGPoint, dt: TimeInterval) {
        guard let body = physicsBody else { return }
        let toTarget = vector(to: target)
        let dist     = sqrt(toTarget.dx * toTarget.dx + toTarget.dy * toTarget.dy)
        let desired  = subtype.preferredDistance
        let radial   = normalised(toTarget)
        let perp     = CGVector(dx: -radial.dy, dy: radial.dx)

        let radialCoeff: CGFloat = dist < desired * 0.9 ? -1 : (dist > desired * 1.1 ? 1 : 0)
        let force = subtype.baseSpeed * 5 * CGFloat(dt)
        body.applyImpulse(CGVector(dx: (radial.dx * radialCoeff + perp.dx) * force,
                                   dy: (radial.dy * radialCoeff + perp.dy) * force))
        capSpeed(to: subtype.baseSpeed)
    }

    private func applySnipe(toward target: CGPoint, dt: TimeInterval) {
        guard let body = physicsBody else { return }
        let toTarget = vector(to: target)
        let dist     = sqrt(toTarget.dx * toTarget.dx + toTarget.dy * toTarget.dy)
        let pref     = subtype.preferredDistance
        // Back away if too close
        let dir = dist < pref ? normalised(negated(toTarget)) : normalised(toTarget)
        let force = subtype.baseSpeed * 3 * CGFloat(dt)
        body.applyImpulse(CGVector(dx: dir.dx * force, dy: dir.dy * force))
        capSpeed(to: subtype.baseSpeed * 0.6)
    }

    // ── Firing ────────────────────────────────────────────────────────────────

    private func tryFire() -> ProjectileNode? {
        weaponCooldown = EnemyConstants.weaponCooldown
        let bullet = ProjectileNode.makeEnemyBullet(
            from: position,
            toward: delayedPlayerPosition
        )
        return bullet
    }

    // ── Damage ────────────────────────────────────────────────────────────────

    @discardableResult
    func takeDamage(_ amount: CGFloat) -> Bool {
        currentHealth -= amount
        let flash = SKAction.sequence([
            SKAction.colorize(with: .white, colorBlendFactor: 0.9, duration: 0),
            SKAction.wait(forDuration: 0.08),
            SKAction.colorize(withColorBlendFactor: 0, duration: 0.1)
        ])
        spriteNode.run(flash)
        return currentHealth <= 0
    }

    // ── Vector helpers ────────────────────────────────────────────────────────

    private func vector(to point: CGPoint) -> CGVector {
        CGVector(dx: point.x - position.x, dy: point.y - position.y)
    }

    private func normalised(_ v: CGVector) -> CGVector {
        let len = sqrt(v.dx * v.dx + v.dy * v.dy)
        guard len > 0.001 else { return .zero }
        return CGVector(dx: v.dx / len, dy: v.dy / len)
    }

    private func negated(_ v: CGVector) -> CGVector {
        CGVector(dx: -v.dx, dy: -v.dy)
    }

    private func capSpeed(to max: CGFloat) {
        guard let body = physicsBody else { return }
        let speed = sqrt(body.velocity.dx * body.velocity.dx +
                         body.velocity.dy * body.velocity.dy)
        if speed > max {
            let scale = max / speed
            body.velocity = CGVector(dx: body.velocity.dx * scale,
                                     dy: body.velocity.dy * scale)
        }
    }
}
