// GameScene.swift
// Main SpriteKit scene — orchestrates the entire game.
//
// This is the port of SpaceGameEngine.ts.
//
// Responsibilities:
//   • owns all game objects (player, asteroids, enemies, projectiles)
//   • runs the per-frame update loop (update(_ currentTime:))
//   • routes SpriteKit physics contacts to damage / death handlers
//   • manages the asteroid lifecycle (spawn / despawn around player)
//   • handles game state transitions (playing → paused → game over → menu)
//
// Phase flags (search for "Phase X" to find activation points):
//   enemySpawnEnabled  = false  → set true in Phase 3
//   powerUpSpawnEnabled = false → set true in Phase 2
//   scoreEnabled       = false  → set true in Phase 4

import SpriteKit
import GameplayKit   // available for Phase 4 GameCenter / GKLeaderboard

final class GameScene: SKScene, SKPhysicsContactDelegate {

    // ── Phase flags ────────────────────────────────────────────────────────────
    private var enemySpawnEnabled:   Bool = false   // Phase 3
    private var powerUpSpawnEnabled: Bool = false   // Phase 2
    private var scoreEnabled:        Bool = false   // Phase 4

    // ── Game objects ───────────────────────────────────────────────────────────
    private var playerNode:   PlayerNode!
    private var cameraNode:   SKCameraNode!
    private var background:   SpaceBackground!
    private var hudNode:      HUDNode!

    private var asteroids:    [AsteroidNode]    = []
    private var enemies:      [EnemyNode]       = []
    private var projectiles:  [ProjectileNode]  = []
    // Phase 2: powerUps: [PowerUpNode] = []

    // ── Systems ────────────────────────────────────────────────────────────────
    private var weaponSystem: WeaponSystem!
    private var aiSystem:     AISystem!
    private var touchHandler: TouchInputHandler!

    // ── Game state ─────────────────────────────────────────────────────────────
    private var gameState: GameState = .menu
    private var score:  Int = 0  // Phase 4
    private var wave:   Int = 0  // Phase 4

    // ── Timing ────────────────────────────────────────────────────────────────
    private var lastUpdateTime: TimeInterval = 0

    // ── Overlays (displayed between scenes) ────────────────────────────────────
    private var menuOverlay:    SKNode?
    private var pauseOverlay:   SKNode?
    private var gameOverOverlay: SKNode?

    // ═══════════════════════════════════════════════════════════════════════════
    // MARK: - Scene lifecycle
    // ═══════════════════════════════════════════════════════════════════════════

    override func didMove(to view: SKView) {
        backgroundColor = .black
        physicsWorld.gravity     = .zero
        physicsWorld.contactDelegate = self

        setupCamera()
        setupBackground()
        setupPlayer()
        setupHUD()
        setupSystems()
        spawnInitialAsteroids()

        showMenu()
    }

    // ─── Setup ────────────────────────────────────────────────────────────────

    private func setupCamera() {
        cameraNode = SKCameraNode()
        cameraNode.position = .zero
        addChild(cameraNode)
        camera = cameraNode
    }

    private func setupBackground() {
        background = SpaceBackground(sceneSize: size)
        // Background is in screen space, not world space — add to cameraNode
        cameraNode.addChild(background)
    }

    private func setupPlayer() {
        playerNode = PlayerNode()
        playerNode.position = .zero
        addChild(playerNode)
        playerNode.addTrailToScene(self)
    }

    private func setupHUD() {
        hudNode = HUDNode(sceneSize: size)
        hudNode.onCycleWeapon = { [weak self] in self?.cycleWeapon() }
        hudNode.onPause       = { [weak self] in self?.pauseGame() }
        cameraNode.addChild(hudNode)
    }

    private func setupSystems() {
        touchHandler = TouchInputHandler()
        weaponSystem = WeaponSystem(scene: self, player: playerNode)
        aiSystem     = AISystem(scene: self)
    }

