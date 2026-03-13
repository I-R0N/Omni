// SpaceBackground.swift
// Procedural parallax space background — port of BackgroundManager.ts.
//
// Layers (back to front):
//   1. Nebula puffs   — large coloured blobs that drift very slowly
//   2. Milky Way band — dense strip of faint stars at a fixed angle
//   3. Star layers    — 6 depth planes, each scrolling at a different speed
//   4. Shooting stars — occasional streaks that fade out
//
// Parallax works by tracking the camera's world-space delta each frame and
// shifting each layer node by delta * layerSpeed.  The star nodes wrap at
// screen edges exactly like the TypeScript version.

import SpriteKit

final class SpaceBackground: SKNode {

    // ── Private types ──────────────────────────────────────────────────────────

    private struct StarLayer {
        let container: SKNode
        var stars:     [SKShapeNode]
        let speed:     CGFloat    // parallax coefficient (0 = fixed, 1 = world-locked)
    }

    private struct NebulaPuff {
        let node:   SKSpriteNode
        let depth:  CGFloat       // parallax coefficient
    }

    // ── State ─────────────────────────────────────────────────────────────────
    private var starLayers:    [StarLayer]  = []
    private var nebulaPuffs:   [NebulaPuff] = []
    private var milkyWayStars: [SKShapeNode] = []

    private var lastCameraPos: CGPoint? = nil
    private var shootingTimer: TimeInterval = 0
    private let sceneSize: CGSize

    // ── Init ──────────────────────────────────────────────────────────────────

    init(sceneSize: CGSize) {
        self.sceneSize = sceneSize
        super.init()
        zPosition = -100
        name = "spaceBackground"

        resetShootingTimer()
        buildLayers()
    }

    required init?(coder: NSCoder) { fatalError() }

    // ── Build ─────────────────────────────────────────────────────────────────

    private func buildLayers() {
        buildNebulae()
        buildMilkyWay()
        buildStarLayers()
    }

    private func buildNebulae() {
        let colors: [UIColor] = [
            UIColor(red: 0.93, green: 0.27, blue: 0.27, alpha: 1),
            UIColor(red: 0.23, green: 0.51, blue: 0.96, alpha: 1),
            UIColor(red: 0.66, green: 0.33, blue: 0.98, alpha: 1),
            UIColor(red: 0.06, green: 0.73, blue: 0.51, alpha: 1),
            UIColor(red: 0.96, green: 0.62, blue: 0.04, alpha: 1),
            UIColor(red: 0.02, green: 0.71, blue: 0.83, alpha: 1),
        ]

        let w = sceneSize.width, h = sceneSize.height
        for _ in 0..<BackgroundConstants.nebulaCount {
            let size  = CGFloat.random(in: 80...200)
            let depth = CGFloat.random(in: 0.05...0.2)
            let color = colors.randomElement()!

            let node = SKSpriteNode(color: color.withAlphaComponent(0.22),
                                    size: CGSize(width: size, height: size * CGFloat.random(in: 0.6...1.4)))
            node.position = CGPoint(x: CGFloat.random(in: 0...w),
                                    y: CGFloat.random(in: 0...h))
            node.zRotation = CGFloat.random(in: 0...(2 * .pi))
            node.zPosition = -90

            // Soft circular mask via a radial gradient texture
            node.texture = makeNebulaPuffTexture(color: color, size: size)
            node.size    = CGSize(width: size, height: size * CGFloat.random(in: 0.7...1.3))

            addChild(node)
            nebulaPuffs.append(NebulaPuff(node: node, depth: depth))
        }
    }

