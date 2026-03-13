// HUDNode.swift
// In-scene HUD — added as a child of SKCameraNode so it stays fixed on screen.
//
// Layout (portrait):
//
//   ┌────────────────────────────────────────┐
//   │  [HP ████████░░]          [⏸ Pause]   │  ← top bar
//   │                                        │
//   │                                        │
//   │  [controls hint]  [⊙ Weapon: Blaster] │  ← bottom bar
//   └────────────────────────────────────────┘
//
// Phase 3 additions: wave label (top-centre), enemy counter
// Phase 4 additions: score label (top-right)
//
// All positions are relative to the camera's coordinate system
// (0,0 = screen centre).

import SpriteKit

final class HUDNode: SKNode {

    // ── Sub-nodes ──────────────────────────────────────────────────────────────
    private let healthBarBg:   SKShapeNode
    private let healthBarFill: SKShapeNode
    private let healthLabel:   SKLabelNode

    private let weaponButton:  SKShapeNode
    private let weaponLabel:   SKLabelNode
    private let weaponSubLabel: SKLabelNode

    private let pauseButton:   SKShapeNode
    private let pauseIcon:     SKShapeNode

    private let controlsHint:  SKLabelNode
    private var hintFadeTimer: TimeInterval = 5.0
    private var hintFading:    Bool = false

    // Phase 3/4 stubs (hidden until activated)
    let waveLabel:  SKLabelNode
    let scoreLabel: SKLabelNode

    // ── Geometry constants ────────────────────────────────────────────────────
    private let barWidth:  CGFloat = 130
    private let barHeight: CGFloat = 10
    private let buttonR:   CGFloat = 34    // weapon button radius

    // ── Callbacks set by GameScene ─────────────────────────────────────────────
    var onCycleWeapon: (() -> Void)?
    var onPause:       (() -> Void)?

    // ── Init ──────────────────────────────────────────────────────────────────

    init(sceneSize: CGSize) {
        let hw = sceneSize.width / 2
        let hh = sceneSize.height / 2
        let margin: CGFloat = 20
        let safeTop: CGFloat = 50    // extra for notch / dynamic island

        // ── Health bar (top-left) ──────────────────────────────────────────────
        healthBarBg = SKShapeNode(rectOf: CGSize(width: 130, height: 10), cornerRadius: 5)
        healthBarBg.fillColor   = UIColor(white: 0.2, alpha: 0.8)
        healthBarBg.strokeColor = UIColor(white: 0.4, alpha: 0.5)
        healthBarBg.position    = CGPoint(x: -hw + margin + 65, y: hh - safeTop - 20)
        healthBarBg.zPosition   = 100

        healthBarFill = SKShapeNode(rectOf: CGSize(width: 130, height: 10), cornerRadius: 5)
        healthBarFill.fillColor   = .systemGreen
        healthBarFill.strokeColor = .clear
        healthBarFill.position    = healthBarBg.position
        healthBarFill.zPosition   = 101

        healthLabel = SKLabelNode(fontNamed: "Helvetica-Bold")
        healthLabel.fontSize     = 11
        healthLabel.fontColor    = UIColor(white: 0.7, alpha: 1)
        healthLabel.text         = "HP 100"
        healthLabel.horizontalAlignmentMode = .left
        healthLabel.position     = CGPoint(x: -hw + margin, y: hh - safeTop - 12)
        healthLabel.zPosition    = 102

        // ── Weapon button (bottom-right) ───────────────────────────────────────
        weaponButton = SKShapeNode(circleOfRadius: 34)
        weaponButton.fillColor   = UIColor(white: 0.12, alpha: 0.9)
        weaponButton.strokeColor = UIColor(white: 0.4, alpha: 0.6)
        weaponButton.lineWidth   = 2
        weaponButton.position    = CGPoint(x: hw - margin - 34, y: -hh + margin + 34 + safeTop * 0.5)
        weaponButton.zPosition   = 100
        weaponButton.name        = "weaponButton"

        weaponSubLabel = SKLabelNode(fontNamed: "Helvetica")
        weaponSubLabel.fontSize  = 9
        weaponSubLabel.fontColor = UIColor(white: 0.5, alpha: 1)
        weaponSubLabel.text      = "WEAPON"
        weaponSubLabel.horizontalAlignmentMode = .center
        weaponSubLabel.verticalAlignmentMode   = .center
        weaponSubLabel.position  = CGPoint(x: 0, y: 11)
        weaponSubLabel.zPosition = 1

        weaponLabel = SKLabelNode(fontNamed: "Helvetica-Bold")
        weaponLabel.fontSize     = 13
        weaponLabel.fontColor    = .systemYellow
        weaponLabel.text         = "Blaster"
        weaponLabel.horizontalAlignmentMode = .center
        weaponLabel.verticalAlignmentMode   = .center
        weaponLabel.position     = CGPoint(x: 0, y: -4)
        weaponLabel.zPosition    = 1

        // ── Pause button (top-right) ───────────────────────────────────────────
        pauseButton = SKShapeNode(rectOf: CGSize(width: 44, height: 44), cornerRadius: 10)
        pauseButton.fillColor   = UIColor(white: 0.12, alpha: 0.85)
        pauseButton.strokeColor = UIColor(white: 0.35, alpha: 0.6)
        pauseButton.lineWidth   = 1.5
        pauseButton.position    = CGPoint(x: hw - margin - 22, y: hh - safeTop - 22)
        pauseButton.zPosition   = 100
        pauseButton.name        = "pauseButton"

        // Two vertical rectangles for ⏸ icon
        let bar = SKShapeNode(rectOf: CGSize(width: 4, height: 14), cornerRadius: 2)
        bar.fillColor = .white; bar.strokeColor = .clear; bar.zPosition = 1
        pauseIcon = bar

        // ── Controls hint (bottom-centre, fades out) ───────────────────────────
        controlsHint = SKLabelNode(fontNamed: "Helvetica")
        controlsHint.fontSize  = 14
        controlsHint.fontColor = UIColor(white: 0.6, alpha: 1)
        controlsHint.text      = "DRAG to move  •  TAP to fire"
        controlsHint.horizontalAlignmentMode = .center
        controlsHint.position  = CGPoint(x: 0, y: -hh + margin + safeTop * 0.5 + 60)
        controlsHint.zPosition = 100

        // ── Phase 3/4 labels (hidden) ─────────────────────────────────────────
        waveLabel = SKLabelNode(fontNamed: "Helvetica-Bold")
        waveLabel.fontSize  = 18
        waveLabel.fontColor = .white
        waveLabel.text      = "WAVE 1"
        waveLabel.horizontalAlignmentMode = .center
        waveLabel.position  = CGPoint(x: 0, y: hh - safeTop - 22)
        waveLabel.zPosition = 100
        waveLabel.alpha     = 0   // hidden until Phase 3

        scoreLabel = SKLabelNode(fontNamed: "Helvetica-Bold")
        scoreLabel.fontSize  = 14
        scoreLabel.fontColor = UIColor(white: 0.8, alpha: 1)
        scoreLabel.text      = "0"
        scoreLabel.horizontalAlignmentMode = .right
        scoreLabel.position  = CGPoint(x: hw - margin - 70, y: hh - safeTop - 22)
        scoreLabel.zPosition = 100
        scoreLabel.alpha     = 0  // hidden until Phase 4

        super.init()

        // Assemble the tree
        addChild(healthBarBg)
        addChild(healthBarFill)
        addChild(healthLabel)

        addChild(weaponButton)
        weaponButton.addChild(weaponSubLabel)
        weaponButton.addChild(weaponLabel)

        addChild(pauseButton)
        // Add two pause bars
        let bar1 = SKShapeNode(rectOf: CGSize(width: 4, height: 14), cornerRadius: 2)
        bar1.fillColor = .white; bar1.strokeColor = .clear
        bar1.position = CGPoint(x: -4, y: 0); bar1.zPosition = 1
        pauseButton.addChild(bar1)
        let bar2 = SKShapeNode(rectOf: CGSize(width: 4, height: 14), cornerRadius: 2)
        bar2.fillColor = .white; bar2.strokeColor = .clear
        bar2.position = CGPoint(x: 4, y: 0); bar2.zPosition = 1
        pauseButton.addChild(bar2)

        addChild(controlsHint)
        addChild(waveLabel)
        addChild(scoreLabel)

        isUserInteractionEnabled = false  // handled by GameScene touch routing
    }