    private func spawnInitialAsteroids() {
        for _ in 0..<min(AsteroidConstants.targetCount, 80) {
            let angle = CGFloat.random(in: 0...(2 * .pi))
            let dist  = CGFloat.random(in: 200...AsteroidConstants.spawnMaxDist)
            let pos   = CGPoint(x: cos(angle) * dist, y: sin(angle) * dist)
            let ast   = AsteroidNode.spawn(at: pos)
            addChild(ast)
            asteroids.append(ast)
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MARK: - Game loop
    // ═══════════════════════════════════════════════════════════════════════════

    override func update(_ currentTime: TimeInterval) {
        let dt: TimeInterval = lastUpdateTime == 0
            ? 0
            : min(currentTime - lastUpdateTime, 0.05)   // cap at 50 ms to prevent spiral
        lastUpdateTime = currentTime

        guard gameState == .playing else { return }

        // ── Input ──────────────────────────────────────────────────────────────
        let thrustVec = touchHandler.movementVector
        let fireEvents = touchHandler.consumeFireEvents()

        // ── Player ────────────────────────────────────────────────────────────
        playerNode.update(dt: dt, thrustVector: thrustVec)

        // ── Weapons ───────────────────────────────────────────────────────────
        weaponSystem.update(dt: dt)
        for event in fireEvents {
            let worldPos = screenToWorld(event.screenPosition)
            // Route taps — don't fire if HUD consumed the tap
            if !hudNode.handleTap(at: event.screenPosition, cameraPosition: cameraNode.position) {
                let targets: [SKNode] = (enemies as [SKNode]) + (asteroids as [SKNode])
                weaponSystem.fire(toward: worldPos, availableTargets: targets)
            }
        }

        // ── Enemy AI (Phase 3) ────────────────────────────────────────────────
        if enemySpawnEnabled {
            let newBullets = aiSystem.update(
                enemies: enemies,
                playerPosition: playerNode.position,
                dt: dt
            )
            newBullets.forEach { b in
                addChild(b)
                projectiles.append(b)
            }
        }

        // ── Projectiles ───────────────────────────────────────────────────────
        updateProjectiles(dt: dt)

        // ── Asteroid lifecycle ────────────────────────────────────────────────
        updateAsteroidLifecycle()

        // ── Camera ────────────────────────────────────────────────────────────
        updateCamera()

        // ── Background parallax ───────────────────────────────────────────────
        background.update(cameraPosition: cameraNode.position, dt: dt)

        // ── HUD ───────────────────────────────────────────────────────────────
        hudNode.update(
            health: playerNode.currentHealth,
            maxHealth: playerNode.maxHealth,
            weapon: playerNode.currentWeapon,
            dt: dt
        )
    }

    // ─── Projectile update ────────────────────────────────────────────────────

    private func updateProjectiles(dt: TimeInterval) {
        var i = projectiles.count - 1
        while i >= 0 {
            let p = projectiles[i]
            let expired = p.update(dt: dt)
            if expired {
                p.removeFromParent()
                projectiles.remove(at: i)
            }
            i -= 1
        }
    }

    // ─── Asteroid lifecycle ───────────────────────────────────────────────────

    private func updateAsteroidLifecycle() {
        let px = playerNode.position.x, py = playerNode.position.y
        let despawnSq = AsteroidConstants.despawnDistanceSq

        // Despawn far asteroids
        var i = asteroids.count - 1
        while i >= 0 {
            let a  = asteroids[i]
            let dx = a.position.x - px, dy = a.position.y - py
            if dx * dx + dy * dy > despawnSq {
                a.removeFromParent()
                asteroids.remove(at: i)
            }
            i -= 1
        }

        // Top up
        let deficit = AsteroidConstants.targetCount - asteroids.count
        let batch   = min(deficit, AsteroidConstants.spawnBatchPerFrame)
        for _ in 0..<batch {
            let angle = CGFloat.random(in: 0...(2 * .pi))
            let dist  = CGFloat.random(
                in: AsteroidConstants.spawnMinDist...AsteroidConstants.spawnMaxDist
            )
            let pos = CGPoint(x: px + cos(angle) * dist, y: py + sin(angle) * dist)
            let ast = AsteroidNode.spawn(at: pos)
            addChild(ast)
            asteroids.append(ast)
        }
    }

    // ─── Camera follow ────────────────────────────────────────────────────────

    private func updateCamera() {
        let target = playerNode.position
        let lerp   = CameraConstants.followLerpFactor
        cameraNode.position = CGPoint(
            x: cameraNode.position.x + (target.x - cameraNode.position.x) * lerp,
            y: cameraNode.position.y + (target.y - cameraNode.position.y) * lerp
        )
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MARK: - Physics contacts
    // ═══════════════════════════════════════════════════════════════════════════

    func didBegin(_ contact: SKPhysicsContact) {
        let a = contact.bodyA
        let b = contact.bodyB

        let masks = a.categoryBitMask | b.categoryBitMask

        // Player bullet hits asteroid
        if masks == (PhysicsCategory.playerBullet | PhysicsCategory.asteroid) {
            let bullet   = nodeAs(ProjectileNode.self, a: a, b: b, category: PhysicsCategory.playerBullet)
            let asteroid = nodeAs(AsteroidNode.self,   a: a, b: b, category: PhysicsCategory.asteroid)
            if let bullet = bullet, let asteroid = asteroid {
                handleBulletHitAsteroid(bullet: bullet, asteroid: asteroid)
            }
        }

        // Player bullet hits enemy (Phase 3 — safe to compile now, no-ops if no enemies)
        if masks == (PhysicsCategory.playerBullet | PhysicsCategory.enemy) {
            let bullet = nodeAs(ProjectileNode.self, a: a, b: b, category: PhysicsCategory.playerBullet)
            let enemy  = nodeAs(EnemyNode.self,      a: a, b: b, category: PhysicsCategory.enemy)
            if let bullet = bullet, let enemy = enemy {
                handleBulletHitEnemy(bullet: bullet, enemy: enemy)
            }
        }

        // Enemy bullet hits player
        if masks == (PhysicsCategory.enemyBullet | PhysicsCategory.player) {
            let bullet = nodeAs(ProjectileNode.self, a: a, b: b, category: PhysicsCategory.enemyBullet)
            if let bullet = bullet {
                handleEnemyBulletHitPlayer(bullet: bullet, contactPoint: contact.contactPoint)
            }
        }

        // Player collides with asteroid (ram damage)
        if masks == (PhysicsCategory.player | PhysicsCategory.asteroid) {
            let asteroid = nodeAs(AsteroidNode.self, a: a, b: b, category: PhysicsCategory.asteroid)
            if let asteroid = asteroid {
                handlePlayerHitAsteroid(asteroid: asteroid)
            }
        }
    }

    // ─── Contact handlers ─────────────────────────────────────────────────────

    private func handleBulletHitAsteroid(bullet: ProjectileNode, asteroid: AsteroidNode) {
        spawnHitParticles(at: bullet.position, color: .systemOrange, count: 5)
        removeBullet(bullet)

        let killed = asteroid.takeDamage(Int(bullet.damage * playerNode.effectiveDamageMultiplier))
        if killed {
            spawnExplosion(at: asteroid.position, radius: asteroid.radius)
            let shards = asteroid.fracture()
            shards.forEach { shard in
                addChild(shard)
                asteroids.append(shard)
            }
            removeAsteroid(asteroid)
            if scoreEnabled { score += ScoreConstants.asteroidDestroy; hudNode.updateScore(score) }
        }
    }

    private func handleBulletHitEnemy(bullet: ProjectileNode, enemy: EnemyNode) {
        spawnHitParticles(at: bullet.position, color: enemy.subtype.color, count: 6)
        removeBullet(bullet)

        let damage = bullet.damage * playerNode.effectiveDamageMultiplier
        let killed = enemy.takeDamage(damage)
        if killed {
            spawnExplosion(at: enemy.position, radius: EnemyConstants.radius * 1.5)
            // Phase 2: drop power-up
            removeEnemy(enemy)
            if scoreEnabled {
                score += scoreForKill(enemy.subtype)
                hudNode.updateScore(score)
            }
        }
    }

    private func handleEnemyBulletHitPlayer(bullet: ProjectileNode, contactPoint: CGPoint) {
        removeBullet(bullet)
        spawnHitParticles(at: contactPoint, color: .systemRed, count: 6)
        let killed = playerNode.takeDamage(EnemyConstants.weaponDamage)
        shakeCamera(intensity: 8)
        if killed { handlePlayerDeath() }
    }

    private func handlePlayerHitAsteroid(asteroid: AsteroidNode) {
        let killed = playerNode.takeDamage(10)
        shakeCamera(intensity: 12)
        if killed { handlePlayerDeath() }
        // Push asteroid away from player
        let dx = asteroid.position.x - playerNode.position.x
        let dy = asteroid.position.y - playerNode.position.y
        let len = hypot(dx, dy)
        if len > 0 {
            asteroid.physicsBody?.applyImpulse(
                CGVector(dx: dx / len * 80, dy: dy / len * 80)
            )
        }
    }

    // ─── Player death ─────────────────────────────────────────────────────────

    private func handlePlayerDeath() {
        spawnExplosion(at: playerNode.position, radius: PlayerConstants.radius * 2)
        playerNode.alpha = 0
        shakeCamera(intensity: 25)

        // Phase 1: auto-respawn after a delay so movement testing is uninterrupted
        // Phase 4: replace this block with showGameOver()
        let wait   = SKAction.wait(forDuration: 2.0)
        let respawn = SKAction.run { [weak self] in self?.respawnPlayer() }
        run(SKAction.sequence([wait, respawn]))
    }

    private func respawnPlayer() {
        playerNode.alpha = 1
        playerNode.respawn(at: .zero)
        cameraNode.position = .zero
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private func removeBullet(_ bullet: ProjectileNode) {
        bullet.removeFromParent()
        projectiles.removeAll { $0 === bullet }
    }

    private func removeAsteroid(_ asteroid: AsteroidNode) {
        asteroid.removeFromParent()
        asteroids.removeAll { $0 === asteroid }
    }

    private func removeEnemy(_ enemy: EnemyNode) {
        enemy.removeFromParent()
        enemies.removeAll { $0 === enemy }
    }

    private func nodeAs<T: SKNode>(_ type: T.Type,
                                   a: SKPhysicsBody,
                                   b: SKPhysicsBody,
                                   category: UInt32) -> T? {
        if a.categoryBitMask == category { return a.node as? T }
        if b.categoryBitMask == category { return b.node as? T }
        return nil
    }

    private func scoreForKill(_ subtype: EnemySubtype) -> Int {
        switch subtype {
        case .basic:       return ScoreConstants.killBasic
        case .fastCharger: return ScoreConstants.killCharger
        case .tank:        return ScoreConstants.killTank
        case .skirmisher:  return ScoreConstants.killSkirmisher
        case .orbiter:     return ScoreConstants.killOrbiter
        case .sniper:      return ScoreConstants.killSniper
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MARK: - Visual effects
    // ═══════════════════════════════════════════════════════════════════════════

    private func spawnExplosion(at pos: CGPoint, radius: CGFloat) {
        let count = Int.random(in: 10...16)
        for _ in 0..<count {
            let angle = CGFloat.random(in: 0...(2 * .pi))
            let speed = CGFloat.random(in: 60...220)
            let size  = CGFloat.random(in: 2...6)
            let life  = TimeInterval.random(in: 0.4...1.0)

            let shard = SKShapeNode(circleOfRadius: size)
            shard.fillColor   = Bool.random() ? .systemOrange : .systemYellow
            shard.strokeColor = .clear
            shard.position    = pos
            shard.zPosition   = 20
            addChild(shard)

            let move   = SKAction.moveBy(x: cos(angle) * speed * CGFloat(life),
                                          y: sin(angle) * speed * CGFloat(life),
                                          duration: life)
            let fade   = SKAction.fadeOut(withDuration: life)
            let shrink = SKAction.scale(to: 0, duration: life)
            let group  = SKAction.group([move, fade, shrink])
            shard.run(SKAction.sequence([group, SKAction.removeFromParent()]))
        }

        // Brief flash ring
        let ring = SKShapeNode(circleOfRadius: radius)
        ring.strokeColor = UIColor.white.withAlphaComponent(0.8)
        ring.fillColor   = .clear
        ring.lineWidth   = 3
        ring.position    = pos
        ring.zPosition   = 21
        addChild(ring)
        ring.run(SKAction.sequence([
            SKAction.group([
                SKAction.scale(to: 2.5, duration: 0.3),
                SKAction.fadeOut(withDuration: 0.3)
            ]),
            SKAction.removeFromParent()
        ]))
    }

    private func spawnHitParticles(at pos: CGPoint, color: UIColor, count: Int) {
        for _ in 0..<count {
            let angle = CGFloat.random(in: 0...(2 * .pi))
            let speed = CGFloat.random(in: 80...200)
            let size  = CGFloat.random(in: 1.5...3.5)
            let life  = TimeInterval.random(in: 0.15...0.4)

            let p = SKShapeNode(circleOfRadius: size)
            p.fillColor   = color.withAlphaComponent(0.9)
            p.strokeColor = .clear
            p.position    = pos
            p.zPosition   = 15
            addChild(p)

            let move = SKAction.moveBy(x: cos(angle) * speed * CGFloat(life),
                                        y: sin(angle) * speed * CGFloat(life),
                                        duration: life)
            let fade = SKAction.fadeOut(withDuration: life)
            p.run(SKAction.sequence([
                SKAction.group([move, fade]),
                SKAction.removeFromParent()
            ]))
        }
    }

    // ─── Camera shake ──────────────────────────────────────────────────────────

    private func shakeCamera(intensity: CGFloat) {
        cameraNode.removeAction(forKey: "shake")
        let shakes = 8
        var sequence: [SKAction] = []
        for _ in 0..<shakes {
            let offset = CGPoint(
                x: CGFloat.random(in: -intensity...intensity),
                y: CGFloat.random(in: -intensity...intensity)
            )
            sequence.append(SKAction.moveBy(x: offset.x, y: offset.y, duration: 0.025))
            sequence.append(SKAction.moveBy(x: -offset.x, y: -offset.y, duration: 0.025))
        }
        cameraNode.run(SKAction.sequence(sequence), withKey: "shake")
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MARK: - Touch handling
    // ═══════════════════════════════════════════════════════════════════════════

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        let time = touches.first.map { $0.timestamp } ?? 0
        touchHandler.touchesBegan(touches, currentTime: time)

        // Menu / overlay button taps are handled directly here
        if gameState == .menu {
            showGame()
        }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        touchHandler.touchesMoved(touches)
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        let time = touches.first.map { $0.timestamp } ?? 0
        touchHandler.touchesEnded(touches, currentTime: time)
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        touchHandler.touchesCancelled(touches)
    }

    // ─── Coordinate conversion ────────────────────────────────────────────────

    /// Convert a UIKit screen point (origin top-left) to SpriteKit world space.
    private func screenToWorld(_ screenPoint: CGPoint) -> CGPoint {
        // SpriteKit view: origin bottom-left; UIKit screen: origin top-left
        guard let view = view else { return .zero }
        let viewPoint = CGPoint(x: screenPoint.x, y: view.bounds.height - screenPoint.y)
        return convertPoint(fromView: viewPoint)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MARK: - Game state transitions
    // ═══════════════════════════════════════════════════════════════════════════

    private func showMenu() {
        gameState = .menu
        let overlay = buildMenuOverlay()
        cameraNode.addChild(overlay)
        menuOverlay = overlay
    }

    private func showGame() {
        menuOverlay?.removeFromParent()
        menuOverlay = nil
        gameState = .playing
    }

    private func pauseGame() {
        guard gameState == .playing else { return }
        gameState = .paused
        let overlay = buildPauseOverlay()
        cameraNode.addChild(overlay)
        pauseOverlay = overlay
    }

    private func resumeGame() {
        pauseOverlay?.removeFromParent()
        pauseOverlay = nil
        gameState = .playing
    }

    private func showGameOver() {
        gameState = .gameOver
        let overlay = buildGameOverOverlay()
        cameraNode.addChild(overlay)
        gameOverOverlay = overlay
    }

    private func restartGame() {
        gameOverOverlay?.removeFromParent()
        gameOverOverlay = nil
        score = 0; wave = 0
        asteroids.forEach { $0.removeFromParent() }; asteroids.removeAll()
        enemies.forEach { $0.removeFromParent() }; enemies.removeAll()
        projectiles.forEach { $0.removeFromParent() }; projectiles.removeAll()
        spawnInitialAsteroids()
        playerNode.respawn(at: .zero)
        cameraNode.position = .zero
        gameState = .playing
    }

    // ─── Weapon cycling ───────────────────────────────────────────────────────

    private func cycleWeapon() {
        let list = WeaponConstants.cycleOrder
        guard let idx = list.firstIndex(of: playerNode.currentWeapon) else { return }
        playerNode.currentWeapon = list[(idx + 1) % list.count]
        playerNode.weaponCooldown = 0
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MARK: - Overlay builders
    // ═══════════════════════════════════════════════════════════════════════════

    private func buildMenuOverlay() -> SKNode {
        let root = SKNode()
        root.zPosition = 200

        // Background dim
        let bg = SKShapeNode(rectOf: size)
        bg.fillColor   = UIColor.black.withAlphaComponent(0.85)
        bg.strokeColor = .clear
        root.addChild(bg)

        // Title
        let title = SKLabelNode(fontNamed: "Helvetica-Bold")
        title.text      = "DEEP SPACE"
        title.fontSize  = 46
        title.fontColor = UIColor(red: 0.3, green: 0.7, blue: 1, alpha: 1)
        title.position  = CGPoint(x: 0, y: 80)
        root.addChild(title)

        let sub = SKLabelNode(fontNamed: "Helvetica")
        sub.text      = "Survive the void"
        sub.fontSize  = 18
        sub.fontColor = UIColor(white: 0.55, alpha: 1)
        sub.position  = CGPoint(x: 0, y: 40)
        root.addChild(sub)

        let start = buildButton(text: "LAUNCH", color: UIColor(red: 0.15, green: 0.5, blue: 0.9, alpha: 1))
        start.position = CGPoint(x: 0, y: -30)
        root.addChild(start)

        let phase = SKLabelNode(fontNamed: "Helvetica")
        phase.text      = "Phase 1 — Movement Engine"
        phase.fontSize  = 11
        phase.fontColor = UIColor(white: 0.3, alpha: 1)
        phase.position  = CGPoint(x: 0, y: -120)
        root.addChild(phase)

        return root
    }

    private func buildPauseOverlay() -> SKNode {
        let root = SKNode()
        root.zPosition = 200

        let bg = SKShapeNode(rectOf: size)
        bg.fillColor   = UIColor.black.withAlphaComponent(0.75)
        bg.strokeColor = .clear
        root.addChild(bg)

        let title = SKLabelNode(fontNamed: "Helvetica-Bold")
        title.text      = "PAUSED"
        title.fontSize  = 38
        title.fontColor = .white
        title.position  = CGPoint(x: 0, y: 60)
        root.addChild(title)

        let resume = buildButton(text: "RESUME", color: .systemGreen)
        resume.position = CGPoint(x: 0, y: -10)
        resume.name     = "resumeBtn"
        root.addChild(resume)

        let restart = buildButton(text: "RESTART", color: UIColor(white: 0.25, alpha: 1))
        restart.position = CGPoint(x: 0, y: -80)
        restart.name     = "restartBtn"
        root.addChild(restart)

        // Tap routing for the overlay buttons
        isUserInteractionEnabled = true
        root.isUserInteractionEnabled = false
        return root
    }

    private func buildGameOverOverlay() -> SKNode {
        let root = SKNode()
        root.zPosition = 200

        let bg = SKShapeNode(rectOf: size)
        bg.fillColor   = UIColor.black.withAlphaComponent(0.85)
        bg.strokeColor = .clear
        root.addChild(bg)

        let title = SKLabelNode(fontNamed: "Helvetica-Bold")
        title.text      = "GAME OVER"
        title.fontSize  = 42
        title.fontColor = .systemRed
        title.position  = CGPoint(x: 0, y: 80)
        root.addChild(title)

        if scoreEnabled {
            let scoreLbl = SKLabelNode(fontNamed: "Helvetica-Bold")
            scoreLbl.text      = "Score: \(score)"
            scoreLbl.fontSize  = 24
            scoreLbl.fontColor = .white
            scoreLbl.position  = CGPoint(x: 0, y: 30)
            root.addChild(scoreLbl)
        }

        let btn = buildButton(text: "PLAY AGAIN", color: UIColor(red: 0.15, green: 0.5, blue: 0.9, alpha: 1))
        btn.position = CGPoint(x: 0, y: -40)
        btn.name     = "playAgainBtn"
        root.addChild(btn)

        return root
    }

    private func buildButton(text: String, color: UIColor) -> SKNode {
        let container = SKNode()

        let bg = SKShapeNode(rectOf: CGSize(width: 200, height: 52), cornerRadius: 26)
        bg.fillColor   = color
        bg.strokeColor = color.withAlphaComponent(0.4)
        bg.lineWidth   = 1.5
        container.addChild(bg)

        let label = SKLabelNode(fontNamed: "Helvetica-Bold")
        label.text      = text
        label.fontSize  = 20
        label.fontColor = .white
        label.verticalAlignmentMode   = .center
        label.horizontalAlignmentMode = .center
        label.position  = .zero
        container.addChild(label)

        return container
    }

    // Override touchesBegan for overlay button handling
    // (The game-loop tap detection uses touchHandler; overlays are handled directly.)
    private func handleOverlayTap(_ location: CGPoint) {
        if gameState == .paused {
            let nodes = cameraNode.nodes(at: location)
            if nodes.contains(where: { $0.parent?.name == "resumeBtn" || $0.name == "resumeBtn" }) {
                resumeGame()
            } else if nodes.contains(where: { $0.parent?.name == "restartBtn" || $0.name == "restartBtn" }) {
                pauseOverlay?.removeFromParent(); pauseOverlay = nil
                restartGame()
            }
        }
        if gameState == .gameOver {
            let nodes = cameraNode.nodes(at: location)
            if nodes.contains(where: { $0.parent?.name == "playAgainBtn" || $0.name == "playAgainBtn" }) {
                restartGame()
            }
        }
    }
}