    private func makeNebulaPuffTexture(color: UIColor, size: CGFloat) -> SKTexture {
        let dim = Int(size)
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: dim, height: dim))
        let img = renderer.image { ctx in
            let rect = CGRect(origin: .zero, size: CGSize(width: dim, height: dim))
            let gradient = CGGradient(
                colorsSpace: CGColorSpaceCreateDeviceRGB(),
                colors: [color.withAlphaComponent(0.35).cgColor,
                         color.withAlphaComponent(0.0).cgColor] as CFArray,
                locations: [0.0, 1.0]
            )!
            ctx.cgContext.drawRadialGradient(
                gradient,
                startCenter: CGPoint(x: dim / 2, y: dim / 2), startRadius: 0,
                endCenter:   CGPoint(x: dim / 2, y: dim / 2), endRadius: CGFloat(dim) / 2,
                options: []
            )
        }
        return SKTexture(image: img)
    }

    private func buildMilkyWay() {
        let w = sceneSize.width, h = sceneSize.height
        let angle = CGFloat.random(in: -0.4...0.4)
        let mwColors: [UIColor] = [
            UIColor(red: 0.55, green: 0.36, blue: 0.98, alpha: 1),
            UIColor(red: 0.23, green: 0.51, blue: 0.96, alpha: 1),
            UIColor(red: 0.98, green: 0.74, blue: 0.27, alpha: 1),
        ]

        for _ in 0..<80 {
            let x = CGFloat.random(in: 0...w)
            let y = h / 2 + tan(angle) * (x - w / 2) +
                    (CGFloat.random(in: -1...1) + CGFloat.random(in: -1...1)) * 25
            let star = makeStarNode(
                size: CGFloat.random(in: 0.8...2.2),
                color: Double.random(in: 0...1) > 0.8 ? mwColors.randomElement()! : .white,
                opacity: CGFloat.random(in: 0.2...0.45)
            )
            star.position = CGPoint(x: x, y: y)
            star.zPosition = -85
            addChild(star)
            milkyWayStars.append(star)
        }
    }

    private func buildStarLayers() {
        let w = sceneSize.width, h = sceneSize.height
        let numLayers = BackgroundConstants.starLayerCount
        let perLayer  = BackgroundConstants.starsPerLayer

        for i in 0..<numLayers {
            let t     = CGFloat(i) / CGFloat(numLayers)
            let speed = 0.03 + t * t * 0.45     // near-zero for far stars, ~0.5 for close stars

            let container = SKNode()
            container.zPosition = -80 + CGFloat(i)
            addChild(container)

            var stars: [SKShapeNode] = []
            for _ in 0..<perLayer {
                let size    = (0.5 + CGFloat.random(in: 0...0.5)) * (0.5 + t * 1.5)
                let opacity = CGFloat.random(in: 0.3...1.0)
                let star    = makeStarNode(
                    size: max(0.8, size),
                    color: Double.random(in: 0...1) > 0.95 ? .systemYellow : .white,
                    opacity: opacity
                )
                star.position = CGPoint(x: CGFloat.random(in: 0...w),
                                        y: CGFloat.random(in: 0...h))
                container.addChild(star)
                stars.append(star)
            }
            starLayers.append(StarLayer(container: container, stars: stars, speed: speed))
        }
    }

    private func makeStarNode(size: CGFloat, color: UIColor, opacity: CGFloat) -> SKShapeNode {
        let node: SKShapeNode
        if size < 1.5 {
            node = SKShapeNode(rectOf: CGSize(width: max(1, size), height: max(1, size)))
        } else {
            node = SKShapeNode(circleOfRadius: size)
        }
        node.fillColor   = color.withAlphaComponent(opacity)
        node.strokeColor = .clear
        return node
    }

    // ── Per-frame update ──────────────────────────────────────────────────────

    func update(cameraPosition: CGPoint, dt: TimeInterval) {
        guard let last = lastCameraPos else {
            lastCameraPos = cameraPosition
            return
        }
        let dx = cameraPosition.x - last.x
        let dy = cameraPosition.y - last.y
        lastCameraPos = cameraPosition

        let w = sceneSize.width
        let h = sceneSize.height

        // Parallax-shift nebulae
        for puff in nebulaPuffs {
            puff.node.position.x -= dx * puff.depth
            puff.node.position.y -= dy * puff.depth
            // Wrap
            if puff.node.position.x < -puff.node.size.width  { puff.node.position.x += w + puff.node.size.width * 2 }
            if puff.node.position.x > w + puff.node.size.width { puff.node.position.x -= w + puff.node.size.width * 2 }
            if puff.node.position.y < -puff.node.size.height { puff.node.position.y += h + puff.node.size.height * 2 }
            if puff.node.position.y > h + puff.node.size.height { puff.node.position.y -= h + puff.node.size.height * 2 }
        }

        // Milky Way (very slow)
        for star in milkyWayStars {
            star.position.x -= dx * 0.03
            star.position.y -= dy * 0.03
            wrapStar(star, w: w, h: h)
        }

        // Star layers
        for layer in starLayers {
            for star in layer.stars {
                star.position.x -= dx * layer.speed * 0.2
                star.position.y -= dy * layer.speed * 0.2
                wrapStar(star, w: w, h: h)
            }
        }

        // Shooting stars
        updateShootingStars(dt: dt)
    }

    private func wrapStar(_ star: SKShapeNode, w: CGFloat, h: CGFloat) {
        if star.position.x < 0  { star.position.x += w }
        if star.position.x > w  { star.position.x -= w }
        if star.position.y < 0  { star.position.y += h }
        if star.position.y > h  { star.position.y -= h }
    }

    // ── Shooting stars ────────────────────────────────────────────────────────

    private func resetShootingTimer() {
        shootingTimer = TimeInterval.random(
            in: BackgroundConstants.shootingStarMinInterval...BackgroundConstants.shootingStarMaxInterval
        )
    }

    private func updateShootingStars(dt: TimeInterval) {
        shootingTimer -= dt
        if shootingTimer <= 0 {
            resetShootingTimer()
            spawnShootingStar()
        }
    }

    private func spawnShootingStar() {
        let w = sceneSize.width, h = sceneSize.height
        let off: CGFloat = 30

        // Pick random start on an edge, aim toward opposite side
        let edge = Int.random(in: 0...2)
        let start: CGPoint
        let target: CGPoint
        switch edge {
        case 0:
            start  = CGPoint(x: CGFloat.random(in: -off...(w + off)), y: -off)
            target = CGPoint(x: CGFloat.random(in: -off...(w + off)), y: h + off)
        case 1:
            start  = CGPoint(x: -off, y: CGFloat.random(in: -off...(h + off)))
            target = CGPoint(x: w + off, y: CGFloat.random(in: -off...(h + off)))
        default:
            start  = CGPoint(x: w + off, y: CGFloat.random(in: -off...(h + off)))
            target = CGPoint(x: -off, y: CGFloat.random(in: -off...(h + off)))
        }

        let speed  = CGFloat.random(in: 400...1200)
        let dist   = hypot(target.x - start.x, target.y - start.y)
        let travelTime = TimeInterval(dist / speed)

        // The "star" is a thin line drawn via a SKShapeNode
        let angle = atan2(target.y - start.y, target.x - start.x)
        let tailLen = CGFloat.random(in: 30...80)
        let path = CGMutablePath()
        path.move(to: .zero)
        path.addLine(to: CGPoint(x: -tailLen, y: 0))

        let trail = SKShapeNode(path: path)
        trail.strokeColor = UIColor.white.withAlphaComponent(0.9)
        trail.lineWidth   = 1.5
        trail.zPosition   = -70
        trail.position    = start
        trail.zRotation   = angle
        addChild(trail)

        let move   = SKAction.move(to: target, duration: travelTime)
        let fade   = SKAction.fadeOut(withDuration: travelTime * 0.6)
        let group  = SKAction.group([move, fade])
        let remove = SKAction.removeFromParent()
        trail.run(SKAction.sequence([group, remove]))
    }
}