    required init?(coder: NSCoder) { fatalError() }

    // ── Per-frame update ──────────────────────────────────────────────────────

    func update(health: CGFloat, maxHealth: CGFloat,
                weapon: WeaponType, dt: TimeInterval) {
        updateHealthBar(health: health, maxHealth: maxHealth)
        weaponLabel.text = WeaponConstants.all[weapon]?.name ?? "?"

        // Fade controls hint
        if !hintFading {
            hintFadeTimer -= dt
            if hintFadeTimer <= 0 {
                hintFading = true
                let fade = SKAction.sequence([
                    SKAction.fadeOut(withDuration: 1.5),
                    SKAction.removeFromParent()
                ])
                controlsHint.run(fade)
            }
        }
    }

    private func updateHealthBar(health: CGFloat, maxHealth: CGFloat) {
        let pct = max(0, min(1, health / maxHealth))
        let newWidth = barWidth * pct

        // Reuse the path approach: rebuild fill shape each frame
        let rect = CGRect(x: -barWidth / 2, y: -barHeight / 2,
                          width: newWidth, height: barHeight)
        let path = CGPath(roundedRect: rect, cornerWidth: 5, cornerHeight: 5, transform: nil)
        healthBarFill.path = path

        healthBarFill.fillColor = pct > 0.6 ? .systemGreen
                                : pct > 0.3 ? .systemYellow
                                            : .systemRed

        healthLabel.text = "HP \(Int(health))"
    }

    // ── Tap routing — called by GameScene ─────────────────────────────────────

    /// Returns true if the tap was consumed by a HUD button.
    func handleTap(at screenPoint: CGPoint, cameraPosition: CGPoint) -> Bool {
        // Convert screen point to camera-local coordinates
        let local = CGPoint(x: screenPoint.x - cameraPosition.x,
                            y: screenPoint.y - cameraPosition.y)

        if weaponButton.contains(local) {
            let bounce = SKAction.sequence([
                SKAction.scale(to: 0.88, duration: 0.06),
                SKAction.scale(to: 1.0,  duration: 0.1)
            ])
            weaponButton.run(bounce)
            onCycleWeapon?()
            return true
        }

        if pauseButton.contains(local) {
            onPause?()
            return true
        }
        return false
    }

    // ── Phase 3: show wave label ───────────────────────────────────────────────

    func showWaveBanner(wave: Int) {
        waveLabel.text  = "WAVE \(wave)"
        waveLabel.alpha = 1
        waveLabel.setScale(1.4)
        let anim = SKAction.sequence([
            SKAction.scale(to: 1.0, duration: 0.3),
            SKAction.wait(forDuration: 2.0),
            SKAction.fadeOut(withDuration: 0.5),
        ])
        waveLabel.run(anim)
    }

    // ── Phase 4: update score ──────────────────────────────────────────────────

    func updateScore(_ score: Int) {
        scoreLabel.alpha = 1
        scoreLabel.text  = "\(score)"
    }
}
