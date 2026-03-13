// AsteroidNode.swift
// Destructible asteroid that fractures into smaller shards when destroyed.
//
// Size determines health:
//   size > 60  → 3 HP, splits into 3 children
//   size > 30  → 2 HP, splits into 2 children
//   size ≤ 30  → 1 HP, no children (just particles)

import SpriteKit

final class AsteroidNode: SKNode {

    // ── Properties ────────────────────────────────────────────────────────────
    var radius: CGFloat
    var currentHealth: Int
    private let spriteNode: SKShapeNode

    // ── Init ──────────────────────────────────────────────────────────────────

    init(radius: CGFloat) {
        self.radius = radius
        self.currentHealth = AsteroidNode.healthFor(radius: radius)

        // Build a randomised polygon shape using the same algorithm as the TS engine
        let points = AsteroidNode.buildPolygon(radius: radius)
        let path = CGMutablePath()
        path.move(to: points[0])
        for p in points.dropFirst() { path.addLine(to: p) }
        path.closeSubpath()

        spriteNode = SKShapeNode(path: path)
        spriteNode.fillColor   = UIColor(white: 0.45, alpha: 1)
        spriteNode.strokeColor = UIColor(white: 0.65, alpha: 1)
        spriteNode.lineWidth   = 1.5
        spriteNode.zPosition   = 5

        super.init()

        name = "asteroid"
        zPosition = 5

        addChild(spriteNode)
        setupPhysics(path: path)
    }

    required init?(coder: NSCoder) { fatalError() }

    // ── Helpers ───────────────────────────────────────────────────────────────

    static func healthFor(radius: CGFloat) -> Int {
        if radius > 45 { return 3 }
        if radius > 22 { return 2 }
        return 1
    }

    private static func buildPolygon(radius: CGFloat) -> [CGPoint] {
        let numPoints = Int.random(in: 7...10)
        return (0..<numPoints).map { i -> CGPoint in
            let angle = CGFloat(i) / CGFloat(numPoints) * .pi * 2
            let r = radius * CGFloat.random(in: 0.6...1.0)
            return CGPoint(x: cos(angle) * r, y: sin(angle) * r)
        }
    }

    // ── Physics ───────────────────────────────────────────────────────────────

    private func setupPhysics(path: CGPath) {
        // Use circle body for stable simulation; visual polygon is cosmetic
        let body = SKPhysicsBody(circleOfRadius: radius * 0.85)
        body.categoryBitMask    = PhysicsCategory.asteroid
        body.contactTestBitMask = PhysicsCategory.playerBullet | PhysicsCategory.player
        body.collisionBitMask   = PhysicsCategory.none
        body.linearDamping      = 0
        body.angularDamping     = 0
        body.affectedByGravity  = false
        body.mass               = radius    // larger = heavier
        physicsBody = body

        // Give a random spin
        body.angularVelocity = CGFloat.random(in: -0.8...0.8)
    }

    // ── Spawn ─────────────────────────────────────────────────────────────────

    /// Convenience factory used by GameScene and by shard spawning.
    static func spawn(at position: CGPoint,
                      radius: CGFloat? = nil) -> AsteroidNode {
        let r = radius ?? CGFloat.random(
            in: AsteroidConstants.minSize...AsteroidConstants.maxSize
        )
        let node = AsteroidNode(radius: r)
        node.position = position

        // Random drift velocity
        let angle  = CGFloat.random(in: 0...(2 * .pi))
        let speed  = CGFloat.random(in: AsteroidConstants.minSpeed...AsteroidConstants.maxSpeed)
        node.physicsBody?.velocity = CGVector(dx: cos(angle) * speed,
                                              dy: sin(angle) * speed)
        return node
    }

    // ── Damage ────────────────────────────────────────────────────────────────

    /// Returns true if the asteroid is destroyed.
    @discardableResult
    func takeDamage(_ amount: Int = 1) -> Bool {
        currentHealth -= amount
        if currentHealth <= 0 { return true }

        // Flash white on hit
        let flash = SKAction.sequence([
            SKAction.colorize(with: .white, colorBlendFactor: 0.8, duration: 0),
            SKAction.wait(forDuration: 0.08),
            SKAction.colorize(withColorBlendFactor: 0, duration: 0.1)
        ])
        spriteNode.run(flash)
        return false
    }

    // ── Fracture ──────────────────────────────────────────────────────────────

    /// Returns child shard nodes to add to the scene. The caller is responsible
    /// for removing self from the parent.
    func fracture() -> [AsteroidNode] {
        let childRadius = radius / sqrt(2.2)
        guard childRadius >= AsteroidConstants.minSize else { return [] }

        let count = Int.random(in: 2...3)
        return (0..<count).map { i -> AsteroidNode in
            let angle = CGFloat(i) / CGFloat(count) * .pi * 2
            let offset = CGPoint(x: cos(angle) * radius * 0.5,
                                 y: sin(angle) * radius * 0.5)
            let shard = AsteroidNode.spawn(
                at: CGPoint(x: position.x + offset.x, y: position.y + offset.y),
                radius: childRadius
            )
            // Inherit parent velocity + explosion kick
            if let parentVel = physicsBody?.velocity {
                let kickSpeed = CGFloat.random(in: 40...100)
                shard.physicsBody?.velocity = CGVector(
                    dx: parentVel.dx + cos(angle) * kickSpeed,
                    dy: parentVel.dy + sin(angle) * kickSpeed
                )
            }
            return shard
        }
    }
}
