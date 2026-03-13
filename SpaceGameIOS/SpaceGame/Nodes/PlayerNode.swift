// PlayerNode.swift
// The player's ship — an SKSpriteNode with a circular physics body.
//
// Responsibilities:
//   • Holds current health, active power-ups, current weapon
//   • Applies thrust impulse from the input handler each frame
//   • Enforces a maximum speed cap (space drift feel)
//   • Manages engine trail (chain of fading circle nodes)
//   • Flashes white when hit (hitFlash effect from the TS engine)
//   • Handles respawn state (spawn-grace invincibility period)

import SpriteKit

final class PlayerNode: SKSpriteNode {

    // ── State ─────────────────────────────────────────────────────────────────
    var currentHealth:  CGFloat = PlayerConstants.maxHealth
    var maxHealth:      CGFloat = PlayerConstants.maxHealth
    var isInvincible:   Bool    = false          // true during spawn grace
    var activePowerUps: [ActivePowerUp] = []     // Phase 2

    var currentWeapon:   WeaponType = .blaster
    var weaponCooldown:  TimeInterval = 0
    var burstRemaining:  Int           = 0
    var burstTimer:      TimeInterval  = 0

    // ── Visuals ───────────────────────────────────────────────────────────────
    private var trailNodes: [SKShapeNode] = []
    private let maxTrailLength = 18
    private var hitFlashTimer: TimeInterval = 0
    private let hitFlashDuration: TimeInterval = 0.12

    // ── Init ──────────────────────────────────────────────────────────────────

    init() {
        // Try to load ship sprite from Assets; fall back to a procedural shape
        let texture = SKTexture(imageNamed: "ship")
        let size = CGSize(width: PlayerConstants.spriteSize,
                          height: PlayerConstants.spriteSize)
        super.init(texture: texture, color: .clear, size: size)

        name = "player"
        zPosition = 10

        setupPhysics()
        setupTrailNodes()
    }

    required init?(coder aDecoder: NSCoder) { fatalError() }

    // ── Physics ───────────────────────────────────────────────────────────────

    private func setupPhysics() {
        let body = SKPhysicsBody(circleOfRadius: PlayerConstants.radius)
        body.categoryBitMask    = PhysicsCategory.player
        body.contactTestBitMask = PhysicsCategory.enemyBullet |
                                  PhysicsCategory.asteroid     |
                                  PhysicsCategory.powerUp
        body.collisionBitMask   = PhysicsCategory.none   // no physical push-back;
                                                          // we handle responses manually
        body.linearDamping      = PlayerConstants.linearDamping
        body.angularDamping     = PlayerConstants.angularDamping
        body.allowsRotation     = false
        body.affectedByGravity  = false
        body.mass               = PlayerConstants.mass
        physicsBody = body
    }

    // ── Trail ─────────────────────────────────────────────────────────────────

    private func setupTrailNodes() {
        for i in 0..<maxTrailLength {
            let t = CGFloat(i) / CGFloat(maxTrailLength)
            let r = PlayerConstants.radius * 0.3 * (1 - t)
            let node = SKShapeNode(circleOfRadius: max(1, r))
            node.fillColor = UIColor(red: 0.3, green: 0.8, blue: 1.0, alpha: (1 - t) * 0.5)
            node.strokeColor = .clear
            node.zPosition = 9
            node.isHidden = true
            // Trail nodes are added to the parent scene, not to self,
            // so they stay in world-space when the player moves.
            trailNodes.append(node)
        }
    }

    /// Call this once, after the player is added to a scene.
    func addTrailToScene(_ scene: SKScene) {
        trailNodes.forEach { scene.addChild($0) }
    }

    func removeTrailFromScene() {
        trailNodes.forEach { $0.removeFromParent() }
    }

    // ── Per-frame update ──────────────────────────────────────────────────────

    func update(dt: TimeInterval, thrustVector: CGVector) {
        applyThrust(thrustVector)
        capSpeed()
        updateRotation(thrustVector)
        updateTrail()
        updateHitFlash(dt: dt)

        // Tick weapon cooldown
        if weaponCooldown > 0 { weaponCooldown -= dt }

        // Tick burst
        if burstRemaining > 0 {
            burstTimer -= dt
        }
    }

    // ── Thrust ────────────────────────────────────────────────────────────────

    private func applyThrust(_ thrust: CGVector) {
        guard let body = physicsBody else { return }
        let magnitude = sqrt(thrust.dx * thrust.dx + thrust.dy * thrust.dy)
        guard magnitude > 0.01 else { return }

        let impulse = CGVector(
            dx: thrust.dx * PlayerConstants.thrustForce,
            dy: thrust.dy * PlayerConstants.thrustForce
        )
        body.applyImpulse(impulse)
    }

    private func capSpeed() {
        guard let body = physicsBody else { return }
        let speed = sqrt(body.velocity.dx * body.velocity.dx +
                         body.velocity.dy * body.velocity.dy)
        let maxSpd = effectiveMaxSpeed
        if speed > maxSpd {
            let scale = maxSpd / speed
            body.velocity = CGVector(dx: body.velocity.dx * scale,
                                     dy: body.velocity.dy * scale)
        }
    }

    /// maxSpeed adjusted by active power-ups (Phase 2 hook)
    private var effectiveMaxSpeed: CGFloat {
        var speed = PlayerConstants.maxSpeed
        if activePowerUps.contains(where: { $0.type == .speedBoost }) {
            speed *= 1.5
        }
        return speed
    }

    // ── Rotation — face the direction of travel ────────────────────────────────

    private func updateRotation(_ thrust: CGVector) {
        guard let body = physicsBody else { return }
        let vx = body.velocity.dx
        let vy = body.velocity.dy
        let speed = sqrt(vx * vx + vy * vy)
        if speed > 20 {
            // In SpriteKit, zRotation = 0 means pointing right (+x).
            // atan2 gives the angle of the velocity vector.
            zRotation = atan2(vy, vx)
        }
    }

    // ── Trail ─────────────────────────────────────────────────────────────────

    private var trailWriteIndex: Int = 0
    private var trailUpdateCounter: Int = 0

    private func updateTrail() {
        trailUpdateCounter += 1
        guard trailUpdateCounter % 2 == 0 else { return }  // update every 2 frames

        for i in 0..<trailNodes.count {
            let age = CGFloat((i + trailNodes.count - trailWriteIndex) % trailNodes.count)
            let t = age / CGFloat(trailNodes.count)
            let node = trailNodes[i]
            node.isHidden = (i == trailWriteIndex)
        }

        let node = trailNodes[trailWriteIndex]
        node.position = position
        node.isHidden = false
        trailWriteIndex = (trailWriteIndex + 1) % trailNodes.count
    }

    // ── Hit flash ─────────────────────────────────────────────────────────────

    func triggerHitFlash() {
        hitFlashTimer = hitFlashDuration
        color = .white
        colorBlendFactor = 1.0
    }

    private func updateHitFlash(dt: TimeInterval) {
        guard hitFlashTimer > 0 else { return }
        hitFlashTimer -= dt
        if hitFlashTimer <= 0 {
            hitFlashTimer = 0
            colorBlendFactor = 0.0
        }
    }

    // ── Damage / health ───────────────────────────────────────────────────────

    /// Returns true if the hit killed the player.
    @discardableResult
    func takeDamage(_ amount: CGFloat) -> Bool {
        guard !isInvincible else { return false }

        // Shield power-up absorbs one hit entirely (Phase 2)
        if let idx = activePowerUps.firstIndex(where: { $0.type == .shield }) {
            activePowerUps.remove(at: idx)
            triggerHitFlash()
            return false
        }

        let effective = damageMultiplier == 1 ? amount : amount  // player doesn't buff self-damage
        currentHealth = max(0, currentHealth - effective)
        triggerHitFlash()
        return currentHealth <= 0
    }

    private var damageMultiplier: CGFloat {
        activePowerUps.contains(where: { $0.type == .damageMultiplier }) ? 2.0 : 1.0
    }

    // ── Weapon helpers ────────────────────────────────────────────────────────

    var effectiveCooldown: TimeInterval {
        let base = WeaponConstants.all[currentWeapon]?.cooldown ?? 0.2
        return activePowerUps.contains(where: { $0.type == .rapidFire }) ? base * 0.5 : base
    }

    var effectiveDamageMultiplier: CGFloat {
        activePowerUps.contains(where: { $0.type == .damageMultiplier }) ? 2.0 : 1.0
    }

    var effectiveProjectileCount: Int {
        let base = WeaponConstants.all[currentWeapon]?.count ?? 1
        return activePowerUps.contains(where: { $0.type == .tripleShot }) ? base + 2 : base
    }

    // ── Respawn ───────────────────────────────────────────────────────────────

    func respawn(at position: CGPoint) {
        self.position = position
        physicsBody?.velocity = .zero
        currentHealth = maxHealth
        activePowerUps.removeAll()
        currentWeapon = .blaster
        weaponCooldown = 0
        burstRemaining = 0
        burstTimer = 0
        hitFlashTimer = 0
        colorBlendFactor = 0
        alpha = 1
        zRotation = 0
        isInvincible = true

        // Blink during grace period, then become fully visible
        let blinkAction = SKAction.sequence([
            SKAction.repeat(
                SKAction.sequence([
                    SKAction.fadeAlpha(to: 0.3, duration: 0.12),
                    SKAction.fadeAlpha(to: 1.0, duration: 0.12)
                ]),
                count: 6
            ),
            SKAction.run { [weak self] in self?.isInvincible = false }
        ])
        removeAction(forKey: "blink")
        run(blinkAction, withKey: "blink")
    }
}
